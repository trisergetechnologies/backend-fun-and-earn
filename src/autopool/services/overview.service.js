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

  const [creditBalance, configs, occupying, eligibilities, allUserCycles] = await Promise.all([
    getBalance(userId),
    AutopoolPoolConfig.find({}).sort({ poolLevel: 1 }).lean(),
    AutopoolParticipation.find({ userId, releasedAt: null }).lean(),
    AutopoolNextPoolEligibility.find({ userId, status: 'AVAILABLE' }).lean(),
    AutopoolCycle.find({ userId }).select('poolLevel cycleNumber walletAmount').lean(),
  ]);

  let totalEarnings = 0;
  const poolEarningsMap = {};
  for (const c of allUserCycles) {
    const amt = Number(c.walletAmount) || 0;
    totalEarnings += amt;
    poolEarningsMap[c.poolLevel] = (poolEarningsMap[c.poolLevel] || 0) + amt;
  }

  const pools = [];
  for (const cfg of configs) {
    const part = occupying.find((p) => p.poolLevel === cfg.poolLevel);
    const elig = eligibilities.find((e) => e.targetPoolLevel === cfg.poolLevel);
    const sourceElig = eligibilities.find((e) => e.sourcePoolLevel === cfg.poolLevel);

    const nextCfg = configs.find((x) => x.poolLevel === cfg.poolLevel + 1);
    const nextPoolTarget = nextCfg ? nextCfg.entryAmount : 0;
    const nextPoolReserve = part ? (part.nextPoolEligibleAmount || 0) : 0;
    const poolEarnings = poolEarningsMap[cfg.poolLevel] || 0;

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
      poolEarnings,
      nextPoolReserve,
      nextPoolTarget,
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
    totalEarnings,
    pools,
  };
}

async function getPoolDetail(userId, poolLevel) {
  const level = Number(poolLevel);
  const configs = await AutopoolPoolConfig.find({}).sort({ poolLevel: 1 }).lean();
  const currentCfg = configs.find((x) => x.poolLevel === level);
  const nextCfg = configs.find((x) => x.poolLevel === level + 1);
  const nextPoolTarget = nextCfg ? nextCfg.entryAmount : 0;

  const part = await findOccupyingParticipation(userId, level);
  const history = await AutopoolParticipation.find({ userId, poolLevel: level })
    .sort({ createdAt: -1 })
    .limit(20)
    .lean();

  let cycles = [];
  let poolEarnings = 0;
  if (part) {
    cycles = await AutopoolCycle.find({ participationId: part._id })
      .sort({ cycleNumber: 1 })
      .lean();
    poolEarnings = cycles.reduce((acc, c) => acc + (Number(c.walletAmount) || 0), 0);
  }

  return {
    participation: part,
    history,
    cycles,
    poolEarnings,
    nextPoolReserve: part?.nextPoolEligibleAmount || 0,
    nextPoolTarget,
    entryAmount: currentCfg?.entryAmount || 500,
  };
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
