const mongoose = require('mongoose');

const WalletTransactionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  // Type of transaction
  type: {
    type: String,
    enum: ['earn', 'spend', 'transfer', 'withdraw'],
    required: true
  },

  // What caused this transaction
  source: {
    type: String,
    enum: ['watchTime', 'purchase', 'manual', 'admin'],
    required: true
  },

  // From which wallet (source of funds)
  fromWallet: {
    type: String,
    enum: ['shortVideoWallet', 'eCartWallet', 'reward'],
    required: true
  },

  // To which wallet (if internal transfer)
  toWallet: {
    type: String,
    enum: ['shortVideoWallet', 'eCartWallet', 'rewardWallet', null],
    default: null
  },

  // Amount of the transaction (can be zero for coupons or metadata)
  amount: {
    type: Number,
    required: true,
    min: 0
  },

  // Status of transaction (for async payouts or delayed processing)
  status: {
    type: String,
    enum: ['pending', 'success', 'failed'],
    default: 'pending'
  },

  // Who triggered it
  triggeredBy: {
    type: String,
    enum: ['user', 'system', 'admin'],
    default: 'system'
  },

  // Extra information (e.g. for UPI reference or coupon note)
  notes: {
    type: String
  },

  // Timestamp
}, { timestamps: true });

module.exports = mongoose.model('WalletTransaction', WalletTransactionSchema);
