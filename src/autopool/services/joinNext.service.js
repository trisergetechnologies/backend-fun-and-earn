const mongoose = require('mongoose');
const crypto = require('crypto');
const {
  AutopoolParticipation,
  AutopoolNextPoolEligibility,
  AutopoolLedger,
  AutopoolWaitingRoom,
} = require('../models');
const {
  isAutopoolEnabled,
  getPoolConfig,
  snapshotFromConfig,
  seedPoolConfigs,
} = require('./config.service');
const { consumeCredit, getBalance } = require('./referralCredit.service');
const { placeParticipation } = require('./placement.service');
const { findOccupyingParticipation } = require('./entry.service');
const { shouldReleaseAfterUpgrade } = require('./release.rules');
const { markSeatJoined } = require('./waitingRoom.service');

function makeId(prefix) {
  return `${prefix}:${crypto.randomBytes(12).toString('hex')}`;
}

/**
 * Internal next-pool join used by Waiting Room cron only.
 * HTTP join-next is soft-closed (AUTO_JOIN_ENABLED).
 *
 * @param {object} opts
 * @param {string|ObjectId} opts.userId
 * @param {number} opts.targetPoolLevel
 * @param {string} [opts.idempotencyKey]
 * @param {string|ObjectId} [opts.waitingRoomSeatId] — if set, CAS-mark JOINED
 * @param {string|ObjectId} [opts.eligibilityId] — prefer this AVAILABLE eligibility
 */
