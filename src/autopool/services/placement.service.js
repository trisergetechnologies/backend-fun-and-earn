const mongoose = require('mongoose');
const {
  AutopoolPlacement,
  AutopoolParticipation,
  AutopoolCycle,
  AutopoolNextPoolEligibility,
  AutopoolLedger,
  AutopoolSystemBalances,
} = require('../models');
const { computeCycleDistribution } = require('./cycleMath');
const { creditEcartForAutopool } = require('./wallet.service');
const { ensureSystemBalances, getPoolConfig } = require('./config.service');
const { shouldReleaseAfterCycle15 } = require('./release.rules');
const { maybeResetCreditsAfterPool10 } = require('./referralCredit.service');

async function nextQueueSequence(poolLevel, session) {
  const last = await AutopoolPlacement.findOne({ poolLevel })
    .sort({ queueSequence: -1 })
    .session(session);
  return (last?.queueSequence || 0) + 1;
}

/**
 * Claim oldest open parent seat (FIFO), excluding the seeker's own participation seats.
 */
async function claimOpenParent({ poolLevel, seekerParticipationId, session }) {
  const filter = {
    poolLevel,
    status: { $in: ['PLACED', 'WAITING'] },
    openSlots: { $gt: 0 },
    participationId: { $ne: seekerParticipationId },
  };
  return AutopoolPlacement.findOneAndUpdate(
    filter,
    { $inc: { openSlots: -1 } },
    { sort: { queueSequence: 1 }, new: true, session }
  );
}

/**
 * Place one participation into one matrix seat (no continuation cascade).
 * Returns { placement, cycleResult } where cycleResult may include reenterParticipationId.
 */
async function placeOne({ participation, session }) {
  const poolLevel = participation.poolLevel;
  const queueSequence = await nextQueueSequence(poolLevel, session);

  const parent = await claimOpenParent({
    poolLevel,
    seekerParticipationId: participation._id,
    session,
  });

  let slot = 'root';
  let parentParticipationId = null;

  if (!parent) {
    // Alone / no open child seats — root (parent seat with open slots)
    const [placement] = await AutopoolPlacement.create(
      [
        {
          poolLevel,
          participationId: participation._id,
          userId: participation.userId,
          parentParticipationId: null,
          slot: 'root',
          status: 'PLACED',
          queueSequence,
          openSlots: 2,
          filledAt: new Date(),
        },
      ],
      { session }
    );

    participation.placementId = placement._id;
    participation.status = 'ACTIVE';
    participation.startedAt = participation.startedAt || new Date();
    await participation.save({ session });

    return { placement, cycleResult: null };
  }

  parentParticipationId = parent.participationId;
  if (!parent.leftChildParticipationId) {
    slot = 'left';
    parent.leftChildParticipationId = participation._id;
  } else if (!parent.rightChildParticipationId) {
    slot = 'right';
    parent.rightChildParticipationId = participation._id;
  } else {
    parent.openSlots += 1;
    await parent.save({ session });
    const err = new Error('Placement race — retry');
    err.code = 'PLACEMENT_RACE';
    throw err;
  }

  await parent.save({ session });

  const [placement] = await AutopoolPlacement.create(
    [
      {
        poolLevel,
        participationId: participation._id,
        userId: participation.userId,
        parentParticipationId,
        slot,
        status: 'PLACED',
        queueSequence,
        openSlots: 2,
        filledAt: new Date(),
      },
    ],
    { session }
  );

  participation.placementId = placement._id;
  participation.status = 'ACTIVE';
  participation.startedAt = participation.startedAt || new Date();
  await participation.save({ session });

  let cycleResult = null;
  if (parent.leftChildParticipationId && parent.rightChildParticipationId) {
    parent.status = 'CYCLE_DONE';
    await parent.save({ session });
    cycleResult = await completeCycleForParent({
      parentPlacement: parent,
      session,
    });
  }

  return { placement, cycleResult };
}

/**
 * Place a participation into poolLevel FIFO matrix.
 * After a cycle, same-pool continuation re-enters as a child (filler), with cascade via queue.
 */
