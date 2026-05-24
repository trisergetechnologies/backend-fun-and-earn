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
const { isPublicRewardListSerial } = require('../helpers/rewardListConfig');

const MAX_SCAN_USERS = 120;
const PARALLEL_BATCH = 15;

function getThresholdsMap(poolType) {
  return poolType === 'monthly' ? MONTHLY_MIN_NEW_USERS : WEEKLY_MIN_NEW_USERS;
}

function computeEligibleLevels(heldLevels, poolType, newBuyers, rulesActive) {
  const eligible = [];
  for (const level of heldLevels) {
    if (!rulesActive) {
      eligible.push(level);
      continue;
    }
    const min = getMinNewUsers(poolType, level);
    if (min == null) {
      eligible.push(level);
    } else if (newBuyers >= min) {
      eligible.push(level);
    }
  }
  return eligible.sort((a, b) => a - b);
}

async function buildPayoutReadyRow(group, poolType, sinceDate, rulesActive) {
  const userId = group._id;
  const achievements = (group.achievements || []).sort((a, b) => a.level - b.level);
  const heldLevels = achievements.map((a) => a.level);
  if (!heldLevels.length) return null;

  const newBuyers = rulesActive
    ? await countDistinctNewDownlineBuyersSince(userId, sinceDate)
    : 0;

  const eligibleLevels = computeEligibleLevels(
    heldLevels,
    poolType,
    newBuyers,
    rulesActive
  );

  if (!eligibleLevels.length) return null;

  const user = await User.findById(userId)
    .select('name serialNumber referralCode package')
    .populate('package', 'name')
    .lean();

  if (!user) return null;
  if (!isPublicRewardListSerial(user.serialNumber)) return null;

  const eligibleSet = new Set(eligibleLevels);
  return {
    userId: String(userId),
    name: user.name || 'Member',
    serialNumber: user.serialNumber ?? null,
    referralCode: user.referralCode || '',
    packageName: user.package?.name || null,
    achievements: achievements
      .filter((a) => eligibleSet.has(a.level))
      .map((a) => ({
        level: a.level,
        title: a.title,
      })),
    newBuyersSinceLastPayout: newBuyers,
    isEligible: true,
  };
}

async function collectEligibleUsers(grouped, poolType, sinceDate, rulesActive, pageNum, limitNum) {
  const targetEnd = pageNum * limitNum;
  const needCount = targetEnd + 1;
  const allEligible = [];
  let scannedAll = true;

  for (let i = 0; i < grouped.length; i += PARALLEL_BATCH) {
    const chunk = grouped.slice(i, i + PARALLEL_BATCH);
    const rows = await Promise.all(
      chunk.map((g) => buildPayoutReadyRow(g, poolType, sinceDate, rulesActive))
    );
    for (const row of rows) {
      if (row) allEligible.push(row);
    }

    if (allEligible.length >= needCount && i + PARALLEL_BATCH < grouped.length) {
      scannedAll = false;
      break;
    }
  }

  return { allEligible, scannedAll };
}

/**
 * Returns paginated users eligible for the next payout of poolType.
 */
async function getPayoutEligibleUsers({ poolType, page = 1, limit = 20 }) {
  const Model = poolType === 'monthly' ? MonthlyAchievement : Achievement;
  const wallet = await SystemWallet.findOne().lean();
  const sinceDate =
    poolType === 'monthly'
      ? wallet?.lastMonthlyPayoutAt ?? null
      : wallet?.lastWeeklyPayoutAt ?? null;

  const rulesActive = !isEligibilityCheckSkipped();
  const thresholds = getThresholdsMap(poolType);

  const grouped = await Model.aggregate([
    {
      $group: {
        _id: '$userId',
        achievements: { $push: { level: '$level', title: '$title' } },
        maxLevel: { $max: '$level' },
      },
    },
    { $sort: { maxLevel: -1, _id: 1 } },
    { $limit: MAX_SCAN_USERS },
  ]);

  const pageNum = Math.max(1, Number(page) || 1);
  const limitNum = Math.min(50, Math.max(1, Number(limit) || 20));

  const { allEligible, scannedAll } = await collectEligibleUsers(
    grouped,
    poolType,
    sinceDate,
    rulesActive,
    pageNum,
    limitNum
  );

  const start = (pageNum - 1) * limitNum;
  const users = allEligible.slice(start, start + limitNum);
  const hasMoreInBuffer = allEligible.length > pageNum * limitNum;
  const hasMore =
    hasMoreInBuffer || (!scannedAll && grouped.length === MAX_SCAN_USERS);

  return {
    meta: {
      poolType,
      eligibilityRulesActive: rulesActive,
      lastPayoutAt: sinceDate,
      thresholds,
    },
    users,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total: scannedAll ? allEligible.length : allEligible.length,
      totalPages: hasMore ? pageNum + 1 : Math.max(1, Math.ceil(allEligible.length / limitNum)),
      hasMore,
    },
  };
}

module.exports = {
  getPayoutEligibleUsers,
  computeEligibleLevels,
  buildPayoutReadyRow,
  MAX_SCAN_USERS,
};
