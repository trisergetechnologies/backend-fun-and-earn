const mongoose = require('mongoose');

/** Singleton Autopool system buckets (not weekly/monthly SystemWallet). */
const AutopoolSystemBalancesSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'global', unique: true },
    featureReserve: { type: Number, default: 0, min: 0 },
    adminAllocation: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model('AutopoolSystemBalances', AutopoolSystemBalancesSchema);
