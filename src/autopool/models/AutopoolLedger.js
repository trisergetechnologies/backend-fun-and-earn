const mongoose = require('mongoose');

const AutopoolLedgerSchema = new mongoose.Schema(
  {
    idempotencyKey: { type: String, required: true, unique: true },
    type: {
      type: String,
      enum: [
        'manual_entry_debit',
        'wallet_reward',
        'same_pool_continuation',
        'next_pool_reserve',
        'admin_allocation',
        'feature_reserve',
        'next_pool_join_consume',
      ],
      required: true,
    },
    amount: { type: Number, required: true, min: 0 },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    poolLevel: { type: Number, default: null },
    participationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AutopoolParticipation',
      default: null,
    },
    cycleId: { type: mongoose.Schema.Types.ObjectId, ref: 'AutopoolCycle', default: null },
    allocationType: { type: String, default: null },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

AutopoolLedgerSchema.index({ userId: 1, createdAt: -1 });
AutopoolLedgerSchema.index({ type: 1, createdAt: -1 });

module.exports = mongoose.model('AutopoolLedger', AutopoolLedgerSchema);
