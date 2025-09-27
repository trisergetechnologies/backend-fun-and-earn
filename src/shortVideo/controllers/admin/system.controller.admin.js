const mongoose = require('mongoose');
const SystemEarningLog = require('../../../models/SystemEarningLog');
const SystemWallet = require('../../../models/SystemWallet');
const Achievement = require("../../../models/Achievement");
const User = require("../../../models/User");
const WalletTransaction = require("../../../models/WalletTransaction");
const Package = require('../../../models/Package');
const Order = require('../../../eCart/models/Order');
const EarningLog = require('../../models/EarningLog');
const Coupon = require('../../../models/Coupon');
const Video = require('../../models/Video');


exports.getSystemEarningLogs = async (req, res) => {
  try {
    const { limit = 20, page = 1 } = req.query;

    const logs = await SystemEarningLog.find({})
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    const total = await SystemEarningLog.countDocuments();

    if (!logs || logs.length === 0) {
      return res.status(200).json({
        success: false,
        message: 'No earning logs found',
        data: []
      });
    }

    return res.status(200).json({
      success: true,
      message: 'System earning logs fetched successfully',
      data: {
        logs,
        pagination: {
          total,
          page: Number(page),
          limit: Number(limit),
          totalPages: Math.ceil(total / limit)
        }
      }
    });

  } catch (err) {
    console.error('Get System Earning Logs Error:', err);
    return res.status(500).json({
      success: false,
      message: 'Internal Server Error',
      data: null
    });
  }
};


exports.getSystemWallet = async (req, res) => {
  try {
    const wallet = await SystemWallet.findOne({});

    if (!wallet) {
      return res.status(200).json({
        success: false,
        message: 'System wallet not found',
        data: null
      });
    }

    return res.status(200).json({
      success: true,
      message: 'System wallet fetched successfully',
      data: wallet
    });

  } catch (err) {
    console.error('Get System Wallet Error:', err);
    return res.status(500).json({
      success: false,
      message: 'Internal Server Error',
      data: null
    });
  }
};


exports.transferFundsToPool = async (req, res) => {
  try {
    const { amount, poolType } = req.body; // poolType: "weekly" or "monthly"
    const admin = req.user;

    if (admin.role !== "admin") {
      return res.status(200).json({ success: false, message: "Unauthorized", data: null });
    }

    if (!["weekly", "monthly"].includes(poolType)) {
      return res.status(200).json({ success: false, message: "Invalid pool type", data: null });
    }

    const wallet = await SystemWallet.findOne();
    if (!wallet || wallet.totalBalance < amount) {
      return res.status(200).json({ success: false, message: "Insufficient system balance", data: null });
    }

    if (poolType === "weekly") wallet.weeklyPool += amount;
    else wallet.monthlyPool += amount;

    wallet.totalBalance -= amount;
    await wallet.save();

    await SystemEarningLog.create({
      amount,
      type: "outflow",
      source: "adminAdjustment",
      fromUser: admin._id,
      context: `Transferred ${amount} to ${poolType} pool`
    });

    return res.status(200).json({
      success: true,
      message: `Funds transferred to ${poolType} pool successfully`,
      data: wallet
    });
  } catch (err) {
    console.error("TransferFunds Error:", err);
    return res.status(500).json({ success: false, message: "Internal Server Error", data: null });
  }
};


function round2(v) {
  return Math.round((Number(v || 0) + Number.EPSILON) * 100) / 100;
}

