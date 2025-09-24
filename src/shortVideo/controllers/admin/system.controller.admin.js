const SystemEarningLog = require('../../../models/SystemEarningLog');
const SystemWallet = require('../../../models/SystemWallet');
const Achievement = require("../../../models/Achievement");
const User = require("../../../models/User");
const WalletTransaction = require("../../../models/WalletTransaction");


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


exports.payoutWeeklyRewards = async (req, res) => {
  try {
    const admin = req.user;
    if (admin.role !== "admin") {
      return res.status(200).json({ success: false, message: "Unauthorized", data: null });
    }

    const wallet = await SystemWallet.findOne();
    if (!wallet || wallet.weeklyPool <= 0) {
      return res.status(200).json({ success: false, message: "No funds in weekly pool", data: null });
    }

    const poolAmount = wallet.weeklyPool;
    const perLevel = poolAmount / 10;

    let totalPaid = 0;
    let totalReturned = 0;

    // Go level by level (1-10 achievements)
    for (let level = 1; level <= 10; level++) {
      const achievers = await Achievement.find({ level }).populate("userId");

      if (!achievers.length) {
        // return unused to totalBalance
        wallet.totalBalance += perLevel;
        totalReturned += perLevel;

        await SystemEarningLog.create({
          amount: perLevel,
          type: "inflow",
          source: "weeklyPayout",
          context: `Unused funds returned from level ${level}`,
          status: "success"
        });

        continue;
      }

      const share = perLevel / achievers.length;
      totalPaid += share * achievers.length;

      for (const ach of achievers) {
        const user = ach.userId;
        user.wallets.shortVideoWallet += share;
        await user.save();

        await WalletTransaction.create({
          userId: user._id,
          type: "earn",
          source: "system",
          fromWallet: "shortVideoWallet",
          amount: share,
          status: "success",
          triggeredBy: "system",
          notes: `Weekly reward: ${ach.title}`
        });
      }
    }

    // Zero out weeklyPool
    wallet.weeklyPool = 0;
    await wallet.save();

    // Log the total outflow (rewards actually paid)
    await SystemEarningLog.create({
      amount: totalPaid,
      type: "outflow",
      source: "weeklyPayout",
      fromUser: admin._id,
      context: `Weekly payout distributed: ${totalPaid}`
    });

    return res.status(200).json({
      success: true,
      message: "Weekly rewards distributed",
      data: { totalPaid, totalReturned, wallet }
    });
  } catch (err) {
    console.error("WeeklyPayout Error:", err);
    return res.status(500).json({ success: false, message: "Internal Server Error", data: null });
  }
};