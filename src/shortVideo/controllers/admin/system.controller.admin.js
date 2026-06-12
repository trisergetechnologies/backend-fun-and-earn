const mongoose = require('mongoose');
const SystemEarningLog = require('../../../models/SystemEarningLog');
const SystemWallet = require('../../../models/SystemWallet');
const Achievement = require("../../../models/Achievement");
const MonthlyAchievement = require("../../../models/MonthlyAchievement");
const User = require("../../../models/User");
const WalletTransaction = require("../../../models/WalletTransaction");
const Package = require('../../../models/Package');
const Order = require('../../../eCart/models/Order');
const EarningLog = require('../../models/EarningLog');
const Coupon = require('../../../models/Coupon');
const Video = require('../../models/Video');

const { distributeTeamWithdrawalEarnings } = require('../../helpers/distributeTeamWithdrawalEarnings');
const { distributeNetworkWithdrawalEarnings } = require('../../helpers/distributeNetworkWithdrawalEarnings');
const { captureLeftovers } = require('../../helpers/captureLeftovers');
const { isEligibleForAchievementPayout } = require('../../helpers/rewardPayoutEligibility');
const { invalidatePayoutEligibleCache } = require('../../services/adminPayoutEligible.service');
const {
  isEligibilityCheckSkipped,
  getMinNewUsers,
} = require('../../helpers/rewardPayoutConfig');
const { getSystemEarningLogsPage } = require('../../services/systemEarningLogs.service');
const {
  resolveUser,
  getUser360Summary,
  getUser360Logs,
} = require('../../services/user360.service');

