const User = require('../../models/User');
const {
  AutopoolParticipation,
  AutopoolCycle,
  AutopoolPlacement,
  AutopoolPoolConfig,
} = require('../models');

function publicUser(user) {
  if (!user) return { name: 'Member', serialNumber: null };
  return {
    name: user.name || 'Member',
    serialNumber: user.serialNumber ?? null,
  };
}

/**
 * Pools that have had at least one participation.
 */
async function listAchieverPools() {
  const levels = await AutopoolParticipation.distinct('poolLevel');
  const sorted = (levels || []).map(Number).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);

  const configs = await AutopoolPoolConfig.find({
    poolLevel: { $in: sorted },
  })
    .select('poolLevel entryAmount')
    .lean();
  const cfgMap = new Map(configs.map((c) => [c.poolLevel, c]));

  const counts = await AutopoolParticipation.aggregate([
    { $match: { poolLevel: { $in: sorted } } },
    { $group: { _id: '$poolLevel', total: { $sum: 1 }, active: { $sum: { $cond: [{ $eq: ['$releasedAt', null] }, 1, 0] } } } },
  ]);
  const countMap = new Map(counts.map((c) => [c._id, c]));

  return sorted.map((poolLevel) => {
    const c = countMap.get(poolLevel) || { total: 0, active: 0 };
    const cfg = cfgMap.get(poolLevel);
    return {
      poolLevel,
      entryAmount: cfg?.entryAmount ?? null,
      totalParticipations: c.total || 0,
      activeParticipations: c.active || 0,
    };
  });
}

/**
 * Last 10 cycle completions + next 10 closest to completing a cycle in this pool.
 */
async function getPoolAchievers(poolLevel) {
  const level = Number(poolLevel);
  if (!Number.isInteger(level) || level < 1 || level > 13) {
    const err = new Error('Invalid pool level');
    err.code = 'INVALID_POOL';
    throw err;
  }

  const recentCycles = await AutopoolCycle.find({
    poolLevel: level,
    status: 'DISTRIBUTED',
  })
    .sort({ completedAt: -1, createdAt: -1 })
    .limit(10)
    .lean();

  const recentUserIds = [...new Set(recentCycles.map((c) => String(c.userId)))];
  const upcomingPlacements = await AutopoolPlacement.find({
    poolLevel: level,
    status: { $in: ['PLACED', 'WAITING'] },
    openSlots: { $gt: 0 },
  })
    .sort({ openSlots: 1, queueSequence: 1 })
    .limit(10)
    .lean();

  const upcomingPartIds = upcomingPlacements.map((p) => p.participationId).filter(Boolean);
  const [users, parts] = await Promise.all([
    User.find({
      _id: {
        $in: [
          ...recentUserIds,
          ...upcomingPlacements.map((p) => p.userId).filter(Boolean),
        ],
      },
    })
      .select('name serialNumber')
      .lean(),
    AutopoolParticipation.find({ _id: { $in: upcomingPartIds } })
      .select('userId poolLevel cycleCount status configSnapshot entryType')
      .lean(),
  ]);

  const userMap = new Map(users.map((u) => [String(u._id), u]));
  const partMap = new Map(parts.map((p) => [String(p._id), p]));

  // Fill userId from participation when placement lacks it
  for (const pl of upcomingPlacements) {
    if (!pl.userId && pl.participationId) {
      const part = partMap.get(String(pl.participationId));
      if (part?.userId) pl.userId = part.userId;
    }
  }

  const missingUpcomingUserIds = upcomingPlacements
    .map((p) => (p.userId ? String(p.userId) : null))
    .filter((id) => id && !userMap.has(id));
  if (missingUpcomingUserIds.length) {
    const extra = await User.find({ _id: { $in: missingUpcomingUserIds } })
      .select('name serialNumber')
      .lean();
    for (const u of extra) userMap.set(String(u._id), u);
  }

  const recentlyCompleted = recentCycles.map((c, idx) => {
    const u = publicUser(userMap.get(String(c.userId)));
    return {
      rank: idx + 1,
      userId: c.userId,
      name: u.name,
      serialNumber: u.serialNumber,
      cycleNumber: c.cycleNumber,
      walletAmount: c.walletAmount || 0,
      completedAt: c.completedAt || c.createdAt,
    };
  });

  const aboutToComplete = upcomingPlacements.map((pl, idx) => {
    const part = partMap.get(String(pl.participationId));
    const uid = pl.userId || part?.userId;
    const u = publicUser(userMap.get(String(uid)));
    const maxCycles = part?.configSnapshot?.maxCycles ?? 5;
    const cycleCount = part?.cycleCount ?? 0;
    return {
      rank: idx + 1,
      userId: uid,
      name: u.name,
      serialNumber: u.serialNumber,
      cycleCount,
      maxCycles,
      openSlots: pl.openSlots,
      joinsNeeded: pl.openSlots,
      status: part?.status || null,
    };
  });

  const cfg = await AutopoolPoolConfig.findOne({ poolLevel: level }).lean();

  return {
    poolLevel: level,
    entryAmount: cfg?.entryAmount ?? null,
    recentlyCompleted,
    aboutToComplete,
  };
}

module.exports = {
  listAchieverPools,
  getPoolAchievers,
};
