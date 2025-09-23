const mongoose = require('mongoose');

const SystemEarningLogSchema = new mongoose.Schema({
  amount: {
    type: Number,
    required: true,
    min: 0
  },

  source: {
    type: String,
    enum: ['networkPurchase', 'teamPurchase', 'networkWithdrawal', 'teamWithdrawal'],
    required: true
  },

  fromUser: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  context: {
    type: String,
    default: '' // e.g. "Gold limit (10 of 14 ups)"
  },

  status: {
    type: String,
    enum: ['success', 'failed'],
    default: 'success'
  }
}, { timestamps: true });

module.exports = mongoose.model('SystemEarningLog', SystemEarningLogSchema);