exports.getSystemEarningLogs = async (req, res) => {
  try {
    const { limit = 20, page = 1, search, type, source } = req.query;

    const data = await getSystemEarningLogsPage({
      page,
      limit,
      search,
      type,
      source,
    });

    return res.status(200).json({
      success: true,
      message: data.logs.length
        ? 'System earning logs fetched successfully'
        : 'No earning logs found',
      data,
    });
  } catch (err) {
    console.error('Get System Earning Logs Error:', err);
    return res.status(500).json({
      success: false,
      message: 'Internal Server Error',
      data: null,
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

async function collectPayableAchievers(
  achievers,
  poolType,
  level,
  sinceDate,
  eligibilityCache
) {
  const payable = [];

  for (const ach of achievers) {
    const usr = ach.userId;
    if (!usr || !usr._id) continue;

    if (
      !isEligibilityCheckSkipped() &&
      getMinNewUsers(poolType, level) != null
    ) {
      const eligible = await isEligibleForAchievementPayout(
        usr._id,
        poolType,
        level,
        sinceDate,
        eligibilityCache
      );
      if (!eligible) continue;
    }

    payable.push(ach);
  }

  return payable;
}

/**
 * Distribute weekly reward pool among achievers.
 * - Pool source: SystemWallet.weeklyPool (atomic claim before pay)
 * - Split equally among 10 levels (1–10)
 * - Each level’s share is divided equally among eligible achievers at that level
 * - Unused or remainder funds return to SystemWallet.totalBalance
 */
exports.payoutWeeklyRewards = async (req, res) => {
  try {
    const admin = req.user;
    if (!admin || admin.role !== 'admin') {
      return res.status(200).json({ success: false, message: 'Unauthorized', data: null });
    }

    // Ensure a system wallet doc exists
    let walletDoc = await SystemWallet.findOne();
    if (!walletDoc) {
      walletDoc = await new SystemWallet().save();
    }

    // Atomic claim — only one concurrent payout can win
    const wallet = await SystemWallet.findOneAndUpdate(
      { _id: walletDoc._id, weeklyPool: { $gt: 0 } },
      { $set: { weeklyPool: 0 } },
      { new: false }
    );

    if (!wallet) {
      return res.status(200).json({ success: false, message: 'No funds in weekly pool', data: null });
    }

    const poolAmount = round2(wallet.weeklyPool);
    wallet.weeklyPool = 0;
    const perLevel = round2(poolAmount / 10); // equal split into 10 buckets

    let totalPaid = 0;
    let totalReturned = 0;
    const eligibilityCache = new Map();

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

        const payable = await collectPayableAchievers(
          achievers,
          'weekly',
          level,
          wallet.lastWeeklyPayoutAt,
          eligibilityCache
        );

        if (payable.length === 0) {
          wallet.totalBalance = round2((wallet.totalBalance || 0) + perLevel);
          totalReturned = round2(totalReturned + perLevel);

          await SystemEarningLog.create({
            amount: perLevel,
            type: 'inflow',
            source: 'weeklyPayout',
            context: `No eligible achievers at level ${level}, funds returned`,
            status: 'success'
          });

          continue;
        }

        const share = round2(perLevel / payable.length);
        const sumPaidForLevel = round2(share * payable.length);
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

        const bulkUserOps = [];
        const txDocs = [];
        let levelPaid = 0;

        for (const ach of payable) {
          const usr = ach.userId;

          bulkUserOps.push({
            updateOne: {
              filter: { _id: usr._id },
              update: { $inc: { 'wallets.shortVideoWallet': share } }
            }
          });

          txDocs.push({
            userId: usr._id,
            amount: share,
            source: 'weeklyReward',
            fromUser: admin._id,
            context: `Achievement Level ${level} - ${ach.title}`,
            triggeredBy: 'admin',
            notes: `Weekly reward: ${ach.title}`,
            status: 'success'
          });
          levelPaid = round2(levelPaid + share);
        }

        // Execute bulk user updates and wallet transactions
        if (bulkUserOps.length > 0) {
          await User.bulkWrite(bulkUserOps);
        }
        if (txDocs.length > 0) {
          // await WalletTransaction.insertMany(txDocs);
          await EarningLog.insertMany(txDocs);
        }

        totalPaid = round2(totalPaid + levelPaid);

      } catch (lvlErr) {
        console.error(`Error processing level ${level} in weekly payout:`, lvlErr);
        // continue to next level (don't abort whole payout)
      }
    } // end for levels

    wallet.lastWeeklyPayoutAt = new Date();
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

    invalidatePayoutEligibleCache();

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



/**
 * Distribute monthly reward pool among achievers.
 * - Pool source: SystemWallet.monthlyPool (atomic claim before pay)
 * - Split equally among 10 levels (1–10)
 * - Each level’s share is divided equally among eligible achievers at that level
 * - Unused or remainder funds return to SystemWallet.totalBalance
 */
exports.payoutMonthlyRewards = async (req, res) => {
  try {
    const admin = req.user;
    if (!admin || admin.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Unauthorized access"
      });
    }

    // Ensure wallet exists
    let walletDoc = await SystemWallet.findOne();
    if (!walletDoc) walletDoc = await new SystemWallet().save();

    // Atomic claim — only one concurrent payout can win
    const wallet = await SystemWallet.findOneAndUpdate(
      { _id: walletDoc._id, monthlyPool: { $gt: 0 } },
      { $set: { monthlyPool: 0 } },
      { new: false }
    );

    if (!wallet) {
      return res.status(200).json({
        success: false,
        message: "No funds in monthly reward pool",
        data: null
      });
    }

    const poolAmount = round2(wallet.monthlyPool);
    wallet.monthlyPool = 0;
    const perLevel = round2(poolAmount / 10);

    let totalPaid = 0;
    let totalReturned = 0;
    const eligibilityCache = new Map();

    // Loop through all 10 achievement levels
    for (let level = 1; level <= 10; level++) {
      try {
        const achievers = await MonthlyAchievement.find({ level })
          .populate("userId")
          .lean();

        if (!achievers || achievers.length === 0) {
          // No achievers — return full bucket to totalBalance
          wallet.totalBalance = round2((wallet.totalBalance || 0) + perLevel);
          totalReturned = round2(totalReturned + perLevel);

          await SystemEarningLog.create({
            amount: perLevel,
            type: "inflow",
            source: "monthlyPayout",
            context: `Unused funds returned from level ${level}`,
            status: "success"
          });
          continue;
        }

        const payable = await collectPayableAchievers(
          achievers,
          'monthly',
          level,
          wallet.lastMonthlyPayoutAt,
          eligibilityCache
        );

        if (payable.length === 0) {
          wallet.totalBalance = round2((wallet.totalBalance || 0) + perLevel);
          totalReturned = round2(totalReturned + perLevel);

          await SystemEarningLog.create({
            amount: perLevel,
            type: "inflow",
            source: "monthlyPayout",
            context: `No eligible achievers at level ${level}, funds returned`,
            status: "success"
          });

          continue;
        }

        const share = round2(perLevel / payable.length);
        const sumPaidForLevel = round2(share * payable.length);
        const remainder = round2(perLevel - sumPaidForLevel);

        // Return any rounding remainder
        if (remainder > 0) {
          wallet.totalBalance = round2((wallet.totalBalance || 0) + remainder);
          totalReturned = round2(totalReturned + remainder);

          await SystemEarningLog.create({
            amount: remainder,
            type: "inflow",
            source: "monthlyPayout",
            context: `Rounding remainder returned from level ${level}`,
            status: "success"
          });
        }

        const bulkUserOps = [];
        const txDocs = [];
        let levelPaid = 0;

        for (const ach of payable) {
          const usr = ach.userId;

          bulkUserOps.push({
            updateOne: {
              filter: { _id: usr._id },
              update: { $inc: { "wallets.shortVideoWallet": share } }
            }
          });

          txDocs.push({
            userId: usr._id,
            amount: share,
            source: "monthlyReward",
            fromUser: admin._id,
            context: `Achievement Level ${level} - ${ach.title}`,
            triggeredBy: "admin",
            notes: `Monthly reward: ${ach.title}`,
            status: "success"
          });
          levelPaid = round2(levelPaid + share);
        }

        // Apply bulk updates
        if (bulkUserOps.length > 0) {
          await User.bulkWrite(bulkUserOps);
        }

        if (txDocs.length > 0) {
          await EarningLog.insertMany(txDocs);
        }

        totalPaid = round2(totalPaid + levelPaid);

      } catch (levelErr) {
        console.error(`❌ Error processing monthly level ${level}:`, levelErr);
        // continue to next level
      }
    }

    wallet.lastMonthlyPayoutAt = new Date();
    await wallet.save();

    // Log summary
    await SystemEarningLog.create({
      amount: totalPaid,
      type: "outflow",
      source: "monthlyPayout",
      fromUser: admin._id,
      context: `Monthly payout completed. totalPaid=${totalPaid}, totalReturned=${totalReturned}`,
      status: "success"
    });

    invalidatePayoutEligibleCache();

    return res.status(200).json({
      success: true,
      message: "Monthly rewards distributed successfully",
      data: {
        totalPaid,
        totalReturned,
        remainingBalance: wallet.totalBalance,
        poolAfterReset: wallet.monthlyPool
      }
    });

  } catch (err) {
    console.error("❌ payoutMonthlyRewards Error:", err);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: err.message
    });
  }
};




