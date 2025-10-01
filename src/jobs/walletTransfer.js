import cron from 'node-cron';
import User from '../models/User';
import WalletTransaction from '../models/WalletTransaction';
import SystemEarningLog from '../models/SystemEarningLog';



exports.transferShortVideoToECart = async () => {
  try {
    // Phase 1: Sweep all users with balance
    const users = await User.find({ "wallets.shortVideoWallet": { $gt: 0 } });
    if (!users || users.length === 0) {
      return {
        success: false,
        message: "No users with shortVideo balance",
        data: null
      };
    }

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
          await SystemEarningLog.create({
            amount: withdrawalAmount,
            type: "outflow",
            source: "shortVideoToECart",
            fromUser: freshUser._id,
            breakdown: { transfer: transferToECart },
            context: `Snapshot withdrawal for user ${freshUser._id}`,
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

    // Phase 2: Run distributions + leftovers
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

    return {
      success: true,
      message: "Funds transferred successfully from shortVideo → eCart, distributions applied",
      data: {
        totalUsers: users.length,
        totalTransferred,
        transferLogs: totalLogs,
        distributions: distributionsRun,
        skippedUsers: users.length - snapshots.length
      }
    };

  } catch (err) {
    console.error("Transfer Error:", err);
    return {
      success: false,
      message: "Internal Server Error",
      error: err.message
    };
  }
};




// Schedule to run every day at 2:00 AM
cron.schedule('0 6 * * *', async () => {
  console.log('Running daily job at 2:00 AM');
  
    await transferShortVideoToECart();

  console.log('Job complete');

});

