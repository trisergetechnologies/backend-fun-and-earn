const mongoose = require('mongoose');

const EarningLogSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  amount: {
    type: Number,
    required: true,
    min: 0
  },

  source: {
    type: String,
    enum: ['teamPurchase', 'networkPurchase', 'teamWithdrawal', 'networkWithdrawal', 'watchTime', 'weeklyReward', 'monthlyReward'],
    required: true
  },

  fromUser: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },

  context: {
    type: String,
    default: ''
  },

  triggeredBy: {
    type: String,
    enum: ['system', 'admin'],
    default: 'system'
  },

  notes: {
    type: String
  },

  status: {
    type: String,
    enum: ['success', 'failed'],
    default: 'success'
  }
}, { timestamps: true });

module.exports = mongoose.model('EarningLog', EarningLogSchema);
