const mongoose = require('mongoose');

const SystemWalletSchema = new mongoose.Schema({
  totalBalance: { type: Number, default: 0 },   // running balance of all leftover funds
  weeklyPool: { type: Number, default: 0 },     // reserved for current week's rewards
  monthlyPool: { type: Number, default: 0 }     // reserved for monthly rewards (optional)
}, { timestamps: true });

module.exports = mongoose.model('SystemWallet', SystemWalletSchema);
