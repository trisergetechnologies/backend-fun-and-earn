const {
  AutopoolParticipation,
  AutopoolNextPoolEligibility,
  AutopoolCycle,
  AutopoolReferralEvent,
  AutopoolUpgradeCreditLedger,
  AutopoolPoolConfig,
} = require('../models');
const { ensureSettings, seedPoolConfigs, isAutopoolEnabled } = require('./config.service');
const { getBalance } = require('./referralCredit.service');
const { isPoolReleased } = require('./release.rules');
const { findOccupyingParticipation } = require('./entry.service');

async function getOverview(userId) {
  await seedPoolConfigs();
  const settings = await ensureSettings();
  const enabled = Boolean(settings.enabled);

  const creditBalance = await getBalance(userId);
  const configs = await AutopoolPoolConfig.find({}).sort({ poolLevel: 1 }).lean();

  const occupying = await AutopoolParticipation.find({
    userId,
    releasedAt: null,
  }).lean();

  const eligibilities = await AutopoolNextPoolEligibility.find({
    userId,
    status: 'AVAILABLE',
  }).lean();

  const pools = [];
  for (const cfg of configs) {
    const part = occupying.find((p) => p.poolLevel === cfg.poolLevel);
    const elig = eligibilities.find((e) => e.targetPoolLevel === cfg.poolLevel);
    const sourceElig = eligibilities.find((e) => e.sourcePoolLevel === cfg.poolLevel);

    let joinPool1 = null;
    let joinNext = null;

    if (cfg.poolLevel === 1) {
      const reasons = [];
      if (!enabled) reasons.push('AUTOPOOL_DISABLED');
      if (part) reasons.push('POOL_OCCUPYING');
      joinPool1 = {
        allowed: reasons.length === 0 && enabled,
        reasons,
        entryAmount: cfg.entryAmount,
      };
    } else {
      const reasons = [];
      if (!enabled) reasons.push('AUTOPOOL_DISABLED');
      if (part) reasons.push('TARGET_OCCUPYING');
      if (!elig) reasons.push('NO_ELIGIBILITY');
      if (creditBalance < 1) reasons.push('NO_UPGRADE_CREDIT');
      joinNext = {
        allowed: reasons.length === 0,
        reasons,
        eligibility: elig || null,
        entryAmount: elig?.entryAmount || cfg.entryAmount,
      };
    }

    pools.push({
      poolLevel: cfg.poolLevel,
      entryAmount: cfg.entryAmount,
      occupying: Boolean(part),
      released: part ? isPoolReleased(part) : true,
      participation: part
        ? {
            id: part._id,
            status: part.status,
            cycleCount: part.cycleCount,
            maxCycles: part.configSnapshot?.maxCycles ?? 15,
            upgradeUsedAt: part.upgradeUsedAt,
            releasedAt: part.releasedAt,
            nextPoolEligibleAmount: part.nextPoolEligibleAmount,
          }
        : null,
      sourceEligibility: sourceElig || null,
      joinPool1,
      joinNext,
    });
  }

  return {
    enabled,
    creditBalance,
    pools,
  };
}

async function getPoolDetail(userId, poolLevel) {
  const level = Number(poolLevel);
  const part = await findOccupyingParticipation(userId, level);
  const history = await AutopoolParticipation.find({ userId, poolLevel: level })
    .sort({ createdAt: -1 })
    .limit(20)
    .lean();

  let cycles = [];
  if (part) {
    cycles = await AutopoolCycle.find({ participationId: part._id })
      .sort({ cycleNumber: 1 })
      .lean();
  }

  return { participation: part, history, cycles };
}

async function getCredits(userId) {
  const balance = await getBalance(userId);
  const ledger = await AutopoolUpgradeCreditLedger.find({ userId })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();
  return { balance, ledger };
}

async function getReferrals(userId) {
  const asReferrer = await AutopoolReferralEvent.find({ referrerUserId: userId })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();
  const asReferred = await AutopoolReferralEvent.find({ referredUserId: userId })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();
  return { asReferrer, asReferred };
}

async function getParticipationDetail(userId, participationId) {
  const part = await AutopoolParticipation.findOne({
    _id: participationId,
    userId,
  }).lean();
  if (!part) return null;
  const cycles = await AutopoolCycle.find({ participationId: part._id })
    .sort({ cycleNumber: 1 })
    .lean();
  const eligibility = await AutopoolNextPoolEligibility.findOne({
    sourceParticipationId: part._id,
  }).lean();
  return { participation: part, cycles, eligibility };
}

module.exports = {
  getOverview,
  getPoolDetail,
  getCredits,
  getReferrals,
  getParticipationDetail,
  isAutopoolEnabled,
};
