const crypto = require('crypto');
const User = require('../../models/User');
const Package = require('../../models/Package');
const { hashPassword } = require('../../utils/bcrypt');
const {
  AutopoolParticipation,
  AutopoolPlacement,
  AutopoolCycle,
  AutopoolLedger,
  AutopoolReferralEvent,
  AutopoolNextPoolEligibility,
  AutopoolUpgradeCreditLedger,
  AutopoolUserCredit,
} = require('../models');
const { getPoolConfig, snapshotFromConfig, seedPoolConfigs } = require('./config.service');
const { placeParticipation } = require('./placement.service');
const mongoose = require('mongoose');

const E2E_EMAIL_RE = /^e2e\.autopool\.[a-z0-9._+-]+@test\.local$/i;

function e2eAllowed() {
  return (
    process.env.NODE_ENV === 'development' ||
    process.env.AUTOPOOL_E2E_ALLOW === 'true'
  );
}

function assertE2eAllowed() {
  if (!e2eAllowed()) {
    const err = new Error('Autopool E2E helpers are disabled outside development');
    err.code = 'E2E_FORBIDDEN';
    throw err;
  }
}

function assertE2eEmail(email) {
  if (!E2E_EMAIL_RE.test(email)) {
    const err = new Error('E2E provision only allows emails matching e2e.autopool.*@test.local');
    err.code = 'E2E_EMAIL_INVALID';
    throw err;
  }
}

async function nextSerial() {
  const last = await User.findOne({ serialNumber: { $ne: null } })
    .sort({ serialNumber: -1 })
    .select('serialNumber');
  return (last?.serialNumber || 1000) + 1;
}

/**
 * Upsert E2E user with package + eCart balance.
 */
async function provisionUser({
  email,
  password = 'Test@1234',
  eCartBalance,
  packageName = 'Basic',
  name,
  referredBy = null,
  withPackage = true,
}) {
  assertE2eAllowed();
  assertE2eEmail(email);

  // undefined = leave existing wallet alone (wallet-read path); null/number = set
  const hasBalance = eCartBalance !== undefined;

  let pkg = null;
  if (withPackage) {
    pkg = await Package.findOneAndUpdate(
      { name: packageName },
      {
        $setOnInsert: {
          name: packageName,
          price: 500,
          membersUpto: 2,
          levelUpto: 1,
          isActive: true,
          description: `${packageName} (e2e)`,
        },
      },
      { upsert: true, new: true }
    );
  }

  let user = await User.findOne({ email });
  const hashed = await hashPassword(password);

  if (!user) {
    const serialNumber = await nextSerial();
    const referralCode = `E2E${serialNumber}${crypto.randomBytes(2).toString('hex')}`;
    const initialWallet = hasBalance ? Number(eCartBalance) || 0 : 50000;
    user = await User.create({
      name: name || `E2E ${serialNumber}`,
      email,
      phone: `9${String(Date.now()).slice(-8)}${String(serialNumber).slice(-1)}`.slice(0, 10),
      password: hashed,
      gender: 'other',
      role: 'user',
      applications: ['shortVideo', 'eCart'],
      referralCode,
      referredBy: referredBy || null,
      serialNumber,
      ...(withPackage && pkg ? { package: pkg._id } : {}),
      wallets: {
        shortVideoWallet: 0,
        eCartWallet: initialWallet,
        rewardWallet: [],
      },
      isActive: true,
    });
  } else {
    user.password = hashed;
    user.applications = Array.from(
      new Set([...(user.applications || []), 'shortVideo', 'eCart'])
    );
    if (withPackage) user.package = pkg._id;
    else user.package = null;
    user.wallets = user.wallets || {};
    if (hasBalance) {
      user.wallets.eCartWallet = Number(eCartBalance) || 0;
    }
    if (!user.serialNumber) user.serialNumber = await nextSerial();
    if (!user.referralCode) user.referralCode = `E2E${user.serialNumber}`;
    if (referredBy !== null && referredBy !== undefined) user.referredBy = referredBy;
    await user.save();
  }

  // Re-read so wallet reflects DB after create/save
  user = await User.findById(user._id);

  return {
    userId: user._id,
    serialNumber: user.serialNumber,
    email: user.email,
    referralCode: user.referralCode,
    referredBy: user.referredBy,
    eCartWallet: user.wallets?.eCartWallet ?? 0,
    hasPackage: Boolean(user.package),
  };
}

/**
 * Delete Autopool data for E2E users only (by email prefix), and optionally the users.
 */
async function resetE2eAutopoolData({ deleteUsers = false } = {}) {
  assertE2eAllowed();
  const users = await User.find({ email: E2E_EMAIL_RE }).select('_id email');
  const ids = users.map((u) => u._id);
  if (!ids.length) {
    return { users: 0, deleted: {} };
  }

  const deleted = {
    participations: await AutopoolParticipation.deleteMany({ userId: { $in: ids } }),
    placements: await AutopoolPlacement.deleteMany({ userId: { $in: ids } }),
    cycles: await AutopoolCycle.deleteMany({ userId: { $in: ids } }),
    ledgers: await AutopoolLedger.deleteMany({ userId: { $in: ids } }),
    referrals: await AutopoolReferralEvent.deleteMany({
      $or: [{ referrerUserId: { $in: ids } }, { referredUserId: { $in: ids } }],
    }),
    eligibilities: await AutopoolNextPoolEligibility.deleteMany({ userId: { $in: ids } }),
    creditLedgers: await AutopoolUpgradeCreditLedger.deleteMany({ userId: { $in: ids } }),
    credits: await AutopoolUserCredit.deleteMany({ userId: { $in: ids } }),
  };

  if (deleteUsers) {
    deleted.users = await User.deleteMany({ _id: { $in: ids } });
  }

  return {
    users: ids.length,
    deleted: Object.fromEntries(
      Object.entries(deleted).map(([k, v]) => [k, v.deletedCount ?? v])
    ),
  };
}

