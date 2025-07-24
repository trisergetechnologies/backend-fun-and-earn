const mongoose = require('mongoose');
const User = require("../../../models/User");
const WalletTransaction = require("../../../models/WalletTransaction");
const { distributeTeamWithdrawalEarnings } = require('../../../shortVideo/helpers/distributeTeamWithdrawalEarnings');
const { distributeNetworkWithdrawalEarnings } = require('../../../shortVideo/helpers/distributeNetworkWithdrawalEarnings');

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
  // Example: Integrate with Razorpay, Cashfree, etc.
  console.log(`Payout initiated to ${bankDetails.accountHolderName} (Amount: ₹${amount})`);
  return { success: true, transactionId: `TXN-${Date.now()}` }; // Simulated success
}

exports.withdrawFunds = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const userId = req.user._id;
    const { amount, bankDetails } = req.body;

    if (!amount || amount <= 0 || !bankDetails || !bankDetails.accountNumber || !bankDetails.upiId) {
      return res.status(200).json({
        success: false,
        message: 'Missing or invalid withdrawal details',
        data: null
      });
    }

    const user = await User.findById(userId).session(session);
    if (!user) throw new Error('User not found');

    if (!user.wallets.shortVideoWallet || user.wallets.shortVideoWallet < amount) {
      return res.status(200).json({
        success: false,
        message: 'Insufficient short video wallet balance',
        data: null
      });
    }

    // Deduct wallet amount
    user.wallets.shortVideoWallet -= amount;
    await user.save({ session });

    // Save transaction log
    const tx = await new WalletTransaction({
      userId,
      type: 'withdraw',
      source: 'manual',
      fromWallet: 'shortVideoWallet',
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