exports.payoutWeeklyRewards = async (req, res) => {
  try {
    const admin = req.user;
    if (!admin || admin.role !== 'admin') {
      return res.status(200).json({ success: false, message: 'Unauthorized', data: null });
    }

    // Ensure a system wallet doc exists
    let wallet = await SystemWallet.findOne();
    if (!wallet) {
      wallet = await new SystemWallet().save();
    }

    if (!wallet.weeklyPool || wallet.weeklyPool <= 0) {
      return res.status(200).json({ success: false, message: 'No funds in weekly pool', data: null });
    }

    const poolAmount = round2(wallet.weeklyPool);
    const perLevel = round2(poolAmount / 10); // equal split into 10 buckets

    let totalPaid = 0;
    let totalReturned = 0;

    // Process each achievement level (1..10)
    for (let level = 1; level <= 10; level++) {
      try {
        // find all users who unlocked this level
        const achievers = await Achievement.find({ level }).populate('userId').lean();

        if (!achievers || achievers.length === 0) {
          // no achievers -> return this bucket to totalBalance and log inflow
          wallet.totalBalance = round2((wallet.totalBalance || 0) + perLevel);
          totalReturned = round2(totalReturned + perLevel);

          await SystemEarningLog.create({
            amount: perLevel,
            type: 'inflow',
            source: 'weeklyPayout',
            context: `Unused funds returned from level ${level}`,
            status: 'success'
          });

          continue;
        }

        const count = achievers.length;
        const share = round2(perLevel / count);
        const sumPaidForLevel = round2(share * count);
        const remainder = round2(perLevel - sumPaidForLevel);

        // If there's a rounding remainder, return to system
        if (remainder > 0) {
          wallet.totalBalance = round2((wallet.totalBalance || 0) + remainder);
          totalReturned = round2(totalReturned + remainder);

          await SystemEarningLog.create({
            amount: remainder,
            type: 'inflow',
            source: 'weeklyPayout',
            context: `Rounding remainder returned from level ${level}`,
            status: 'success'
          });
        }

        // Bulk update user wallets
        const bulkUserOps = [];
        const txDocs = [];

        for (const ach of achievers) {
          const usr = ach.userId;
          if (!usr || !usr._id) {
            // If user missing, treat as not present -> return their share to system
            wallet.totalBalance = round2((wallet.totalBalance || 0) + share);
            totalReturned = round2(totalReturned + share);
            await SystemEarningLog.create({
              amount: share,
              type: 'inflow',
              source: 'weeklyPayout',
              context: `User missing for achievement level ${level}, returned share`,
              status: 'success'
            });
            continue;
          }

          bulkUserOps.push({
            updateOne: {
              filter: { _id: usr._id },
              update: { $inc: { 'wallets.shortVideoWallet': share } }
            }
          });

          txDocs.push({
            userId: usr._id,
            type: 'earn',
            source: 'system',
            fromWallet: 'shortVideoWallet',
            amount: share,
            status: 'success',
            triggeredBy: 'system',
            notes: `Weekly reward: ${ach.title}`
          });
        }

        // Execute bulk user updates and wallet transactions
        if (bulkUserOps.length > 0) {
          await User.bulkWrite(bulkUserOps);
        }
        if (txDocs.length > 0) {
          await WalletTransaction.insertMany(txDocs);
        }

        totalPaid = round2(totalPaid + sumPaidForLevel);

      } catch (lvlErr) {
        console.error(`Error processing level ${level} in weekly payout:`, lvlErr);
        // continue to next level (don't abort whole payout)
      }
    } // end for levels

    // Zero out weeklyPool (payout consumed it)
    wallet.weeklyPool = 0;
    await wallet.save();

    // Log the aggregated outflow for the run
    await SystemEarningLog.create({
      amount: totalPaid,
      type: 'outflow',
      source: 'weeklyPayout',
      fromUser: admin._id,
      context: `Weekly payout distributed: totalPaid=${totalPaid}, totalReturned=${totalReturned}`,
      status: 'success'
    });

    return res.status(200).json({
      success: true,
      message: 'Weekly rewards distributed',
      data: { totalPaid, totalReturned, wallet }
    });

  } catch (err) {
    console.error('WeeklyPayout Error:', err);
    return res.status(500).json({ success: false, message: 'Internal Server Error', data: null });
  }
};