async function placeParticipation({ participation, session }) {
  const pending = [participation._id.toString()];
  let last = null;
  let guard = 0;
  const maxGuard = 64;

  while (pending.length && guard < maxGuard) {
    guard += 1;
    const id = pending.shift();
    const part = await AutopoolParticipation.findById(id).session(session);
    if (!part) continue;

    last = await placeOne({ participation: part, session });
    const reenterId = last?.cycleResult?.reenterParticipationId;
    if (reenterId) {
      pending.push(String(reenterId));
    }
  }

  if (pending.length) {
    const err = new Error('Placement cascade exceeded guard — possible loop');
    err.code = 'PLACEMENT_CASCADE_OVERFLOW';
    throw err;
  }

  return last;
}

async function completeCycleForParent({ parentPlacement, session }) {
  const parentParticipation = await AutopoolParticipation.findById(
    parentPlacement.participationId
  ).session(session);

  if (!parentParticipation) {
    return null;
  }

  const nextCycleNumber = (parentParticipation.cycleCount || 0) + 1;
  const maxCycles = parentParticipation.configSnapshot?.maxCycles ?? 15;
  if (nextCycleNumber > maxCycles) {
    return null;
  }

  const idempotencyKey = `cycle-distribution:${parentParticipation._id}:${nextCycleNumber}`;
  const existing = await AutopoolCycle.findOne({ idempotencyKey }).session(session);
  if (existing) {
    return { cycle: existing, alreadyProcessed: true, reenterParticipationId: null };
  }

  const dist = computeCycleDistribution({
    participation: parentParticipation,
    cycleNumber: nextCycleNumber,
  });

  const [cycle] = await AutopoolCycle.create(
    [
      {
        participationId: parentParticipation._id,
        userId: parentParticipation.userId,
        poolLevel: parentParticipation.poolLevel,
        cycleNumber: nextCycleNumber,
        collectionAmount: dist.collectionAmount,
        samePoolAmount: dist.samePoolAmount,
        walletAmount: dist.walletAmount,
        nextPoolAmount: dist.nextPoolAmount,
        adminAmount: dist.adminAmount,
        featureAmount: dist.featureAmount,
        status: 'DISTRIBUTED',
        idempotencyKey,
        completedAt: new Date(),
      },
    ],
    { session }
  );

  if (dist.walletAmount > 0) {
    await creditEcartForAutopool({
      userId: parentParticipation.userId,
      amount: dist.walletAmount,
      idempotencyKey: `wallet-credit:${parentParticipation._id}:${nextCycleNumber}:wallet`,
      session,
      participationId: parentParticipation._id,
      cycleId: cycle._id,
      poolLevel: parentParticipation.poolLevel,
      notes: `Autopool P${parentParticipation.poolLevel} cycle ${nextCycleNumber}`,
    });
  }

  const balances = await ensureSystemBalances(session);
  if (dist.adminAmount > 0) {
    balances.adminAllocation += dist.adminAmount;
    await AutopoolLedger.create(
      [
        {
          idempotencyKey: `admin:${parentParticipation._id}:${nextCycleNumber}`,
          type: 'admin_allocation',
          amount: dist.adminAmount,
          userId: parentParticipation.userId,
          poolLevel: parentParticipation.poolLevel,
          participationId: parentParticipation._id,
          cycleId: cycle._id,
          allocationType: 'admin',
        },
      ],
      { session }
    );
  }
  if (dist.featureAmount > 0) {
    balances.featureReserve += dist.featureAmount;
    await AutopoolLedger.create(
      [
        {
          idempotencyKey: `feature:${parentParticipation._id}:${nextCycleNumber}`,
          type: 'feature_reserve',
          amount: dist.featureAmount,
          userId: parentParticipation.userId,
          poolLevel: parentParticipation.poolLevel,
          participationId: parentParticipation._id,
          cycleId: cycle._id,
          allocationType: 'feature',
        },
      ],
      { session }
    );
  }
  await balances.save({ session });

  if (dist.nextPoolAmount > 0) {
    parentParticipation.nextPoolEligibleAmount =
      (parentParticipation.nextPoolEligibleAmount || 0) + dist.nextPoolAmount;
    await AutopoolLedger.create(
      [
        {
          idempotencyKey: `next-pool-reserve:${parentParticipation._id}:${nextCycleNumber}`,
          type: 'next_pool_reserve',
          amount: dist.nextPoolAmount,
          userId: parentParticipation.userId,
          poolLevel: parentParticipation.poolLevel,
          participationId: parentParticipation._id,
          cycleId: cycle._id,
          allocationType: 'next_pool',
        },
      ],
      { session }
    );
  }

  if (dist.createsEligibility) {
    const targetLevel = parentParticipation.poolLevel + 1;
    const targetConfig = await getPoolConfig(targetLevel, session);
    const entryAmount =
      targetConfig?.entryAmount ?? parentParticipation.nextPoolEligibleAmount;

    await AutopoolNextPoolEligibility.findOneAndUpdate(
      { sourceParticipationId: parentParticipation._id },
      {
        $setOnInsert: {
          userId: parentParticipation.userId,
          sourceParticipationId: parentParticipation._id,
          sourcePoolLevel: parentParticipation.poolLevel,
          targetPoolLevel: targetLevel,
          entryAmount,
          status: 'AVAILABLE',
          earnedAt: new Date(),
        },
      },
      { upsert: true, session }
    );
  }

  parentParticipation.cycleCount = nextCycleNumber;

  if (dist.isFinalCycle) {
    parentParticipation.status = 'COMPLETED';
    parentParticipation.completedAt = new Date();
    const releasedAt = shouldReleaseAfterCycle15(parentParticipation);
    if (releasedAt) {
      parentParticipation.releasedAt = releasedAt;
    }
  }

  let reenterParticipationId = null;

  // Same-pool continuation: FIFO child-slot re-entry (classic filler model)
  if (!dist.isFinalCycle && dist.samePoolAmount > 0) {
    await AutopoolLedger.create(
      [
        {
          idempotencyKey: `same-pool:${parentParticipation._id}:${nextCycleNumber}`,
          type: 'same_pool_continuation',
          amount: dist.samePoolAmount,
          userId: parentParticipation.userId,
          poolLevel: parentParticipation.poolLevel,
          participationId: parentParticipation._id,
          cycleId: cycle._id,
          allocationType: 'same_pool',
        },
      ],
      { session }
    );
    reenterParticipationId = parentParticipation._id;
  }

  await parentParticipation.save({ session });

  if (dist.isFinalCycle && parentParticipation.poolLevel === 10) {
    await maybeResetCreditsAfterPool10({
      userId: parentParticipation.userId,
      pool10ParticipationId: parentParticipation._id,
      session,
    });
  }

  return {
    cycle,
    alreadyProcessed: false,
    distribution: dist,
    reenterParticipationId,
  };
}

