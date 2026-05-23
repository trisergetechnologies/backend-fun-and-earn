'use strict';

const EarningLog = require('../models/EarningLog');
const UserEarningLeaderboard = require('../models/UserEarningLeaderboard');
const User = require('../../models/User');

/** Serial numbers 1–22 are excluded from the public top earners list. */
const MIN_TOP_EARNER_SERIAL = 23;

let syncInProgress = null;

function startBackgroundRebuild() {
  if (syncInProgress) return;
  syncInProgress = rebuildLeaderboardFromLogs().finally(() => {
    syncInProgress = null;
  });
}

async function rebuildLeaderboardFromLogs() {
  await UserEarningLeaderboard.deleteMany({});
  const rows = await EarningLog.aggregate([
    { $match: { status: 'success' } },
    {
      $group: {
        _id: '$userId',
        totalEarned: { $sum: '$amount' },
      },
    },
  ]);

  if (!rows.length) return;

  const ops = rows.map((r) => ({
    updateOne: {
      filter: { userId: r._id },
      update: { $set: { totalEarned: r.totalEarned } },
      upsert: true,
    },
  }));

  const BATCH = 500;
  for (let i = 0; i < ops.length; i += BATCH) {
    await UserEarningLeaderboard.bulkWrite(ops.slice(i, i + BATCH), { ordered: false });
  }
}

function lookupUserStage(localField) {
  return {
    $lookup: {
      from: 'users',
      localField,
      foreignField: '_id',
      as: 'user',
    },
  };
}

function eligibleSerialMatch() {
  return { 'user.serialNumber': { $gte: MIN_TOP_EARNER_SERIAL } };
}

async function hydrateUsers(pageRows, rankOffset) {
  const userIds = pageRows.map((r) => r.userId);
  const users = await User.find({ _id: { $in: userIds } })
    .select('name serialNumber referralCode package')
    .populate('package', 'name')
    .lean();

  const userMap = new Map(users.map((u) => [String(u._id), u]));

  return pageRows.map((row, index) => {
    const u = userMap.get(String(row.userId));
    const totalEarned = row.totalEarned ?? 0;
    return {
      rank: rankOffset + index + 1,
      userId: String(row.userId),
      name: u?.name || 'Member',
      serialNumber: u?.serialNumber ?? null,
      referralCode: u?.referralCode || '',
      packageName: u?.package?.name || null,
      totalEarned: Math.round((totalEarned + Number.EPSILON) * 100) / 100,
    };
  });
}

/**
 * One-page aggregate while materialized leaderboard is empty (non-blocking).
 */
async function getTopEarnersFromAggregate({ pageNum, limitNum, skip }) {
  const baseStages = [
    { $match: { status: 'success' } },
    {
      $group: {
        _id: '$userId',
        totalEarned: { $sum: '$amount' },
      },
    },
    lookupUserStage('_id'),
    { $unwind: '$user' },
    { $match: eligibleSerialMatch() },
  ];

  const [countRows, aggRows] = await Promise.all([
    EarningLog.aggregate([...baseStages, { $count: 'total' }]),
    EarningLog.aggregate([
      ...baseStages,
      { $sort: { totalEarned: -1, _id: 1 } },
      { $skip: skip },
      { $limit: limitNum + 1 },
    ]),
  ]);

  startBackgroundRebuild();

  const total = countRows[0]?.total ?? 0;
  const hasMore = aggRows.length > limitNum;
  const pageRows = aggRows.slice(0, limitNum).map((r) => ({
    userId: r._id,
    totalEarned: r.totalEarned,
  }));

  const users = await hydrateUsers(pageRows, skip);
  const totalPages = Math.ceil(total / limitNum) || 1;

  return {
    users,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages,
      hasMore: hasMore || pageNum < totalPages,
    },
  };
}

/**
 * Fast paginated top earners from materialized totals (serial >= 23 only).
 */
async function getTopEarnersPage({ page = 1, limit = 20 }) {
  const pageNum = Math.max(1, Number(page) || 1);
  const limitNum = Math.min(50, Math.max(1, Number(limit) || 20));
  const skip = (pageNum - 1) * limitNum;

  const count = await UserEarningLeaderboard.estimatedDocumentCount();
  if (count === 0) {
    return getTopEarnersFromAggregate({ pageNum, limitNum, skip });
  }

  const filterStages = [
    lookupUserStage('userId'),
    { $unwind: '$user' },
    { $match: eligibleSerialMatch() },
  ];

  const [countRows, aggRows] = await Promise.all([
    UserEarningLeaderboard.aggregate([...filterStages, { $count: 'total' }]),
    UserEarningLeaderboard.aggregate([
      ...filterStages,
      { $sort: { totalEarned: -1, userId: 1 } },
      { $skip: skip },
      { $limit: limitNum + 1 },
      { $project: { userId: 1, totalEarned: 1 } },
    ]),
  ]);

  const total = countRows[0]?.total ?? 0;
  const hasMore = aggRows.length > limitNum;
  const pageRows = aggRows.slice(0, limitNum);
  const users = await hydrateUsers(pageRows, skip);
  const totalPages = Math.ceil(total / limitNum) || 1;

  return {
    users,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages,
      hasMore: hasMore || pageNum < totalPages,
    },
  };
}

module.exports = {
  getTopEarnersPage,
  rebuildLeaderboardFromLogs,
  startBackgroundRebuild,
  MIN_TOP_EARNER_SERIAL,
};
