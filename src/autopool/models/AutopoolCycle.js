const mongoose = require('mongoose');

const AutopoolCycleSchema = new mongoose.Schema(
  {
    participationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AutopoolParticipation',
      required: true,
    },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    poolLevel: { type: Number, required: true },
    cycleNumber: { type: Number, required: true, min: 1 },
    collectionAmount: { type: Number, required: true },
    samePoolAmount: { type: Number, default: 0 },
    walletAmount: { type: Number, default: 0 },
    nextPoolAmount: { type: Number, default: 0 },
    adminAmount: { type: Number, default: 0 },
    featureAmount: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ['PENDING', 'DISTRIBUTED'],
      default: 'DISTRIBUTED',
    },
    idempotencyKey: { type: String, required: true, unique: true },
    completedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

AutopoolCycleSchema.index({ participationId: 1, cycleNumber: 1 }, { unique: true });
AutopoolCycleSchema.index({ userId: 1 });

module.exports = mongoose.model('AutopoolCycle', AutopoolCycleSchema);
