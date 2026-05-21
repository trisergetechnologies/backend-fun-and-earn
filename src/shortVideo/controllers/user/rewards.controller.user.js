'use strict';

const EarningLog = require('../../models/EarningLog');
const { getPayoutEligibleUsers } = require('../../services/rewardsPayoutEligible.service');

exports.getPayoutEligible = async (req, res) => {
  try {
    const { poolType, page = 1, limit = 20 } = req.query;

    if (!poolType || !['weekly', 'monthly'].includes(poolType)) {
      return res.status(200).json({
        success: false,
        message: 'poolType must be weekly or monthly',
        data: null,
      });
    }

    const data = await getPayoutEligibleUsers({
      poolType,
      page: Number(page),
      limit: Number(limit),
    });

    return res.status(200).json({
      success: true,
      message: 'Payout-ready members fetched successfully',
      data,
    });
  } catch (err) {
    console.error('getPayoutEligible Error:', err);
    return res.status(500).json({
      success: false,
      message: 'Internal Server Error',
      data: null,
    });
  }
};

exports.getTopEarners = async (req, res) => {
  try {
    const pageNum = Math.max(1, Number(req.query.page) || 1);
    const limitNum = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
    const skip = (pageNum - 1) * limitNum;

    const [countResult, rows] = await Promise.all([
      EarningLog.aggregate([
        { $match: { status: 'success' } },
        { $group: { _id: '$userId' } },
        { $count: 'total' },
      ]),
      EarningLog.aggregate([
        { $match: { status: 'success' } },
        {
          $group: {
            _id: '$userId',
            totalEarned: { $sum: '$amount' },
          },
        },
        { $sort: { totalEarned: -1, _id: 1 } },
        { $skip: skip },
        { $limit: limitNum },
        {
          $lookup: {
            from: 'users',
            localField: '_id',
            foreignField: '_id',
            as: 'user',
          },
        },
        { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
        {
          $lookup: {
            from: 'packages',
            localField: 'user.package',
            foreignField: '_id',
            as: 'pkg',
          },
        },
        {
          $project: {
            userId: '$_id',
            totalEarned: 1,
            name: '$user.name',
            serialNumber: '$user.serialNumber',
            referralCode: '$user.referralCode',
            packageName: { $arrayElemAt: ['$pkg.name', 0] },
          },
        },
      ]),
    ]);

    const total = countResult[0]?.total ?? 0;
    const totalPages = Math.ceil(total / limitNum) || 1;
    const rankOffset = skip;

    const users = rows.map((row, index) => ({
      rank: rankOffset + index + 1,
      userId: String(row.userId),
      name: row.name || 'Member',
      serialNumber: row.serialNumber ?? null,
      referralCode: row.referralCode || '',
      packageName: row.packageName || null,
      totalEarned: Math.round((row.totalEarned + Number.EPSILON) * 100) / 100,
    }));

    return res.status(200).json({
      success: true,
      message: 'Top earners fetched successfully',
      data: {
        users,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages,
          hasMore: pageNum < totalPages,
        },
      },
    });
  } catch (err) {
    console.error('getTopEarners Error:', err);
    return res.status(500).json({
      success: false,
      message: 'Internal Server Error',
      data: null,
    });
  }
};
