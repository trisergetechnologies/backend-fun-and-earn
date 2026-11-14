const mongoose = require('mongoose');
const crypto = require('crypto');
const User = require('../../models/User');
const {
  AutopoolParticipation,
  AutopoolReferralEvent,
  AutopoolLedger,
} = require('../models');
const {
  isAutopoolEnabled,
  getPoolConfig,
  snapshotFromConfig,
  ensureSettings,
  seedPoolConfigs,
} = require('./config.service');
const { debitEcartForAutopool } = require('./wallet.service');
const { addCredit, consumeCredit, getBalance } = require('./referralCredit.service');
const { placeParticipation } = require('./placement.service');
const { isPoolReleased } = require('./release.rules');
const { userHasWaitingSeat } = require('./waitingRoom.service');
const {
  LEGAL_NOTICE_VERSION,
  LEGAL_NOTICE_TEXT,
} = require('../constants/legalNotice');

const MANUAL_PASS_COST = { 2: 2, 3: 3 };

function makeId(prefix) {
  return `${prefix}:${crypto.randomBytes(12).toString('hex')}`;
}

async function findOccupyingParticipation(userId, poolLevel, session) {
  return AutopoolParticipation.findOne({
    userId,
    poolLevel,
    releasedAt: null,
  }).session(session || null);
}

async function userHasOccupyingAnyPool(userId, session) {
  const list = await AutopoolParticipation.find({
    userId,
    releasedAt: null,
  }).session(session || null);
  return list.some((p) => !isPoolReleased(p) || p.status !== 'COMPLETED' || !p.releasedAt);
}

/**
 * Simpler occupying check: any doc with releasedAt null counts as occupying.
 */
async function isUserOccupyingAnyPool(userId, session) {
  const count = await AutopoolParticipation.countDocuments({
    userId,
    releasedAt: null,
  }).session(session || null);
  return count > 0;
}

async function joinPool1Manual({
  userId,
  referrerSerialNumber,
  idempotencyKey,
  legalNoticeAccepted,
}) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    await seedPoolConfigs(session);
    const enabled = await isAutopoolEnabled(session);
    if (!enabled) {
      const err = new Error('Loyalty Pool is not enabled');
      err.code = 'AUTOPOOL_DISABLED';
      throw err;
    }

    if (!legalNoticeAccepted) {
      const err = new Error('You must accept the Important Legal Notice to join');
      err.code = 'LEGAL_NOTICE_REQUIRED';
      throw err;
    }

    const key = idempotencyKey || makeId('manual-entry');
    const existingEvent = await AutopoolReferralEvent.findOne({
      manualEntryId: key,
    }).session(session);
    if (existingEvent) {
      const participation = await AutopoolParticipation.findById(
        existingEvent.participationId
      ).session(session);
      await session.commitTransaction();
      session.endSession();
      return { alreadyProcessed: true, participation, referralEvent: existingEvent };
    }

    const user = await User.findById(userId).session(session);
    if (!user) {
      const err = new Error('User not found');
      err.code = 'USER_NOT_FOUND';
      throw err;
    }
    if (!user.package) {
      const err = new Error('Package purchase required for Loyalty Pool entry');
      err.code = 'NO_PACKAGE';
      throw err;
    }

    const occupying = await findOccupyingParticipation(userId, 1, session);
    if (occupying) {
      const err = new Error('Pool 1 is still occupying — finish and release before re-entry');
      err.code = 'POOL_OCCUPYING';
      throw err;
    }

    const sn = Number(String(referrerSerialNumber).replace(/^#/, '').trim());
    if (!Number.isFinite(sn)) {
      const err = new Error('Invalid referrer serial number');
      err.code = 'INVALID_SN';
      throw err;
    }

    const referrer = await User.findOne({ serialNumber: sn }).session(session);
    if (!referrer) {
      const err = new Error('Referrer serial number not found');
      err.code = 'INVALID_SN';
      throw err;
    }
    if (String(referrer._id) === String(userId)) {
      const err = new Error('Self-referral is not allowed');
      err.code = 'SELF_REFERRAL';
      throw err;
    }

    const referrerOccupying = await isUserOccupyingAnyPool(referrer._id, session);
    if (!referrerOccupying) {
      const err = new Error('Referrer must be active in Loyalty Pool — enter a valid SN');
      err.code = 'REFERRER_NOT_ACTIVE';
      throw err;
    }

    const config = await getPoolConfig(1, session);
    if (!config) {
      const err = new Error('Pool 1 is not configured');
      err.code = 'POOL_INACTIVE';
      throw err;
    }

    const snapshot = snapshotFromConfig(config);
    const entryAmount = snapshot.entryAmount;
    const acceptedAt = new Date();

    await debitEcartForAutopool({
      userId,
      amount: entryAmount,
      idempotencyKey: `manual-entry-debit:${key}`,
      session,
      poolLevel: 1,
      notes: `Loyalty Pool Pool 1 entry ${key}`,
    });

    const [participation] = await AutopoolParticipation.create(
      [
        {
          userId,
          poolLevel: 1,
          status: 'PENDING',
          entryAmount,
          cycleCount: 0,
          entryType: 'manual',
          configSnapshot: snapshot,
          manualEntryId: key,
          nextPoolEligibleAmount: 0,
          legalNoticeAccepted: true,
          legalNoticeAcceptedAt: acceptedAt,
          legalNoticeVersion: LEGAL_NOTICE_VERSION,
          legalNoticeText: LEGAL_NOTICE_TEXT,
        },
      ],
      { session }
    );

    // Fix ledger participationId if needed — re-debit already wrote ledger
    const eventId = makeId('ref-event');
    const [referralEvent] = await AutopoolReferralEvent.create(
      [
        {
          eventId,
          manualEntryId: key,
          referrerUserId: referrer._id,
          referredUserId: userId,
          referrerSerialNumber: sn,
          participationId: participation._id,
          poolLevel: 1,
          source: 'manual_dream_points_entry',
        },
      ],
      { session }
    );

    await addCredit({
      userId: referrer._id,
      amount: 1,
      idempotencyKey: `credit-earn:${eventId}`,
      referralEventId: eventId,
      reason: 'manual_pool1_referral',
      session,
    });

    await placeParticipation({ participation, session });

    await session.commitTransaction();
    session.endSession();

    const fresh = await AutopoolParticipation.findById(participation._id);
    return {
      alreadyProcessed: false,
      participation: fresh,
      referralEvent,
    };
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    throw err;
  }
}

