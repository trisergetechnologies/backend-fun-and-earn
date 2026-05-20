'use strict';

const User = require('../../models/User');
const PackageOrder = require('../../models/PackageOrder');
const {
  isEligibilityCheckSkipped,
  getMinNewUsers,
} = require('./rewardPayoutConfig');

/**
 * BFS: collect all descendant user IDs at depths 1..maxDepth under referralCode.
 */
async function collectDownlineUserIds(referralCode, maxDepth = 10) {
  if (!referralCode) return [];

  const ids = [];
  let currentReferralCodes = [referralCode];

  for (let depth = 0; depth < maxDepth; depth++) {
    if (!currentReferralCodes.length) break;

    const nextLevelUsers = await User.find({
      referredBy: { $in: currentReferralCodes },
    })
      .select('_id referralCode')
      .lean();

    if (!nextLevelUsers || nextLevelUsers.length === 0) break;

    for (const u of nextLevelUsers) {
      ids.push(u._id);
    }

    currentReferralCodes = nextLevelUsers
      .map((u) => u.referralCode)
      .filter(Boolean);
  }

  return ids;
}

/**
 * Count distinct buyers with a successful package order in 10-level downline after sinceDate.
 * Null sinceDate (first payout) uses epoch (all history).
 */
async function countDistinctNewDownlineBuyersSince(userId, sinceDate) {
  const user = await User.findById(userId).select('referralCode').lean();
  if (!user || !user.referralCode) return 0;

  const downlineIds = await collectDownlineUserIds(user.referralCode, 10);
  if (!downlineIds.length) return 0;

  const since = sinceDate ?? new Date(0);

  const result = await PackageOrder.aggregate([
    {
      $match: {
        buyerId: { $in: downlineIds },
        status: 'success',
        createdAt: { $gt: since },
      },
    },
    { $group: { _id: '$buyerId' } },
    { $count: 'count' },
  ]);

  return result[0]?.count ?? 0;
}

/**
 * Whether an achiever at a given pool type + achievement level may receive payout share.
 */
async function isEligibleForAchievementPayout(
  userId,
  poolType,
  achievementLevel,
  sinceDate,
  cache
) {
  if (isEligibilityCheckSkipped()) return true;

  const minRequired = getMinNewUsers(poolType, achievementLevel);
  if (minRequired == null) return true;

  const key = `${userId}:${poolType}:${achievementLevel}`;
  if (cache.has(key)) return cache.get(key);

  const count = await countDistinctNewDownlineBuyersSince(userId, sinceDate);
  const eligible = count >= minRequired;
  cache.set(key, eligible);
  return eligible;
}

module.exports = {
  collectDownlineUserIds,
  countDistinctNewDownlineBuyersSince,
  isEligibleForAchievementPayout,
};