exports.getCompleteInfo = async (req, res) => {
  try {
    const { email: qEmail, userId: qUserId, serialNumber: qSerial } = req.query || {};
    const { email: bEmail, userId: bUserId, serialNumber: bSerial } = req.body || {};
    const { id: pId } = req.params || {};

    const { user, error } = await resolveUser({
      email: qEmail || bEmail,
      userId: qUserId || bUserId || pId,
      serialNumber: qSerial ?? bSerial,
    });

    if (error) {
      return res.status(200).json({
        success: false,
        message: error,
        data: null,
      });
    }

    const data = await getUser360Summary(user);

    return res.status(200).json({
      success: true,
      message: 'Complete user info fetched',
      data,
    });
  } catch (err) {
    console.error('getCompleteInfo Error:', err);
    return res.status(500).json({
      success: false,
      message: 'Internal Server Error',
      data: null,
    });
  }
};

exports.getCompleteInfoLogs = async (req, res) => {
  try {
    const {
      userId: qUserId,
      email: qEmail,
      serialNumber: qSerial,
      logType,
      page,
      limit,
    } = req.query || {};

    let userId = qUserId;

    if (!userId && (qEmail || qSerial !== undefined)) {
      const { user, error } = await resolveUser({
        email: qEmail,
        serialNumber: qSerial,
      });
      if (error) {
        return res.status(200).json({
          success: false,
          message: error,
          data: null,
        });
      }
      userId = String(user._id);
    }

    if (!userId || !logType) {
      return res.status(200).json({
        success: false,
        message: 'Provide userId (or email/serialNumber) and logType',
        data: null,
      });
    }

    const { error, data } = await getUser360Logs(userId, logType, { page, limit });

    if (error) {
      return res.status(200).json({
        success: false,
        message: error,
        data: null,
      });
    }

    return res.status(200).json({
      success: true,
      message: 'User logs fetched',
      data,
    });
  } catch (err) {
    console.error('getCompleteInfoLogs Error:', err);
    return res.status(500).json({
      success: false,
      message: 'Internal Server Error',
      data: null,
    });
  }
};





