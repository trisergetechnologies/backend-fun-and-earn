const mongoose = require('mongoose');

const AutopoolNextPoolEligibilitySchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    sourceParticipationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AutopoolParticipation',
      required: true,
      unique: true,
    },
    sourcePoolLevel: { type: Number, required: true },
    targetPoolLevel: { type: Number, required: true },
    entryAmount: { type: Number, required: true },
    status: {
      type: String,
      enum: ['AVAILABLE', 'CONSUMED'],
      default: 'AVAILABLE',
      index: true,
    },
    earnedAt: { type: Date, default: Date.now },
    consumedAt: { type: Date, default: null },
    consumedByParticipationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AutopoolParticipation',
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model(
  'AutopoolNextPoolEligibility',
  AutopoolNextPoolEligibilitySchema
);
