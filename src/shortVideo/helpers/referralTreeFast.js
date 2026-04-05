const mongoose = require('mongoose');
const User = require('../../models/User');

/** Matches business max depth; legacy recursion was unbounded. */
const TEAM_TREE_MAX_DEPTH = 100;

/**
 * Builds the same nested shape as buildReferralTree in tree controllers,
 * using a single $graphLookup + in-memory assembly.
 *
 * @param {import('mongoose').Types.ObjectId|string} rootUserId
 * @returns {Promise<Array<{ user: object, referrals: array }>>}
 */
async function buildReferralTreeFast(rootUserId) {
  const rootId = mongoose.Types.ObjectId.isValid(rootUserId)
    ? new mongoose.Types.ObjectId(String(rootUserId))
    : rootUserId;

  const collectionName = User.collection.collectionName;

  const rows = await User.aggregate([
    { $match: { _id: rootId } },
    {
      $graphLookup: {
        from: collectionName,
        startWith: '$referralCode',
        connectFromField: 'referralCode',
        connectToField: 'referredBy',
        as: 'descendants',
        maxDepth: TEAM_TREE_MAX_DEPTH,
      },
    },
    {
      $project: {
        referralCode: 1,
        descendants: 1,
      },
    },
  ]);

  if (!rows.length) {
    return [];
  }

  const root = rows[0];
  const rootCode = root.referralCode;

  if (rootCode == null || rootCode === '') {
    return [];
  }

  const descendants = root.descendants || [];
  if (descendants.length === 0) {
    return [];
  }

  const byParent = new Map();
  for (const doc of descendants) {
    const parentCode = doc.referredBy;
    if (parentCode == null || parentCode === '') continue;
    if (!byParent.has(parentCode)) {
      byParent.set(parentCode, []);
    }
    byParent.get(parentCode).push(doc);
  }

  for (const list of byParent.values()) {
    list.sort((a, b) => {
      const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      if (ta !== tb) return ta - tb;
      return String(a._id).localeCompare(String(b._id));
    });
  }

  function buildLevel(parentReferralCode) {
    const kids = byParent.get(parentReferralCode) || [];
    return kids.map((u) => ({
      user: {
        id: u._id,
        name: u.name,
        email: u.email,
        phone: u.phone,
        referralCode: u.referralCode,
        referredBy: u.referredBy,
        package: u.package,
      },
      referrals: buildLevel(u.referralCode),
    }));
  }

  return buildLevel(rootCode);
}

module.exports = { buildReferralTreeFast, TEAM_TREE_MAX_DEPTH };