/**
 * Auto-transfer of balances:
 * - Phase 1: Move funds from shortVideo → eCart (50%) and record snapshots
 * - Phase 2: Run distribution + leftover capture based on snapshots
 */
exports.transferShortVideoToECart = async (req, res) => {
  try {
    const admin = req.user;
    if (!admin || admin.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Unauthorized"
      });
    }
    
    // Phase 1: Sweep all users with balance
    const users = await User.find({"wallets.shortVideoWallet": { $gt: 0 } });
    if (!users || users.length === 0) {
      return res.status(200).json({
        success: false,
        message: "No users with shortVideo balance",
        data: null
      });
    }
    console.log(`[transferShortVideoToECart] Started Phase 1 at ${new Date().toISOString()}`)

    const snapshots = []; // store { userId, withdrawalAmount }
    let totalTransferred = 0;
    let totalLogs = 0;

    for (const user of users) {
      let retries = 0;
      let success = false;

      while (retries < 3 && !success) {
        try {
          const freshUser = await User.findById(user._id).lean();
          const withdrawalAmount = round2(freshUser.wallets.shortVideoWallet);
          if (withdrawalAmount <= 0) break;

          const transferToECart = round2(withdrawalAmount * 0.5);

          // atomic update: empty SV wallet, credit EC wallet
          const result = await User.updateOne(
            { _id: freshUser._id, "wallets.shortVideoWallet": { $gt: 0 } },
            {
              $set: { "wallets.shortVideoWallet": 0 },
              $inc: { "wallets.eCartWallet": transferToECart }
            }
          );

          if (result.modifiedCount === 0) {
            retries++;
            console.warn(`⚠️ Retry ${retries}/3 for user ${user._id} due to concurrent modification`);
            continue;
          }

          // Wallet transaction log
          await WalletTransaction.create({
            userId: freshUser._id,
            type: "withdraw",
            source: "system",
            fromWallet: "shortVideoWallet",
            toWallet: "eCartWallet",
            amount: transferToECart,
            status: "success",
            triggeredBy: "system",
            notes: `Auto-transfer: User had ₹${withdrawalAmount}, system credited ₹${transferToECart} (50%) to eCart and allocated rest for distributions.`
          });

          // System earning log (transfer portion only)
          // await SystemEarningLog.create({
          //   amount: withdrawalAmount,
          //   type: "outflow",
          //   source: "shortVideoToECart",
          //   fromUser: freshUser._id,
          //   breakdown: { transfer: transferToECart },
          //   context: `Snapshot withdrawal for user ${freshUser._id}`,
          //   status: "success"
          // });


          // Add 10% of withdrawal amount to system wallet (adminChargeEarnedFromWithdrals)
          const adminCharge = round2(withdrawalAmount * 0.10);
          await SystemWallet.updateOne({}, { $inc: { adminChargeEarnedFromWithdrals: adminCharge } });

          await SystemEarningLog.create({
            amount: adminCharge,
            type: "inflow",
            source: "shortVideoToECart",
            fromUser: freshUser._id,
            context: `System Earned 10% of ₹${withdrawalAmount} as Admin Charge from user ${freshUser.email}`,
            status: "success"
          });

          // Add 9.15% of withdrawalAmount to SystemWallet totalBalance
          const systemShare = round2(withdrawalAmount * 0.0915);
          await SystemWallet.updateOne({}, { $inc: { totalBalance: systemShare } });

          // System earning log for 9.15% share
          await SystemEarningLog.create({
            amount: systemShare,
            type: "inflow",
            source: "shortVideoToECart",
            fromUser: freshUser._id,
            context: `System retained 9.15% of ₹${withdrawalAmount} from user ${freshUser.email}`,
            status: "success"
          });

          // Save snapshot for Phase 2
          snapshots.push({ userId: freshUser._id, withdrawalAmount });

          totalTransferred += transferToECart;
          totalLogs++;
          success = true;
          
        } catch (err) {
          if (err.code === 112 || (err.errorLabels && err.errorLabels.includes("TransientTransactionError"))) {
            retries++;
            console.warn(`⚠️ WriteConflict for user ${user._id}. Retrying ${retries}/3...`);
            if (retries >= 3) {
              console.error(`❌ User ${user._id} skipped after 3 retries.`);
            }
            continue;
          } else {
            console.error(`❌ Error processing user ${user._id}:`, err);
            break;
          }
        }
      }
    }
    console.log(`[transferShortVideoToECart] Phase 1 Over (success) at ${new Date().toISOString()}`)

    // Phase 2: Run distributions + leftovers
    console.log(`[transferShortVideoToECart] Phase 2 Started at ${new Date().toISOString()}`)
    let distributionsRun = 0;
    for (const snap of snapshots) {
      try {
        const result1 = await distributeTeamWithdrawalEarnings(snap.userId, snap.withdrawalAmount);
        if (result1) await captureLeftovers(result1);

        const freshUser = await User.findById(snap.userId).lean(); // needed for network range
        const result2 = await distributeNetworkWithdrawalEarnings(freshUser, snap.withdrawalAmount);
        if (result2) await captureLeftovers(result2);

        distributionsRun++;
      } catch (distErr) {
        console.error(`⚠️ Distribution error for user ${snap.userId}:`, distErr.message);
      }
    }
    console.log(`[transferShortVideoToECart] Phase 2 Over (success) at ${new Date().toISOString()}`)
    return res.status(200).json({
      success: true,
      message: "Funds transferred successfully from shortVideo → eCart, distributions applied",
      data: {
        totalUsers: users.length,
        totalTransferred,
        transferLogs: totalLogs,
        distributions: distributionsRun,
        skippedUsers: users.length - snapshots.length
      }
    });

  } catch (err) {
    console.error("Transfer Error:", err);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: err.message
    });
  }
};


exports.rechargeSystemWallet = async (req, res) => {
  try {
    const { amount, context } = req.body;

    // Basic validation
    if (!amount || typeof amount !== 'number' || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid amount. Must be a positive number.",
        data: null
      });
    }

    const systemWallet = await SystemWallet.findOneAndUpdate(
      {},
      { $inc: { totalBalance: amount } },
      { new: true, upsert: true }
    );

    // Create a log
    const log = new SystemEarningLog({
      amount,
      type: 'inflow',
      source: 'topUp',
      context,
      status: 'success'
    });

    await log.save();

    return res.status(200).json({
      success: true,
      message: `System wallet recharged successfully with ₹${amount}`,
      data: {
        wallet: {
          totalBalance: systemWallet.totalBalance,
        },
        logId: log._id
      }
    });

  } catch (error) {
    console.error('Recharge Error:', error);

    return res.status(400).json({
      success: false,
      message: 'Something went wrong while recharging the system wallet.',
      data: null
    });
  }
};




exports.adminSystemHealth = (req, res)=>{
  console.log("cron job silly");
  return res.status(200).json({success: true});
}