/**
 * Manual DreamMart entry for Pool 2 or 3.
 * No SN / no referrer credit. Consumes 2 (P2) or 3 (P3) upgrade passes.
 * Requires ≥1 other occupying pool ≠ target; blocks if WR seat exists for target.
 */
async function joinPoolManual({
  userId,
  poolLevel,
  idempotencyKey,
  legalNoticeAccepted,
}) {
  const level = Number(poolLevel);
  if (level !== 2 && level !== 3) {
    const err = new Error('Manual entry is only available for Pool 2 or Pool 3');
    err.code = 'INVALID_POOL';
    throw err;
  }

  const passesRequired = MANUAL_PASS_COST[level];
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    await seedPoolConfigs(session);
    if (!(await isAutopoolEnabled(session))) {
      const err = new Error('Loyalty Pool is not enabled');
      err.code = 'AUTOPOOL_DISABLED';
      throw err;
    }

    if (!legalNoticeAccepted) {
      const err = new Error('You must accept the Important Legal Notice to join');
      err.code = 'LEGAL_NOTICE_REQUIRED';
      throw err;
    }

    const key = idempotencyKey || makeId(`manual-p${level}`);
    const existingLedger = await AutopoolLedger.findOne({
      idempotencyKey: `manual-pool-join:${key}`,
    }).session(session);
    if (existingLedger?.participationId) {
      const participation = await AutopoolParticipation.findById(
        existingLedger.participationId
      ).session(session);
      await session.commitTransaction();
      session.endSession();
      return { alreadyProcessed: true, participation };
    }

    const existingByManualId = await AutopoolParticipation.findOne({
      manualEntryId: key,
    }).session(session);
    if (existingByManualId) {
      await session.commitTransaction();
      session.endSession();
      return { alreadyProcessed: true, participation: existingByManualId };
    }

    const user = await User.findById(userId).session(session);
    if (!user) {
      const err = new Error('User not found');
      err.code = 'USER_NOT_FOUND';
      throw err;
    }
    if (!user.package) {
      const err = new Error('Package purchase required for Loyalty Pool entry');
      err.code = 'NO_PACKAGE';
      throw err;
    }

    const occupyingTarget = await findOccupyingParticipation(userId, level, session);
    if (occupyingTarget) {
      const err = new Error(
        `Pool ${level} is still occupying — finish and release before another entry`
      );
      err.code = 'POOL_OCCUPYING';
      throw err;
    }

    if (await userHasWaitingSeat(userId, level, session)) {
      const err = new Error(
        `You already have a Waiting Room seat for Pool ${level}. Manual entry is blocked until that upgrade completes.`
      );
      err.code = 'WAITING_ROOM_PENDING';
      throw err;
    }

    const otherOccupying = await AutopoolParticipation.countDocuments({
      userId,
      poolLevel: { $ne: level },
      releasedAt: null,
    }).session(session);
    if (otherOccupying < 1) {
      const err = new Error(
        `Manual Pool ${level} entry requires at least one active participation in another pool`
      );
      err.code = 'NO_OTHER_OCCUPYING';
      throw err;
    }

    const balance = await getBalance(userId, session);
    if (balance < passesRequired) {
      const err = new Error(
        `Need ${passesRequired} referral passes for Pool ${level} (you have ${balance})`
      );
      err.code = 'NO_UPGRADE_CREDIT';
      throw err;
    }

    const config = await getPoolConfig(level, session);
    if (!config || !config.active) {
      const err = new Error(`Pool ${level} is not configured or inactive`);
      err.code = 'POOL_INACTIVE';
      throw err;
    }

    const snapshot = snapshotFromConfig(config);
    const entryAmount = snapshot.entryAmount;
    const acceptedAt = new Date();

    await debitEcartForAutopool({
      userId,
      amount: entryAmount,
      idempotencyKey: `manual-entry-debit:${key}`,
      session,
      poolLevel: level,
      notes: `Loyalty Pool Pool ${level} manual entry ${key}`,
    });

    await consumeCredit({
      userId,
      amount: passesRequired,
      idempotencyKey: `credit-spend:manual-p${level}:${key}`,
      joinIdempotencyKey: key,
      reason: `manual_pool_${level}_entry`,
      session,
    });

    const [participation] = await AutopoolParticipation.create(
      [
        {
          userId,
          poolLevel: level,
          status: 'PENDING',
          entryAmount,
          cycleCount: 0,
          entryType: 'manual',
          configSnapshot: snapshot,
          manualEntryId: key,
          nextPoolEligibleAmount: 0,
          legalNoticeAccepted: true,
          legalNoticeAcceptedAt: acceptedAt,
          legalNoticeVersion: LEGAL_NOTICE_VERSION,
          legalNoticeText: LEGAL_NOTICE_TEXT,
        },
      ],
      { session }
    );

    await AutopoolLedger.create(
      [
        {
          idempotencyKey: `manual-pool-join:${key}`,
          type: 'manual_pool_entry',
          amount: entryAmount,
          userId,
          poolLevel: level,
          participationId: participation._id,
          allocationType: 'manual_entry',
          meta: {
            passesConsumed: passesRequired,
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
    return { alreadyProcessed: false, participation: fresh };
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    throw err;
  }
}

/**
 * Admin bootstrap: create occupying Pool-1 for a user without debit/referral.
 */
async function bootstrapRootUser({ userId, adminUserId }) {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    await seedPoolConfigs(session);
    const settings = await ensureSettings(session);

    const existing = await findOccupyingParticipation(userId, 1, session);
    if (existing) {
      settings.bootstrapUserId = userId;
      await settings.save({ session });
      await session.commitTransaction();
      session.endSession();
      return { alreadyProcessed: true, participation: existing };
    }

    const config = await getPoolConfig(1, session);
    const snapshot = snapshotFromConfig(config);
    const manualEntryId = makeId('bootstrap');

    const [participation] = await AutopoolParticipation.create(
      [
        {
          userId,
          poolLevel: 1,
          status: 'PENDING',
          entryAmount: snapshot.entryAmount,
          cycleCount: 0,
          entryType: 'bootstrap',
          configSnapshot: snapshot,
          manualEntryId,
          isBootstrap: true,
        },
      ],
      { session }
    );

    await placeParticipation({ participation, session });

    settings.bootstrapUserId = userId;
    await settings.save({ session });

    await session.commitTransaction();
    session.endSession();

    const fresh = await AutopoolParticipation.findById(participation._id);
    return { alreadyProcessed: false, participation: fresh, adminUserId };
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    throw err;
  }
}

module.exports = {
  joinPool1Manual,
  joinPoolManual,
  bootstrapRootUser,
  findOccupyingParticipation,
  isUserOccupyingAnyPool,
  userHasOccupyingAnyPool,
  MANUAL_PASS_COST,
};
