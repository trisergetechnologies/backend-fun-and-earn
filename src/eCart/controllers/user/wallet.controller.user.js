const mongoose = require('mongoose');
const User = require("../../../models/User");
const WalletTransaction = require("../../../models/WalletTransaction");
const { distributeTeamWithdrawalEarnings } = require('../../../shortVideo/helpers/distributeTeamWithdrawalEarnings');
const { distributeNetworkWithdrawalEarnings } = require('../../../shortVideo/helpers/distributeNetworkWithdrawalEarnings');
const Coupon = require('../../../models/Coupon');
const WithdrawalRequest = require('../../models/WithdrawalRequest');

exports.getWallet = async (req, res) => {
  const userId = req.user._id;

  try {
    const user = await User.findById(userId).select('wallets.eCartWallet');

    if (!user) {
      return res.status(200).json({
        success: false,
        message: 'User not found'
      });
    }

    return res.status(200).json({
      success: true,
      message: 'E-Cart wallet balance fetched',
      data: {
        eCartWallet: typeof user.wallets?.eCartWallet === 'number'
          ? Number(user.wallets.eCartWallet.toFixed(2))
          : 0,
      }
    });

  } catch (err) {
    console.error('getWallet error:', err.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch wallet data'
    });
  }
};


exports.getWalletTransactions = async (req, res) => {
  try {
    const userId = req.user._id;

    // Fetch transactions from DB directly, sorted by newest first
    const transactions = await WalletTransaction.find({ userId }).sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: transactions.length,
      data: transactions,
    });

  } catch (error) {
    console.error('Error fetching wallet transactions:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};


// Dummy payout function — replace with actual bank integration logic
async function payout({ userId, bankDetails, amount }) {

  console.log(`Payout initiated to ${bankDetails.accountHolderName} (Amount: ₹${amount})`);
  return { success: true, transactionId: `TXN-${Date.now()}` };
}

exports.withdrawFunds = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const userId = req.user._id;

    const user = await User.findById(userId).session(session);
    if (!user) throw new Error('User not found');

    const bankDetails = user.eCartProfile?.bankDetails || null;
    const amount = user.wallets?.eCartWallet || 0;


    if (!bankDetails || !bankDetails?.accountNumber || !bankDetails?.accountHolderName || !bankDetails?.ifscCode) {
      return res.status(200).json({
        success: false,
        message: 'Add bank details in profile',
        data: null
      });
    }

    if (!amount || amount < 100) {
      return res.status(200).json({
        success: false,
        message: 'Minimum withdrawal amount is 100',
        data: null
      });
    }

    if (!user.wallets?.eCartWallet || user.wallets?.eCartWallet < amount) {
      return res.status(200).json({
        success: false,
        message: 'Insufficient wallet balance',
        data: null
      });
    }

    // Deduct wallet amount
    user.wallets.eCartWallet -= amount;
    await user.save({ session });

    // Save transaction log
    const tx = await new WalletTransaction({
      userId,
      type: 'withdraw',
      source: 'manual',
      fromWallet: 'eCartWallet',
      amount,
      status: 'pending',
      triggeredBy: 'user',
      notes: `Withdrawal request`
    }).save({ session });

    // Commit transaction before payout
    await session.commitTransaction();
    session.endSession();

    // Process payout (simulate bank call)
    const payoutResult = await payout({ userId, bankDetails, amount });

    if (!payoutResult.success) {
      tx.status = 'failed';
      tx.notes = 'Bank payout failed';
      await tx.save();
      return res.status(200).json({
        success: false,
        message: 'Payout failed. Please try again later.',
        data: null
      });
    }

    // Mark transaction success
    tx.status = 'success';
    tx.notes = `Withdrawal successful (Txn ID: ${payoutResult.transactionId})`;
    await tx.save();

    // Trigger earnings distribution
    await distributeTeamWithdrawalEarnings(userId, amount);
    await distributeNetworkWithdrawalEarnings(user, amount);
    
    return res.status(200).json({
      success: true,
      message: 'Withdrawal processed successfully',
      data: {
        amount,
        transactionId: payoutResult.transactionId,
        balance: user.wallets.shortVideoWallet
      }
    });

  } catch (err) {
    console.error('Withdrawal Error:', err);
    await session.abortTransaction();
    session.endSession();

    return res.status(200).json({
      success: false,
      message: 'Internal Server Error',
      data: null
    });
  }
};


