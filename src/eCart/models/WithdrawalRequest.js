const mongoose = require('mongoose');

const WithdrawalRequestSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  // Wallet type (currently only eCartWallet supported)
  walletType: {
    type: String,
    enum: ['eCartWallet'],
    default: 'eCartWallet',
    required: true
  },

  // Amount user wants to withdraw from wallet
  amount: {
    type: Number,
    required: true,
    min: 1
  },

  // TDS = 5% of amount (2.5% of the original)
  tdsAmount: {
    type: Number,
    required: true
  },

  // Final amount to be paid to user
  payoutAmount: {
    type: Number,
    required: true
  },

  // Bank snapshot (in case user changes bank later)
  bankDetailsSnapshot: {
    accountHolderName: String,
    accountNumber: String,
    ifscCode: String,
    upiId: String
  },

  // Current status
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  },

  // Optional: link to wallet transaction
  walletTransactionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'WalletTransaction'
  },

  // Admin handling
  adminRemarks: {
    type: String
  },

  processedAt: {
    type: Date
  }

}, { timestamps: true });

module.exports = mongoose.model('WithdrawalRequest', WithdrawalRequestSchema);