exports.getCompleteInfo = async (req, res) => {
  try {
    // Accept identifier from query, params or body
    const { email: qEmail, userId: qUserId } = req.query || {};
    const { email: bEmail, userId: bUserId } = req.body || {};
    const { id: pId } = req.params || {};

    const email = qEmail || bEmail;
    const userId = qUserId || bUserId || pId;

    if (!email && !userId) {
      return res.status(200).json({
        success: false,
        message: 'Provide email or userId to fetch user details',
        data: null
      });
    }

    // Find user (prefer userId)
    let user;
    if (userId) {
      if (!mongoose.Types.ObjectId.isValid(userId)) {
        return res.status(200).json({
          success: false,
          message: 'Invalid userId',
          data: null
        });
      }
      user = await User.findById(userId).populate('package').lean();
    } else {
      user = await User.findOne({ email }).populate('package').lean();
    }

    if (!user) {
      return res.status(200).json({
        success: false,
        message: 'User not found',
        data: null
      });
    }

    // Remove sensitive fields
    delete user.password;
    if (user.token) delete user.token;

    // Limits for lists (adjust if you want)
    const RECENT_ORDERS_LIMIT = 50;
    const RECENT_TX_LIMIT = 100;
    const RECENT_EARNING_LOGS_LIMIT = 100;
    const RECENT_COUPONS_LIMIT = 50;
    const RECENT_VIDEOS_LIMIT = 50;
    const RECENT_REFERRALS_LIMIT = 200;

    // Fetch related resources in parallel
    const [
      achievements,
      orders,
      walletTxs,
      earningLogs,
      coupons,
      videos,
      referrals
    ] = await Promise.all([
      // all achievements (multiple docs allowed now)
      Achievement.find({ userId: user._id }).sort({ level: 1 }).lean(),

      // recent orders placed by user
      Order.find({ buyerId: user._id }).sort({ createdAt: -1 }).limit(RECENT_ORDERS_LIMIT).lean(),

      // recent wallet transactions
      WalletTransaction.find({ userId: user._id }).sort({ createdAt: -1 }).limit(RECENT_TX_LIMIT).lean(),

      // earning logs where this user received (EarningLog.userId)
      EarningLog.find({ userId: user._id }).sort({ createdAt: -1 }).limit(RECENT_EARNING_LOGS_LIMIT).lean(),

      // coupons earned by user
      Coupon.find({ earnedBy: user._id }).sort({ createdAt: -1 }).limit(RECENT_COUPONS_LIMIT).lean(),

      // videos uploaded by user (short video app)
      Video.find({ userId: user._id }).sort({ createdAt: -1 }).limit(RECENT_VIDEOS_LIMIT).lean(),

      // immediate referrals (direct downline)
      User.find({ referredBy: user.referralCode })
        .select('_id name email phone package serialNumber createdAt')
        .limit(RECENT_REFERRALS_LIMIT)
        .lean()
    ]);

    // Wallet transaction summary (sums by type)
    const txSummary = walletTxs.reduce((acc, tx) => {
      const { type, amount = 0, status } = tx;
      if (status !== 'success') return acc;
      acc.totalTransactions += 1;
      acc.totals[type] = (acc.totals[type] || 0) + Number(amount || 0);
      acc.grandTotal = round2((acc.grandTotal || 0) + Number(amount || 0));
      return acc;
    }, { totalTransactions: 0, totals: {}, grandTotal: 0 });

    // earningLog summary
    const earnSummary = earningLogs.reduce((acc, l) => {
      const amt = Number(l.amount || 0);
      acc.totalEarningLogs = (acc.totalEarningLogs || 0) + 1;
      acc.totalEarned = round2((acc.totalEarned || 0) + amt);
      return acc;
    }, { totalEarningLogs: 0, totalEarned: 0 });

    // Orders summary
    const orderSummary = orders.reduce((acc, o) => {
      acc.count = (acc.count || 0) + 1;
      acc.totalOrderValue = round2((acc.totalOrderValue || 0) + Number(o.totalAmount || 0));
      acc.totalPaid = round2((acc.totalPaid || 0) + Number(o.finalAmountPaid || 0));
      return acc;
    }, { count: 0, totalOrderValue: 0, totalPaid: 0 });

    // Prepare response shape (lots of data)
    const data = {
      user, // includes populated package
      wallets: user.wallets || {},
      shortVideoProfile: user.shortVideoProfile || {},
      eCartProfile: user.eCartProfile || {},
      serialNumber: user.serialNumber || null,
      referralCode: user.referralCode || null,
      referredBy: user.referredBy || null,

      achievements: achievements.map(a => ({
        _id: a._id,
        level: a.level,
        title: a.title,
        achievedAt: a.achievedAt || a.createdAt
      })),

      // recent items (full documents)
      recentOrders: orders,
      orderSummary,

      recentWalletTransactions: walletTxs,
      walletTransactionSummary: txSummary,

      recentEarningLogs: earningLogs,
      earningLogSummary: earnSummary,

      recentCoupons: coupons,
      recentVideos: videos,

      immediateReferrals: referrals,
      referralCount: referrals.length
    };

    return res.status(200).json({
      success: true,
      message: 'Complete user info fetched',
      data
    });

  } catch (err) {
    console.error('getCompleteInfo Error:', err);
    return res.status(500).json({
      success: false,
      message: 'Internal Server Error',
      data: null
    });
  }
};
