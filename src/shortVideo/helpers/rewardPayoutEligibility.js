'use strict';

const User = require('../../models/User');
const PackageOrder = require('../../models/PackageOrder');

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
 * True if any successful package purchase exists in the user's 10-level downline
 * after sinceDate. Null sinceDate (first payout) uses epoch (all history).
 */
async function hasNewDownlinePurchaseSince(userId, sinceDate) {
  const user = await User.findById(userId).select('referralCode').lean();
  if (!user || !user.referralCode) return false;

  const downlineIds = await collectDownlineUserIds(user.referralCode, 10);
  if (!downlineIds.length) return false;

  const since = sinceDate ?? new Date(0);

  return Boolean(
    await PackageOrder.exists({
      buyerId: { $in: downlineIds },
      status: 'success',
      createdAt: { $gt: since },
    })
  );
}

/**
 * Cached wrapper for payout runs (same user at L1 and L2 in one pass).
 */
async function isEligibleForLowLevelReward(userId, sinceDate, cache) {
  const key = String(userId);
  if (cache.has(key)) return cache.get(key);

  const result = await hasNewDownlinePurchaseSince(userId, sinceDate);
  cache.set(key, result);
  return result;
}

module.exports = {
  collectDownlineUserIds,
  hasNewDownlinePurchaseSince,
  isEligibleForLowLevelReward,
};
