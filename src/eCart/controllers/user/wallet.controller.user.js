const mongoose = require('mongoose');
const User = require("../../../models/User");
const WalletTransaction = require("../../../models/WalletTransaction");
const { distributeTeamWithdrawalEarnings } = require('../../../shortVideo/helpers/distributeTeamWithdrawalEarnings');
const { distributeNetworkWithdrawalEarnings } = require('../../../shortVideo/helpers/distributeNetworkWithdrawalEarnings');
const Coupon = require('../../../models/Coupon');

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
        eCartWallet: user.wallets.eCartWallet,
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
    
    await captureLeftovers.captureLeftoversForWithdrawal(user, amount, {
      actionId: `withdraw-${user._id}-${Date.now()}`
    });

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