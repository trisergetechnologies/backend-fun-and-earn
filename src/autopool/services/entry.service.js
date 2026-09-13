const mongoose = require('mongoose');
const crypto = require('crypto');
const User = require('../../models/User');
const {
  AutopoolParticipation,
  AutopoolReferralEvent,
} = require('../models');
const {
  isAutopoolEnabled,
  getPoolConfig,
  snapshotFromConfig,
  ensureSettings,
  seedPoolConfigs,
} = require('./config.service');
const { debitEcartForAutopool } = require('./wallet.service');
const { addCredit } = require('./referralCredit.service');
const { placeParticipation } = require('./placement.service');
const { isPoolReleased } = require('./release.rules');
const {
  LEGAL_NOTICE_VERSION,
  LEGAL_NOTICE_TEXT,
} = require('../constants/legalNotice');

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
  bootstrapRootUser,
  findOccupyingParticipation,
  isUserOccupyingAnyPool,
  userHasOccupyingAnyPool,
};
