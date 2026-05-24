'use strict';

const mongoose = require('mongoose');
const User = require('../../models/User');
const Achievement = require('../../models/Achievement');
const Order = require('../../eCart/models/Order');
const WalletTransaction = require('../../models/WalletTransaction');
const EarningLog = require('../models/EarningLog');
const Coupon = require('../../models/Coupon');
const Video = require('../models/Video');

const VALID_LOG_TYPES = new Set([
  'earningLogs',
  'walletTransactions',
  'orders',
  'referrals',
  'coupons',
  'videos',
]);

function round2(v) {
  return Math.round(Number(v || 0) * 100) / 100;
}

function parsePageLimit(page, limit) {
  const limitNum = Math.min(50, Math.max(1, Number(limit) || 20));
  const pageNum = Math.max(1, Number(page) || 1);
  return { pageNum, limitNum, skip: (pageNum - 1) * limitNum };
}

/**
 * Resolve user by userId, serialNumber, or email (priority order).
 */
async function resolveUser({ email, userId, serialNumber }) {
  if (userId) {
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return { user: null, error: 'Invalid userId' };
    }
    const user = await User.findById(userId)
      .populate('package')
      .select('-password -token')
      .lean();
    if (!user) return { user: null, error: 'User not found' };
    return { user, error: null };
  }

  if (serialNumber !== undefined && serialNumber !== null && String(serialNumber).trim() !== '') {
    const num = Number(String(serialNumber).replace(/^#/, '').trim());
    if (Number.isNaN(num)) {
      return { user: null, error: 'Invalid serial number' };
    }
    const user = await User.findOne({ serialNumber: num })
      .populate('package')
      .select('-password -token')
      .lean();
    if (!user) return { user: null, error: 'User not found' };
    return { user, error: null };
  }

  if (email && String(email).trim()) {
    const normalized = String(email).trim();
    const user = await User.findOne({ email: normalized })
      .populate('package')
      .select('-password -token')
      .lean();
    if (!user) return { user: null, error: 'User not found' };
    return { user, error: null };
  }

  return { user: null, error: 'Provide email, serialNumber, or userId' };
}

async function getUser360Summary(user) {
  const userId = user._id;
  const referralCode = user.referralCode;

  const [
    achievements,
    orderCount,
    orderAgg,
    walletTxSuccessCount,
    walletTxByType,
    earningLogCount,
    earningLogAgg,
    couponCount,
    videoCount,
    referralCount,
  ] = await Promise.all([
    Achievement.find({ userId })
      .select('level title achievedAt createdAt')
      .sort({ level: 1 })
      .lean(),
    Order.countDocuments({ buyerId: userId }),
    Order.aggregate([
      { $match: { buyerId: userId } },
      {
        $group: {
          _id: null,
          totalOrderValue: { $sum: { $ifNull: ['$totalAmount', 0] } },
          totalPaid: { $sum: { $ifNull: ['$finalAmountPaid', 0] } },
        },
      },
    ]),
    WalletTransaction.countDocuments({ userId, status: 'success' }),
    WalletTransaction.aggregate([
      { $match: { userId, status: 'success' } },
      {
        $group: {
          _id: '$type',
          total: { $sum: { $ifNull: ['$amount', 0] } },
        },
      },
    ]),
    EarningLog.countDocuments({ userId }),
    EarningLog.aggregate([
      { $match: { userId } },
      {
        $group: {
          _id: null,
          totalEarned: { $sum: { $ifNull: ['$amount', 0] } },
        },
      },
    ]),
    Coupon.countDocuments({ earnedBy: userId }),
    Video.countDocuments({ userId }),
    referralCode
      ? User.countDocuments({ referredBy: referralCode })
      : Promise.resolve(0),
  ]);

  const orderTotals = orderAgg[0] || {};
  const earnTotals = earningLogAgg[0] || {};

  const walletTotals = {};
  let walletGrandTotal = 0;
  for (const row of walletTxByType) {
    const type = row._id || 'unknown';
    walletTotals[type] = round2(row.total);
    walletGrandTotal = round2(walletGrandTotal + Number(row.total || 0));
  }

  const videoUploadCount = user.shortVideoProfile?.videoUploads?.length ?? 0;

  return {
    user,
    userId: String(userId),
    wallets: user.wallets || {},
    shortVideoProfile: user.shortVideoProfile || {},
    eCartProfile: user.eCartProfile || {},
    serialNumber: user.serialNumber ?? null,
    referralCode: user.referralCode ?? null,
    referredBy: user.referredBy ?? null,
    videoUploadCount,
    achievements: achievements.map((a) => ({
      _id: a._id,
      level: a.level,
      title: a.title,
      achievedAt: a.achievedAt || a.createdAt,
    })),
    orderSummary: {
      count: orderCount,
      totalOrderValue: round2(orderTotals.totalOrderValue),
      totalPaid: round2(orderTotals.totalPaid),
    },
    walletTransactionSummary: {
      totalTransactions: walletTxSuccessCount,
      totals: walletTotals,
      grandTotal: walletGrandTotal,
    },
    earningLogSummary: {
      totalEarningLogs: earningLogCount,
      totalEarned: round2(earnTotals.totalEarned),
    },
    counts: {
      orders: orderCount,
      walletTransactions: walletTxSuccessCount,
      earningLogs: earningLogCount,
      coupons: couponCount,
      videos: videoCount,
      referrals: referralCount,
    },
    referralCount,
  };
}

async function fetchLogsByType(user, logType, { pageNum, limitNum, skip }) {
  const userId = user._id;

  switch (logType) {
    case 'earningLogs': {
      const filter = { userId };
      const [total, items] = await Promise.all([
        EarningLog.countDocuments(filter),
        EarningLog.find(filter)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limitNum)
          .populate({ path: 'fromUser', select: 'name email serialNumber' })
          .lean(),
      ]);
      return { total, items };
    }
    case 'walletTransactions': {
      const filter = { userId };
      const [total, items] = await Promise.all([
        WalletTransaction.countDocuments(filter),
        WalletTransaction.find(filter)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limitNum)
          .lean(),
      ]);
      return { total, items };
    }
    case 'orders': {
      const filter = { buyerId: userId };
      const [total, items] = await Promise.all([
        Order.countDocuments(filter),
        Order.find(filter)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limitNum)
          .lean(),
      ]);
      return { total, items };
    }
    case 'referrals': {
      if (!user.referralCode) {
        return { total: 0, items: [] };
      }
      const filter = { referredBy: user.referralCode };
      const [total, items] = await Promise.all([
        User.countDocuments(filter),
        User.find(filter)
          .select('_id name email phone package serialNumber createdAt')
          .populate('package', 'name')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limitNum)
          .lean(),
      ]);
      return { total, items };
    }
    case 'coupons': {
      const filter = { earnedBy: userId };
      const [total, items] = await Promise.all([
        Coupon.countDocuments(filter),
        Coupon.find(filter)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limitNum)
          .lean(),
      ]);
      return { total, items };
    }
    case 'videos': {
      const filter = { userId };
      const [total, items] = await Promise.all([
        Video.countDocuments(filter),
        Video.find(filter)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limitNum)
          .lean(),
      ]);
      return { total, items };
    }
    default:
      return null;
  }
}

async function getUser360Logs(userId, logType, { page = 1, limit = 20 }) {
  if (!VALID_LOG_TYPES.has(logType)) {
    return { error: 'Invalid logType', data: null };
  }

  if (!mongoose.Types.ObjectId.isValid(userId)) {
    return { error: 'Invalid userId', data: null };
  }

  const user = await User.findById(userId).select('_id referralCode').lean();
  if (!user) {
    return { error: 'User not found', data: null };
  }

  const { pageNum, limitNum, skip } = parsePageLimit(page, limit);
  const result = await fetchLogsByType(user, logType, { pageNum, limitNum, skip });
  if (!result) {
    return { error: 'Invalid logType', data: null };
  }

  const totalPages = Math.max(1, Math.ceil(result.total / limitNum) || 1);

  return {
    error: null,
    data: {
      logType,
      items: result.items,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: result.total,
        totalPages,
      },
    },
  };
}

module.exports = {
  resolveUser,
  getUser360Summary,
  getUser360Logs,
  VALID_LOG_TYPES,
};