exports.redeemCoupon = async (req, res) => {
  try {
    const { code } = req.body;
    const userId = req.user._id;

    const coupon = await Coupon.findOne({ code, earnedBy: userId, isActive: true, isRedeemed: false });
    if (!coupon) {
      return res.status(200).json({
        success: false,
        message: 'Invalid or already redeemed coupon',
        data: null
      });
    }

    const user = await User.findById(userId);

    // Update wallet
    user.wallets.eCartWallet += coupon.value;

    // Remove from rewardWallet
    user.wallets.rewardWallet = user.wallets.rewardWallet.filter(id => id.toString() !== coupon._id.toString());
    await user.save();

    // Record wallet transaction
    await WalletTransaction.create({
      userId,
      type: 'earn',
      source: 'coupon',
      fromWallet: 'reward',
      toWallet: 'eCartWallet',
      amount: coupon.value,
      status: 'success',
      triggeredBy: 'user',
      notes: `Redeemed coupon: ${coupon.code}`
    });

    // Remove coupon
    await Coupon.findByIdAndDelete(coupon._id);

    res.status(200).json({
      success: true,
      message: 'Coupon redeemed successfully',
      data: { amount: coupon.value }
    });
  } catch (err) {
    console.error('Redeem error:', err);
    res.status(500).json({
      success: false,
      message: 'Server error',
      data: null
    });
  }
};


function round2(value) {
  if (isNaN(value) || value === null) return 0;
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

/**
 * 🧾 1️⃣ requestWithdrawal
 * User requests withdrawal from their eCartWallet.
 * - Validates user bank details and balance.
 * - Checks if a pending withdrawal already exists.
 * - Calculates TDS (5% of amount).
 * - Creates WithdrawalRequest + WalletTransaction.
 */

exports.requestWithdrawal = async (req, res) => {
  try {
    const user = req.user;
    const { amount } = req.body;

    if (!amount || amount <= 0) {
      return res.status(200).json({
        success: false,
        message: "Invalid withdrawal amount",
        data: null
      });
    }

    // Check for pending withdrawal
    const pendingReq = await WithdrawalRequest.findOne({
      user: user._id,
      status: "pending"
    });

    if (pendingReq) {
      return res.status(200).json({
        success: false,
        message: "You already have a pending withdrawal request",
        data: null
      });
    }

    // Fetch fresh user details
    const freshUser = await User.findById(user._id).lean();
    const balance = round2(freshUser.wallets.eCartWallet || 0);

    if (balance < amount) {
      return res.status(200).json({
        success: false,
        message: "Insufficient balance",
        data: { balance }
      });
    }

    // Check for bank details
    const bank = freshUser?.eCartProfile?.bankDetails;
    if (!bank || !bank.accountNumber || !bank.ifscCode || !bank.accountHolderName) {
      return res.status(200).json({
        success: false,
        message: "Bank details missing. Please update your UPI or bank details.",
        data: null
      });
    }

    // Calculate TDS and payout
    const tdsAmount = round2(amount * 0.05); // 5% of withdrawal amount
    const payoutAmount = round2(amount - tdsAmount);

    // Create withdrawal request
    const withdrawalReq = await WithdrawalRequest.create({
      user: user._id,
      walletType: "eCartWallet",
      amount,
      tdsAmount,
      payoutAmount,
      bankDetailsSnapshot: {
        accountHolderName: bank.accountHolderName,
        accountNumber: bank.accountNumber,
        ifscCode: bank.ifscCode,
        upiId: bank.upiId || ""
      },
      status: "pending"
    });

    // Create wallet transaction
    const walletTx = await WalletTransaction.create({
      userId: user._id,
      type: "transferToBank",
      source: "manual",
      fromWallet: "eCartWallet",
      amount,
      payoutAmount,
      tdsAmount,
      linkedWithdrawalRequestId: withdrawalReq._id,
      status: "pending",
      triggeredBy: "user",
      notes: `Withdrawal request of ₹${amount} initiated. After TDS, payout will be ₹${payoutAmount}.`
    });

    // Link both
    withdrawalReq.walletTransactionId = walletTx._id;
    await withdrawalReq.save();

    return res.status(200).json({
      success: true,
      message: "Withdrawal request submitted successfully",
      data: {
        withdrawalRequest: withdrawalReq,
        walletTransaction: walletTx
      }
    });

  } catch (err) {
    console.error("Error in requestWithdrawal:", err);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: err.message
    });
  }
};