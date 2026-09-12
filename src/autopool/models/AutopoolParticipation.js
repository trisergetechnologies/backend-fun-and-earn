const mongoose = require('mongoose');

const ConfigSnapshotSchema = new mongoose.Schema(
  {
    entryAmount: { type: Number, required: true },
    collectionMultiplier: { type: Number, default: 2 },
    maxCycles: { type: Number, default: 10 },
    samePoolPercent: { type: Number, default: 50 },
    walletPercent: { type: Number, default: 20 },
    nextPoolPercent: { type: Number, default: 20 },
    adminPercent: { type: Number, default: 5 },
    featurePercent: { type: Number, default: 5 },
    configVersion: { type: Number, default: 1 },
  },
  { _id: false }
);

const AutopoolParticipationSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    poolLevel: { type: Number, required: true, min: 1, max: 10 },
    status: {
      type: String,
      enum: ['PENDING', 'ACTIVE', 'COMPLETED'],
      default: 'PENDING',
      index: true,
    },
    entryAmount: { type: Number, required: true },
    cycleCount: { type: Number, default: 0, min: 0 },
    entryType: {
      type: String,
      enum: ['manual', 'next_pool', 'continuation', 'bootstrap'],
      required: true,
    },
    configSnapshot: { type: ConfigSnapshotSchema, required: true },
    manualEntryId: { type: String, default: null, index: true },
    fundedByParticipationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AutopoolParticipation',
      default: null,
    },
    fundedByCycleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AutopoolCycle',
      default: null,
    },
    nextPoolEligibleAmount: { type: Number, default: 0 },
    upgradeUsedAt: { type: Date, default: null },
    releasedAt: { type: Date, default: null },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    placementId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AutopoolPlacement',
      default: null,
    },
    isBootstrap: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// One occupying participation per user per pool (releasedAt null)
AutopoolParticipationSchema.index(
  { userId: 1, poolLevel: 1 },
  {
    unique: true,
    partialFilterExpression: { releasedAt: null },
  }
);

AutopoolParticipationSchema.index({ poolLevel: 1, status: 1, createdAt: 1 });

module.exports = mongoose.model('AutopoolParticipation', AutopoolParticipationSchema);
