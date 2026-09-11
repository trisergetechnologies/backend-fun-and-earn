const mongoose = require('mongoose');

const AutopoolPlacementSchema = new mongoose.Schema(
  {
    poolLevel: { type: Number, required: true, min: 1, max: 10, index: true },
    participationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AutopoolParticipation',
      required: true,
      index: true,
    },
    /** Which cycle-generation this open-slot row belongs to (0 = initial). */
    generation: { type: Number, default: 0 },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    parentParticipationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AutopoolParticipation',
      default: null,
      index: true,
    },
    /** left | right | root */
    slot: {
      type: String,
      enum: ['root', 'left', 'right'],
      required: true,
    },
    status: {
      type: String,
      enum: ['WAITING', 'PLACED', 'CYCLE_DONE'],
      default: 'WAITING',
      index: true,
    },
    queueSequence: { type: Number, required: true },
    leftChildParticipationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AutopoolParticipation',
      default: null,
    },
    rightChildParticipationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AutopoolParticipation',
      default: null,
    },
    openSlots: { type: Number, default: 2, min: 0, max: 2 },
    filledAt: { type: Date, default: null },
  },
  { timestamps: true }
);

AutopoolPlacementSchema.index({ poolLevel: 1, queueSequence: 1 });
AutopoolPlacementSchema.index({
  poolLevel: 1,
  openSlots: 1,
  queueSequence: 1,
  status: 1,
});

module.exports = mongoose.model('AutopoolPlacement', AutopoolPlacementSchema);
