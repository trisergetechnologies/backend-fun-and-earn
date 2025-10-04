const mongoose = require('mongoose');

const SystemWalletSchema = new mongoose.Schema({
  totalBalance: { type: Number, default: 0 },   // running balance of all leftover funds
  weeklyPool: { type: Number, default: 0 },     // reserved for current week's rewards
  monthlyPool: { type: Number, default: 0 },     // reserved for monthly rewards (optional)
  adminChargeEarnedFromWithdrals: { type: Number, default: 0 }, //admin  charge earned from withdrwalas(short video wallet to eCart wallet) 10% from each
  taxToPay: {type: Number, default: 0}      // TDS amount taken from users when they withdrawn dream wallet balance to their bank account
  
}, { timestamps: true });

module.exports = mongoose.model('SystemWallet', SystemWalletSchema);
