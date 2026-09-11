const mongoose = require('mongoose');

const AutopoolUpgradeCreditLedgerSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: {
      type: String,
      enum: ['earn', 'spend', 'reset'],
      required: true,
    },
    amount: { type: Number, required: true },
    balanceAfter: { type: Number, required: true },
    idempotencyKey: { type: String, required: true, unique: true },
    referralEventId: { type: String, default: null },
    joinIdempotencyKey: { type: String, default: null },
    reason: { type: String, default: '' },
  },
  { timestamps: true }
);

module.exports = mongoose.model(
  'AutopoolUpgradeCreditLedger',
  AutopoolUpgradeCreditLedgerSchema
);
