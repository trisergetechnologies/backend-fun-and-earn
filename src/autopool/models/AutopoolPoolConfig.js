const mongoose = require('mongoose');

const DistributionSchema = new mongoose.Schema(
  {
    samePoolPercent: { type: Number, default: 50 },
    walletPercent: { type: Number, default: 20 },
    nextPoolPercent: { type: Number, default: 20 },
    adminPercent: { type: Number, default: 5 },
    featurePercent: { type: Number, default: 5 },
  },
  { _id: false }
);

const AutopoolPoolConfigSchema = new mongoose.Schema(
  {
    poolLevel: { type: Number, required: true, min: 1, max: 10, unique: true },
    entryAmount: { type: Number, required: true, min: 0 },
    collectionMultiplier: { type: Number, default: 2 },
    maxCycles: { type: Number, default: 10 },
    distribution: { type: DistributionSchema, default: () => ({}) },
    active: { type: Boolean, default: true },
    configVersion: { type: Number, default: 1 },
  },
  { timestamps: true }
);

module.exports = mongoose.model('AutopoolPoolConfig', AutopoolPoolConfigSchema);
