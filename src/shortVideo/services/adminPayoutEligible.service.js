'use strict';

const Achievement = require('../../models/Achievement');
const MonthlyAchievement = require('../../models/MonthlyAchievement');
const SystemWallet = require('../../models/SystemWallet');
const User = require('../../models/User');
const {
  isEligibilityCheckSkipped,
  getMinNewUsers,
  WEEKLY_MIN_NEW_USERS,
  MONTHLY_MIN_NEW_USERS,
} = require('../helpers/rewardPayoutConfig');
const { countDistinctNewDownlineBuyersSince } = require('../helpers/rewardPayoutEligibility');
const { computeEligibleLevels } = require('./rewardsPayoutEligible.service');

const ADMIN_MAX_ACHIEVERS = 800;
const PARALLEL_BATCH = 25;
const CACHE_TTL_MS = 5 * 60 * 1000;

const listCache = {
  weekly: { at: 0, data: null, meta: null },
  monthly: { at: 0, data: null, meta: null },
};

function getThresholdsMap(poolType) {
  return poolType === 'monthly' ? MONTHLY_MIN_NEW_USERS : WEEKLY_MIN_NEW_USERS;
}

function matchesSearch(row, search) {
  if (!search) return true;
  const t = search.toLowerCase();
  return (
    (row.name && row.name.toLowerCase().includes(t)) ||
    (row.referralCode && row.referralCode.toLowerCase().includes(t)) ||
    String(row.serialNumber ?? '').includes(t)
  );
}

async function buildRow(group, poolType, sinceDate, rulesActive, buyerCountCache) {
  const userId = group._id;
  const achievements = (group.achievements || []).sort((a, b) => a.level - b.level);
  const heldLevels = achievements.map((a) => a.level);
  if (!heldLevels.length) return null;

  const cacheKey = String(userId);
  let newBuyers = 0;
  if (rulesActive) {
    if (buyerCountCache.has(cacheKey)) {
      newBuyers = buyerCountCache.get(cacheKey);
    } else {
      newBuyers = await countDistinctNewDownlineBuyersSince(userId, sinceDate);
      buyerCountCache.set(cacheKey, newBuyers);
    }
  }

  const eligibleLevels = computeEligibleLevels(
    heldLevels,
    poolType,
    newBuyers,
    rulesActive
  );
  if (!eligibleLevels.length) return null;

  return {
    userId: cacheKey,
    achievements: achievements.map((a) => ({ level: a.level, title: a.title })),
    eligibleLevels,
    newBuyersSinceLastPayout: newBuyers,
  };
}

async function buildFullEligibleList(poolType) {
  const Model = poolType === 'monthly' ? MonthlyAchievement : Achievement;
  const wallet = await SystemWallet.findOne().lean();
  const sinceDate =
    poolType === 'monthly'
      ? wallet?.lastMonthlyPayoutAt ?? null
      : wallet?.lastWeeklyPayoutAt ?? null;
  const rulesActive = !isEligibilityCheckSkipped();

  const grouped = await Model.aggregate([
    {
      $group: {
        _id: '$userId',
        achievements: { $push: { level: '$level', title: '$title' } },
        maxLevel: { $max: '$level' },
      },
    },
    { $sort: { maxLevel: -1, _id: 1 } },
    { $limit: ADMIN_MAX_ACHIEVERS },
  ]);

  const buyerCountCache = new Map();
  const partial = [];

  for (let i = 0; i < grouped.length; i += PARALLEL_BATCH) {
    const chunk = grouped.slice(i, i + PARALLEL_BATCH);
    const rows = await Promise.all(
      chunk.map((g) =>
        buildRow(g, poolType, sinceDate, rulesActive, buyerCountCache)
      )
    );
    for (const row of rows) {
      if (row) partial.push(row);
    }
  }

  const userIds = partial.map((r) => r.userId);
  const users = await User.find({ _id: { $in: userIds } })
    .select('name serialNumber referralCode package')
    .populate('package', 'name')
    .lean();
  const userMap = new Map(users.map((u) => [String(u._id), u]));

  const data = partial.map((row) => {
    const u = userMap.get(row.userId);
    return {
      userId: row.userId,
      name: u?.name || 'Member',
      serialNumber: u?.serialNumber ?? null,
      referralCode: u?.referralCode || '',
      packageName: u?.package?.name || null,
      achievements: row.achievements,
      eligibleLevels: row.eligibleLevels,
      newBuyersSinceLastPayout: row.newBuyersSinceLastPayout,
    };
  });

  const meta = {
    poolType,
    eligibilityRulesActive: rulesActive,
    lastPayoutAt: sinceDate,
    thresholds: getThresholdsMap(poolType),
    scannedAchievers: grouped.length,
    cachedAt: new Date().toISOString(),
  };

  return { data, meta };
}

async function getCachedEligibleList(poolType) {
  const slot = listCache[poolType];
  const fresh = slot.data && Date.now() - slot.at < CACHE_TTL_MS;
  if (fresh) return { data: slot.data, meta: slot.meta };

  const built = await buildFullEligibleList(poolType);
  slot.at = Date.now();
  slot.data = built.data;
  slot.meta = built.meta;
  return built;
}

function invalidatePayoutEligibleCache() {
  listCache.weekly = { at: 0, data: null, meta: null };
  listCache.monthly = { at: 0, data: null, meta: null };
}

/**
 * Fast admin payout-ready list: builds once, caches 5 min, paginates in memory.
 */
async function getAdminPayoutEligible({
  poolType = 'weekly',
  page = 1,
  limit = 20,
  search = '',
  level,
}) {
  const { data: allRows, meta } = await getCachedEligibleList(poolType);

  let filtered = allRows;
  const q = (search || '').trim();
  if (q) filtered = filtered.filter((r) => matchesSearch(r, q));

  if (level != null && level !== '' && level !== 'all') {
    const lvl = Number(level);
    filtered = filtered.filter((r) =>
      r.achievements.some((a) => a.level === lvl)
    );
  }

  const pageNum = Math.max(1, Number(page) || 1);
  const limitNum = Math.min(100, Math.max(1, Number(limit) || 20));
  const total = filtered.length;
  const start = (pageNum - 1) * limitNum;
  const users = filtered.slice(start, start + limitNum);
  const totalPages = Math.ceil(total / limitNum) || 1;

  return {
    meta,
    users,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages,
      hasMore: pageNum < totalPages,
    },
  };
}

module.exports = {
  getAdminPayoutEligible,
  invalidatePayoutEligibleCache,
  buildFullEligibleList,
};
