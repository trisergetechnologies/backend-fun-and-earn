const mongoose = require('mongoose');

/**
 * Per-target-pool waiting room for automatic next-pool upgrades.
 * FIFO by (targetPoolLevel, status=WAITING, enqueuedAt).
 */
const AutopoolWaitingRoomSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    targetPoolLevel: { type: Number, required: true, min: 2, max: 13, index: true },
    sourceParticipationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AutopoolParticipation',
      required: true,
    },
    eligibilityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AutopoolNextPoolEligibility',
      required: true,
    },
    entryAmount: { type: Number, required: true, min: 0 },
    status: {
      type: String,
      enum: ['WAITING', 'JOINED', 'CANCELLED'],
      default: 'WAITING',
      index: true,
    },
    enqueuedAt: { type: Date, default: Date.now, index: true },
    joinedAt: { type: Date, default: null },
    joinedParticipationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AutopoolParticipation',
      default: null,
    },
  },
  { timestamps: true }
);

AutopoolWaitingRoomSchema.index(
  { targetPoolLevel: 1, status: 1, enqueuedAt: 1 },
  { name: 'wr_fifo_by_pool' }
);

AutopoolWaitingRoomSchema.index(
  { sourceParticipationId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'WAITING' },
    name: 'wr_unique_waiting_source',
  }
);

AutopoolWaitingRoomSchema.index(
  { userId: 1, targetPoolLevel: 1, status: 1 },
  { name: 'wr_user_pool_status' }
);

module.exports = mongoose.model('AutopoolWaitingRoom', AutopoolWaitingRoomSchema);
