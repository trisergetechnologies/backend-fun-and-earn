const {
  AutopoolParticipation,
  AutopoolNextPoolEligibility,
  AutopoolCycle,
  AutopoolReferralEvent,
  AutopoolUpgradeCreditLedger,
  AutopoolPoolConfig,
  AutopoolPlacement,
  AutopoolWaitingRoom,
} = require('../models');
const { ensureSettings, seedPoolConfigs, isAutopoolEnabled } = require('./config.service');
const { getBalance } = require('./referralCredit.service');
const { isPoolReleased } = require('./release.rules');
const {
  findOccupyingParticipation,
  listOccupyingParticipations,
  MANUAL_PASS_COST,
} = require('./entry.service');
const { getQueuePosition } = require('./waitingRoom.service');

function calculateWaitingJoinsNeeded(participation, openPlacements) {
  if (!participation) return { joinsNeeded: null, isLastCycle: false };
  const maxCycles = participation.configSnapshot?.maxCycles ?? 5;
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

async function buildWaitingRoomInfo(userId, targetPoolLevel, wrSeats, creditBalance) {
  const seats = (wrSeats || []).filter((s) => s.targetPoolLevel === targetPoolLevel);
  if (seats.length === 0) return null;

  const first = seats[0];
  const position = await getQueuePosition(first);
  const waitingForPass = creditBalance < 1;
  return {
    count: seats.length,
    position,
    status: waitingForPass ? 'WAITING_FOR_PASS' : 'WAITING',
    entryAmount: first.entryAmount,
    enqueuedAt: first.enqueuedAt,
  };
}

async function getOverview(userId) {
  // Heal stuck releasedAt + WR enqueue before reading WR seats
  const occupyingRaw = await listOccupyingParticipations(userId);
  const occupying = occupyingRaw.map((p) => (p.toObject ? p.toObject() : p));

  const [creditBalance, configs, eligibilities, allUserCycles, settings, wrSeats] =
    await Promise.all([
      getBalance(userId),
      AutopoolPoolConfig.find({}).sort({ poolLevel: 1 }).lean(),
      AutopoolNextPoolEligibility.find({ userId, status: 'AVAILABLE' }).lean(),
      AutopoolCycle.find({ userId }).select('poolLevel cycleNumber walletAmount').lean(),
      ensureSettings(),
      AutopoolWaitingRoom.find({ userId, status: 'WAITING' }).sort({ enqueuedAt: 1 }).lean(),
    ]);
  const enabled = Boolean(settings?.enabled);

  const occupyingPoolLevels = occupying.map((p) => p.poolLevel);
  const openPlacements =
    occupyingPoolLevels.length > 0
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
    const nextPoolReserve = part ? part.nextPoolEligibleAmount || 0 : 0;
    const poolEarnings = poolEarningsMap[cfg.poolLevel] || 0;
    const { joinsNeeded, isLastCycle } = calculateWaitingJoinsNeeded(part, openPlacements);

    let joinPool1 = null;
    let joinNext = null;
    let joinManual = null;
    let waitingRoom = null;

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
      // Soft-closed for old clients — upgrades are automatic via WR cron
      const reasons = ['AUTO_JOIN_ENABLED'];
      if (!enabled) reasons.unshift('AUTOPOOL_DISABLED');
      if (part) reasons.push('TARGET_OCCUPYING');
      if (!elig && !(wrSeats || []).some((s) => s.targetPoolLevel === cfg.poolLevel)) {
        reasons.push('NO_ELIGIBILITY');
      }
      if (creditBalance < 1) reasons.push('NO_UPGRADE_CREDIT');
      joinNext = {
        allowed: false,
        reasons,
        eligibility: elig || null,
        entryAmount: elig?.entryAmount || cfg.entryAmount,
      };

      waitingRoom = await buildWaitingRoomInfo(
        userId,
        cfg.poolLevel,
        wrSeats,
        creditBalance
      );

      if (cfg.poolLevel === 2 || cfg.poolLevel === 3) {
        const passesRequired = MANUAL_PASS_COST[cfg.poolLevel];
        const manualReasons = [];
        if (!enabled) manualReasons.push('AUTOPOOL_DISABLED');
        if (part) manualReasons.push('POOL_OCCUPYING');
        if (waitingRoom) manualReasons.push('WAITING_ROOM_PENDING');
        const otherOk = occupying.some((p) => p.poolLevel !== cfg.poolLevel);
        if (!otherOk) manualReasons.push('NO_OTHER_OCCUPYING');
        if (creditBalance < passesRequired) manualReasons.push('NO_UPGRADE_CREDIT');
        joinManual = {
          allowed: manualReasons.length === 0 && enabled,
          reasons: manualReasons,
          entryAmount: cfg.entryAmount,
          passesRequired,
        };
      }
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
            maxCycles: part.configSnapshot?.maxCycles ?? 5,
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
      joinManual,
      waitingRoom,
    });
  }

  return {
    enabled,
    creditBalance,
    totalEarnings,
    waitingRoomSeats: wrSeats.map((s) => ({
      id: s._id,
      targetPoolLevel: s.targetPoolLevel,
      entryAmount: s.entryAmount,
      enqueuedAt: s.enqueuedAt,
      sourceParticipationId: s.sourceParticipationId,
    })),
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

    const maxCycles = part.configSnapshot?.maxCycles ?? 5;
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

  const wrSeats = await AutopoolWaitingRoom.find({
    userId,
    targetPoolLevel: level,
    status: 'WAITING',
  })
    .sort({ enqueuedAt: 1 })
    .lean();
  const creditBalance = await getBalance(userId);
  const waitingRoom = await buildWaitingRoomInfo(userId, level, wrSeats, creditBalance);

  let joinManual = null;
  if (level === 2 || level === 3) {
    const passesRequired = MANUAL_PASS_COST[level];
    const occupying = await listOccupyingParticipations(userId);
    const manualReasons = [];
    const enabled = await isAutopoolEnabled();
    if (!enabled) manualReasons.push('AUTOPOOL_DISABLED');
    if (part) manualReasons.push('POOL_OCCUPYING');
    if (waitingRoom) manualReasons.push('WAITING_ROOM_PENDING');
    if (!occupying.some((p) => Number(p.poolLevel) !== level)) {
      manualReasons.push('NO_OTHER_OCCUPYING');
    }
    if (creditBalance < passesRequired) manualReasons.push('NO_UPGRADE_CREDIT');
    joinManual = {
      allowed: manualReasons.length === 0 && enabled,
      reasons: manualReasons,
      entryAmount: currentCfg?.entryAmount || 0,
      passesRequired,
    };
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
    entryAmount: currentCfg?.entryAmount || 1000,
    waitingRoom,
    joinManual,
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