/**
 * Create occupying participation at any pool level (for Pool10 E2E setup).
 * Uses same placement engine as production.
 */
async function bootstrapPoolParticipation({ userId, poolLevel }) {
  assertE2eAllowed();
  await seedPoolConfigs();
  const level = Number(poolLevel);
  const existing = await AutopoolParticipation.findOne({
    userId,
    poolLevel: level,
    releasedAt: null,
  });
  if (existing) {
    return { alreadyProcessed: true, participation: existing };
  }

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const config = await getPoolConfig(level, session);
    if (!config) {
      const err = new Error(`Pool ${level} not configured`);
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
          entryAmount: snapshot.entryAmount,
          cycleCount: 0,
          entryType: 'bootstrap',
          configSnapshot: snapshot,
          manualEntryId: `e2e-bootstrap:${level}:${userId}:${Date.now()}`,
          isBootstrap: true,
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
 * Place a filler participation into a pool (same placeParticipation path).
 * Used to fill matrix seats when Join P1 cannot target a non-P1 pool.
 */
async function placeFillerInPool({ userId, poolLevel }) {
  assertE2eAllowed();
  await seedPoolConfigs();
  const level = Number(poolLevel);

  const occupying = await AutopoolParticipation.findOne({
    userId,
    poolLevel: level,
    releasedAt: null,
  });
  if (occupying) {
    const err = new Error('Filler already occupying this pool');
    err.code = 'POOL_OCCUPYING';
    throw err;
  }

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const config = await getPoolConfig(level, session);
    const snapshot = snapshotFromConfig(config);
    const [participation] = await AutopoolParticipation.create(
      [
        {
          userId,
          poolLevel: level,
          status: 'PENDING',
          entryAmount: snapshot.entryAmount,
          cycleCount: 0,
          entryType: 'bootstrap',
          configSnapshot: snapshot,
          manualEntryId: `e2e-filler:${level}:${userId}:${Date.now()}`,
          isBootstrap: true,
        },
      ],
      { session }
    );
    const result = await placeParticipation({ participation, session });
    // Leaf-only: fillers must not become FIFO parents or they starve the subject under test.
    if (result.placement) {
      result.placement.openSlots = 0;
      await result.placement.save({ session });
    }
    await session.commitTransaction();
    session.endSession();
    return {
      participation: await AutopoolParticipation.findById(participation._id),
      cycleResult: result.cycleResult,
    };
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    throw err;
  }
}

/**
 * Advance a subject's cycleCount to target by placing leaf fillers,
 * sealing any other open seats in that pool so FIFO cannot starve them.
 */
async function advanceCycles({ userId, poolLevel, targetCycleCount }) {
  assertE2eAllowed();
  const level = Number(poolLevel);
  const target = Number(targetCycleCount);

  let participation = await AutopoolParticipation.findOne({
    userId,
    poolLevel: level,
    releasedAt: null,
  });
  if (!participation) {
    const err = new Error(`No occupying participation in pool ${level}`);
    err.code = 'NO_PARTICIPATION';
    throw err;
  }

  let guard = 0;
  const maxGuard = Math.max(target * 4, 20);
  while ((participation.cycleCount || 0) < target && guard < maxGuard) {
    guard += 1;

    // Only this user's open seats may receive fillers
    await AutopoolPlacement.updateMany(
      {
        poolLevel: level,
        openSlots: { $gt: 0 },
        userId: { $ne: userId },
      },
      { $set: { openSlots: 0 } }
    );

    const before = participation.cycleCount || 0;
    for (let i = 0; i < 2; i++) {
      const fillerUser = await provisionUser({
        email: `e2e.autopool.fill${level}.${Date.now()}.${i}.${guard}@test.local`,
        eCartBalance: 1000,
      });
      await placeFillerInPool({ userId: fillerUser.userId, poolLevel: level });
    }

    participation = await AutopoolParticipation.findById(participation._id);
    if ((participation.cycleCount || 0) === before) {
      // No progress — likely no open seat for subject (waiting for re-queue)
      continue;
    }
  }

  if ((participation.cycleCount || 0) < target) {
    const err = new Error(
      `advanceCycles stuck at ${participation.cycleCount} (want ${target}) after ${guard} rounds`
    );
    err.code = 'ADVANCE_STUCK';
    throw err;
  }

  return { participation };
}

module.exports = {
  e2eAllowed,
  E2E_EMAIL_RE,
  provisionUser,
  resetE2eAutopoolData,
  bootstrapPoolParticipation,
  placeFillerInPool,
  advanceCycles,
};