async function executeNextPoolJoin({
  userId,
  targetPoolLevel,
  idempotencyKey,
  waitingRoomSeatId,
  eligibilityId,
}) {
  const level = Number(targetPoolLevel);
  if (!Number.isInteger(level) || level < 2 || level > 13) {
    const err = new Error('Target pool must be 2–13');
    err.code = 'INVALID_POOL';
    throw err;
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    await seedPoolConfigs(session);
    if (!(await isAutopoolEnabled(session))) {
      const err = new Error('Autopool is not enabled');
      err.code = 'AUTOPOOL_DISABLED';
      throw err;
    }

    const key = idempotencyKey || makeId('next-pool-join');
    const existingLedger = await AutopoolLedger.findOne({
      idempotencyKey: `next-pool-join:${key}`,
    }).session(session);
    if (existingLedger?.participationId) {
      const p = await AutopoolParticipation.findById(
        existingLedger.meta?.newParticipationId || existingLedger.participationId
      ).session(session);
      await session.commitTransaction();
      session.endSession();
      return { alreadyProcessed: true, participation: p };
    }

    // CAS waiting-room seat first so concurrent cron/manual cannot double-claim
    let wrSeat = null;
    if (waitingRoomSeatId) {
      wrSeat = await AutopoolWaitingRoom.findOneAndUpdate(
        { _id: waitingRoomSeatId, status: 'WAITING' },
        { $set: { status: 'JOINED', joinedAt: new Date() } },
        { new: true, session }
      );
      if (!wrSeat) {
        const err = new Error('Waiting room seat already processed');
        err.code = 'WR_SEAT_GONE';
        throw err;
      }
    }

    const occupyingTarget = await findOccupyingParticipation(userId, level, session);
    if (occupyingTarget) {
      // Roll back WR CAS if we claimed it
      if (wrSeat) {
        wrSeat.status = 'WAITING';
        wrSeat.joinedAt = null;
        await wrSeat.save({ session });
      }
      const err = new Error('Target pool is already occupying');
      err.code = 'TARGET_OCCUPYING';
      throw err;
    }

    const sourceLevel = level - 1;
    let eligibility = null;
    if (eligibilityId) {
      eligibility = await AutopoolNextPoolEligibility.findOne({
        _id: eligibilityId,
        userId,
        status: 'AVAILABLE',
      }).session(session);
    }
    if (!eligibility) {
      eligibility = await AutopoolNextPoolEligibility.findOne({
        userId,
        sourcePoolLevel: sourceLevel,
        targetPoolLevel: level,
        status: 'AVAILABLE',
      })
        .sort({ earnedAt: 1 })
        .session(session);
    }

    if (!eligibility) {
      if (wrSeat) {
        wrSeat.status = 'WAITING';
        wrSeat.joinedAt = null;
        await wrSeat.save({ session });
      }
      const err = new Error('No available next-pool eligibility');
      err.code = 'NO_ELIGIBILITY';
      throw err;
    }

    const balance = await getBalance(userId, session);
    if (balance < 1) {
      if (wrSeat) {
        wrSeat.status = 'WAITING';
        wrSeat.joinedAt = null;
        await wrSeat.save({ session });
      }
      const err = new Error('Insufficient upgrade credits');
      err.code = 'NO_UPGRADE_CREDIT';
      throw err;
    }

    await consumeCredit({
      userId,
      amount: 1,
      idempotencyKey: `credit-spend:${key}`,
      joinIdempotencyKey: key,
      reason: `join_pool_${level}`,
      session,
    });

    eligibility.status = 'CONSUMED';
    eligibility.consumedAt = new Date();

    const config = await getPoolConfig(level, session);
    if (!config) {
      const err = new Error(`Pool ${level} is not configured`);
      err.code = 'POOL_INACTIVE';
      throw err;
    }
    const snapshot = snapshotFromConfig(config);

    const [participation] = await AutopoolParticipation.create(
      [
        {
          userId,
          poolLevel: level,
          status: 'PENDING',
          entryAmount: eligibility.entryAmount || snapshot.entryAmount,
          cycleCount: 0,
          entryType: 'next_pool',
          configSnapshot: snapshot,
          fundedByParticipationId: eligibility.sourceParticipationId,
          nextPoolEligibleAmount: 0,
        },
      ],
      { session }
    );

    eligibility.consumedByParticipationId = participation._id;
    await eligibility.save({ session });

    const source = await AutopoolParticipation.findById(
      eligibility.sourceParticipationId
    ).session(session);
    if (source) {
      source.upgradeUsedAt = new Date();
      const releasedAt = shouldReleaseAfterUpgrade(source);
      if (releasedAt && !source.releasedAt) source.releasedAt = releasedAt;
      await source.save({ session });
    }

    if (wrSeat) {
      wrSeat.joinedParticipationId = participation._id;
      await wrSeat.save({ session });
    } else if (waitingRoomSeatId) {
      await markSeatJoined(waitingRoomSeatId, participation._id, session);
    } else {
      // Mark any WAITING seat for this source as JOINED
      await AutopoolWaitingRoom.findOneAndUpdate(
        {
          sourceParticipationId: eligibility.sourceParticipationId,
          status: 'WAITING',
        },
        {
          $set: {
            status: 'JOINED',
            joinedAt: new Date(),
            joinedParticipationId: participation._id,
          },
        },
        { session }
      );
    }

    await AutopoolLedger.create(
      [
        {
          idempotencyKey: `next-pool-join:${key}`,
          type: 'next_pool_join_consume',
          amount: eligibility.entryAmount,
          userId,
          poolLevel: level,
          participationId: participation._id,
          allocationType: 'next_pool_join',
          meta: {
            eligibilityId: eligibility._id,
            sourceParticipationId: eligibility.sourceParticipationId,
            newParticipationId: participation._id,
            waitingRoomSeatId: waitingRoomSeatId || null,
          },
        },
      ],
      { session }
    );

    await placeParticipation({ participation, session });

    await session.commitTransaction();
    session.endSession();

    const fresh = await AutopoolParticipation.findById(participation._id);
    return { alreadyProcessed: false, participation: fresh, eligibility };
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    throw err;
  }
}

/**
 * @deprecated HTTP path soft-closed. Kept for tests / internal callers.
 * Prefer executeNextPoolJoin from cron.
 */
async function joinNextPool(opts) {
  return executeNextPoolJoin(opts);
}

module.exports = { joinNextPool, executeNextPoolJoin };
