const mongoose = require('mongoose');
const crypto = require('crypto');
const {
  AutopoolParticipation,
  AutopoolNextPoolEligibility,
  AutopoolLedger,
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

function makeId(prefix) {
  return `${prefix}:${crypto.randomBytes(12).toString('hex')}`;
}

async function joinNextPool({ userId, targetPoolLevel, idempotencyKey }) {
  const level = Number(targetPoolLevel);
  if (!Number.isInteger(level) || level < 2 || level > 10) {
    const err = new Error('Target pool must be 2–10');
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

    const occupyingTarget = await findOccupyingParticipation(userId, level, session);
    if (occupyingTarget) {
      const err = new Error('Target pool is already occupying');
      err.code = 'TARGET_OCCUPYING';
      throw err;
    }

    const sourceLevel = level - 1;
    const eligibility = await AutopoolNextPoolEligibility.findOne({
      userId,
      sourcePoolLevel: sourceLevel,
      targetPoolLevel: level,
      status: 'AVAILABLE',
    })
      .sort({ earnedAt: 1 })
      .session(session);

    if (!eligibility) {
      const err = new Error('No available next-pool eligibility');
      err.code = 'NO_ELIGIBILITY';
      throw err;
    }

    const balance = await getBalance(userId, session);
    if (balance < 2) {
      const err = new Error('Insufficient upgrade credits');
      err.code = 'NO_UPGRADE_CREDIT';
      throw err;
    }

    await consumeCredit({
      userId,
      amount: 2,
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
      if (releasedAt) source.releasedAt = releasedAt;
      await source.save({ session });
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

module.exports = { joinNextPool };
