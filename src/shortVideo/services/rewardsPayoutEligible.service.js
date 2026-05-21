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

const MAX_SCAN_USERS = 500;

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

function computeRequiredForDisplay(heldLevels, poolType, rulesActive) {
  if (!rulesActive) return null;
  let max = 0;
  let hasGated = false;
  for (const level of heldLevels) {
    const min = getMinNewUsers(poolType, level);
    if (min != null) {
      hasGated = true;
      max = Math.max(max, min);
    }
  }
  return hasGated ? max : null;
}

async function buildPayoutReadyRow(group, poolType, sinceDate, rulesActive) {
  const userId = group._id;
  const achievements = group.achievements || [];
  const heldLevels = achievements.map((a) => a.level);
  if (!heldLevels.length) return null;

  const highestLevel = Math.max(...heldLevels);
  const primary = achievements.find((a) => a.level === highestLevel) || achievements[0];

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

  return {
    userId: String(userId),
    name: user.name || 'Member',
    serialNumber: user.serialNumber ?? null,
    referralCode: user.referralCode || '',
    packageName: user.package?.name || null,
    primaryAchievementTitle: primary.title,
    highestAchievementLevel: highestLevel,
    eligibleLevels,
    newBuyersSinceLastPayout: newBuyers,
    requiredForDisplay: computeRequiredForDisplay(heldLevels, poolType, rulesActive),
    isEligible: true,
  };
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

  const allEligible = [];
  for (const group of grouped) {
    const row = await buildPayoutReadyRow(group, poolType, sinceDate, rulesActive);
    if (row) allEligible.push(row);
  }

  const pageNum = Math.max(1, Number(page) || 1);
  const limitNum = Math.min(50, Math.max(1, Number(limit) || 20));
  const total = allEligible.length;
  const start = (pageNum - 1) * limitNum;
  const users = allEligible.slice(start, start + limitNum);
  const totalPages = Math.ceil(total / limitNum) || 1;

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
      total,
      totalPages,
      hasMore: pageNum < totalPages,
    },
  };
}

module.exports = {
  getPayoutEligibleUsers,
  computeEligibleLevels,
  buildPayoutReadyRow,
  MAX_SCAN_USERS,
};
