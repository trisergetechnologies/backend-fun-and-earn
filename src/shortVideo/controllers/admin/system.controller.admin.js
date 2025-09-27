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


function round2(v) {
  return Math.round((Number(v) + Number.EPSILON) * 100) / 100;
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