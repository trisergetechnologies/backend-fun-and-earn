const {
  AutopoolParticipation,
  AutopoolNextPoolEligibility,
  AutopoolCycle,
  AutopoolReferralEvent,
  AutopoolUpgradeCreditLedger,
  AutopoolPoolConfig,
  AutopoolPlacement,
} = require('../models');
const { ensureSettings, seedPoolConfigs, isAutopoolEnabled } = require('./config.service');
const { getBalance } = require('./referralCredit.service');
const { isPoolReleased } = require('./release.rules');
const { findOccupyingParticipation } = require('./entry.service');

function calculateWaitingJoinsNeeded(participation, openPlacements) {
  if (!participation) return { joinsNeeded: null, isLastCycle: false };
  const maxCycles = participation.configSnapshot?.maxCycles ?? 15;
  const cycleCount = participation.cycleCount || 0;
  const isLastCycle = cycleCount === maxCycles - 1;

  if (cycleCount >= maxCycles) {
    return { joinsNeeded: null, isLastCycle: false };
  }

  const poolOpenPlacements = (openPlacements || []).filter(
    (p) => p.poolLevel === participation.poolLevel
  );
  const openQueueIndex = poolOpenPlacements.findIndex(
    (p) => String(p.participationId) === String(participation._id)
  );

  if (openQueueIndex < 0) {
    return { joinsNeeded: null, isLastCycle };
  }

  let slotsAhead = 0;
  for (let i = 0; i < openQueueIndex; i += 1) {
    slotsAhead += poolOpenPlacements[i].openSlots || 0;
  }
  const openSlotsRemaining = poolOpenPlacements[openQueueIndex].openSlots || 0;
  const joinsNeeded = slotsAhead + openSlotsRemaining;

  return { joinsNeeded, isLastCycle };
}

async function getOverview(userId) {
  const [creditBalance, configs, occupying, eligibilities, allUserCycles, settings] = await Promise.all([
    getBalance(userId),
    AutopoolPoolConfig.find({}).sort({ poolLevel: 1 }).lean(),
    AutopoolParticipation.find({ userId, releasedAt: null }).lean(),
    AutopoolNextPoolEligibility.find({ userId, status: 'AVAILABLE' }).lean(),
    AutopoolCycle.find({ userId }).select('poolLevel cycleNumber walletAmount').lean(),
    ensureSettings(),
  ]);
  const enabled = Boolean(settings?.enabled);

  const occupyingPoolLevels = occupying.map((p) => p.poolLevel);
  const openPlacements = occupyingPoolLevels.length > 0
    ? await AutopoolPlacement.find({
        poolLevel: { $in: occupyingPoolLevels },
        status: { $in: ['PLACED', 'WAITING'] },
        openSlots: { $gt: 0 },
      })
        .select('poolLevel participationId openSlots queueSequence')
        .sort({ queueSequence: 1 })
        .lean()
    : [];

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
    const { joinsNeeded, isLastCycle } = calculateWaitingJoinsNeeded(part, openPlacements);

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
      joinsNeeded,
      isLastCycle,
      participation: part
        ? {
            id: part._id,
            status: part.status,
            cycleCount: part.cycleCount,
            maxCycles: part.configSnapshot?.maxCycles ?? 15,
            upgradeUsedAt: part.upgradeUsedAt,
            releasedAt: part.releasedAt,
            nextPoolEligibleAmount: part.nextPoolEligibleAmount,
            joinsNeeded,
            isLastCycle,
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
  let joinsNeeded = null;
  let isLastCycle = false;

  if (part) {
    cycles = await AutopoolCycle.find({ participationId: part._id })
      .sort({ cycleNumber: 1 })
      .lean();
    poolEarnings = cycles.reduce((acc, c) => acc + (Number(c.walletAmount) || 0), 0);

    const maxCycles = part.configSnapshot?.maxCycles ?? 15;
    const cycleCount = part.cycleCount || 0;
    if (cycleCount < maxCycles) {
      const openPlacements = await AutopoolPlacement.find({
        poolLevel: level,
        status: { $in: ['PLACED', 'WAITING'] },
        openSlots: { $gt: 0 },
      })
        .select('poolLevel participationId openSlots queueSequence')
        .sort({ queueSequence: 1 })
        .lean();
      const waiting = calculateWaitingJoinsNeeded(part, openPlacements);
      joinsNeeded = waiting.joinsNeeded;
      isLastCycle = waiting.isLastCycle;
    }
  }

  return {
    participation: part ? { ...part, joinsNeeded, isLastCycle } : null,
    history,
    cycles,
    poolEarnings,
    nextPoolReserve: part?.nextPoolEligibleAmount || 0,
    nextPoolTarget,
    joinsNeeded,
    isLastCycle,
    entryAmount: currentCfg?.entryAmount || 500,
  };
}

async function getCredits(userId) {
  const balance = await getBalance(userId);
  const ledger = await AutopoolUpgradeCreditLedger.find({ userId })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();

  const refEventIds = ledger.map((l) => l.referralEventId).filter(Boolean);
  if (refEventIds.length > 0) {
    const events = await AutopoolReferralEvent.find({ eventId: { $in: refEventIds } })
      .populate('referredUserId', 'serialNumber name')
      .lean();
    const eventMap = new Map(events.map((e) => [e.eventId, e]));
    for (const row of ledger) {
      if (row.referralEventId && eventMap.has(row.referralEventId)) {
        const ev = eventMap.get(row.referralEventId);
        row.referredSerialNumber = ev?.referredUserId?.serialNumber;
        row.referredName = ev?.referredUserId?.name;
      }
    }
  }

  return { balance, ledger };
}

async function getReferrals(userId) {
  const asReferrer = await AutopoolReferralEvent.find({ referrerUserId: userId })
    .populate('referredUserId', 'serialNumber name')
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();
  const asReferred = await AutopoolReferralEvent.find({ referredUserId: userId })
    .populate('referrerUserId', 'serialNumber name')
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