/**
 * Re-enter an occupying participation as FIFO filler (migration + manual repair).
 * Closes orphan WAITING root continuation seats for this participation first.
 */
async function reenterParticipationAsFiller({ participationId, session }) {
  const ownSession = !session;
  if (ownSession) {
    session = await mongoose.startSession();
    session.startTransaction();
  }
  try {
    await AutopoolPlacement.updateMany(
      {
        participationId,
        status: 'WAITING',
        parentParticipationId: null,
        openSlots: { $gt: 0 },
      },
      { $set: { openSlots: 0, status: 'CYCLE_DONE' } },
      { session }
    );

    const participation = await AutopoolParticipation.findById(participationId).session(
      session
    );
    if (!participation) {
      const err = new Error('Participation not found');
      err.code = 'NO_PARTICIPATION';
      throw err;
    }
    if (participation.releasedAt) {
      const err = new Error('Participation already released');
      err.code = 'ALREADY_RELEASED';
      throw err;
    }

    const result = await placeParticipation({ participation, session });

    if (ownSession) {
      await session.commitTransaction();
      session.endSession();
    }
    return result;
  } catch (err) {
    if (ownSession) {
      await session.abortTransaction();
      session.endSession();
    }
    throw err;
  }
}

module.exports = {
  placeParticipation,
  placeOne,
  completeCycleForParent,
  nextQueueSequence,
  claimOpenParent,
  reenterParticipationAsFiller,
};
