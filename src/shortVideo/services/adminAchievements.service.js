'use strict';

const Achievement = require('../../models/Achievement');
const MonthlyAchievement = require('../../models/MonthlyAchievement');
const User = require('../../models/User');

function getModel(poolType) {
  return poolType === 'monthly' ? MonthlyAchievement : Achievement;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function resolveUserIdsFromSearch(search) {
  const term = search.trim();
  if (!term) return null;
  const regex = new RegExp(escapeRegex(term), 'i');
  const num = Number(term);
  const or = [
    { name: regex },
    { email: regex },
    { referralCode: regex },
    { phone: regex },
  ];
  if (!Number.isNaN(num)) or.push({ serialNumber: num });

  const users = await User.find({ $or: or })
    .select('_id')
    .limit(400)
    .lean();
  return users.map((u) => u._id);
}

/**
 * Fast level breakdown + totals for weekly or monthly achievements.
 */
async function getAchievementOverview(poolType) {
  const Model = getModel(poolType);
  const [byLevel, uniqueUsers] = await Promise.all([
    Model.aggregate([
      {
        $group: {
          _id: '$level',
          count: { $sum: 1 },
          uniqueUsers: { $addToSet: '$userId' },
        },
      },
      {
        $project: {
          level: '$_id',
          count: 1,
          uniqueUsers: { $size: '$uniqueUsers' },
        },
      },
      { $sort: { level: 1 } },
    ]),
    Model.distinct('userId'),
  ]);

  const totalRecords = byLevel.reduce((s, r) => s + r.count, 0);

  return {
    poolType,
    totalRecords,
    uniqueUsers: uniqueUsers.length,
    byLevel,
  };
}

/**
 * Paginated achievement rows with user info (single aggregate).
 */
async function listAchievements({
  poolType = 'weekly',
  page = 1,
  limit = 20,
  level,
  search,
  sortField = 'achievedAt',
  sortOrder = 'desc',
}) {
  const Model = getModel(poolType);
  const pageNum = Math.max(1, Number(page) || 1);
  const limitNum = Math.min(100, Math.max(1, Number(limit) || 20));
  const skip = (pageNum - 1) * limitNum;

  const match = {};
  if (level != null && level !== '' && level !== 'all') {
    match.level = Number(level);
  }

  const userIds = search ? await resolveUserIdsFromSearch(search) : null;
  if (userIds) {
    if (!userIds.length) {
      return {
        poolType,
        rows: [],
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: 0,
          totalPages: 1,
          hasMore: false,
        },
      };
    }
    match.userId = { $in: userIds };
  }

  const sortMap = {
    achievedAt: 'achievedAt',
    level: 'level',
    title: 'title',
    name: 'user.name',
    serialNumber: 'user.serialNumber',
  };
  const sortKey = sortMap[sortField] || 'achievedAt';
  const sortDir = sortOrder === 'asc' ? 1 : -1;

  const [facet] = await Model.aggregate([
    { $match: match },
    {
      $lookup: {
        from: 'users',
        localField: 'userId',
        foreignField: '_id',
        as: 'user',
      },
    },
    { $unwind: '$user' },
    {
      $lookup: {
        from: 'packages',
        localField: 'user.package',
        foreignField: '_id',
        as: 'pkg',
      },
    },
    {
      $unwind: { path: '$pkg', preserveNullAndEmptyArrays: true },
    },
    {
      $facet: {
        rows: [
          { $sort: { [sortKey]: sortDir, _id: 1 } },
          { $skip: skip },
          { $limit: limitNum },
          {
            $project: {
              _id: 1,
              level: 1,
              title: 1,
              achievedAt: { $ifNull: ['$achievedAt', '$createdAt'] },
              userId: 1,
              name: '$user.name',
              email: '$user.email',
              serialNumber: '$user.serialNumber',
              referralCode: '$user.referralCode',
              packageName: '$pkg.name',
            },
          },
        ],
        total: [{ $count: 'count' }],
      },
    },
  ]);

  const rows = facet?.rows ?? [];
  const total = facet?.total?.[0]?.count ?? 0;
  const totalPages = Math.ceil(total / limitNum) || 1;

  return {
    poolType,
    rows: rows.map((r) => ({
      id: String(r._id),
      userId: String(r.userId),
      name: r.name || '—',
      email: r.email || '',
      serialNumber: r.serialNumber ?? null,
      referralCode: r.referralCode || '',
      packageName: r.packageName || null,
      level: r.level,
      title: r.title,
      achievedAt: r.achievedAt,
    })),
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
  getAchievementOverview,
  listAchievements,
};
