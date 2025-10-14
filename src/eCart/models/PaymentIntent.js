const mongoose = require('mongoose');

const PaymentIntentSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  purpose: {
    type: String,
    enum: ['order', 'wallet'],
    default: 'order'
  },
  referenceId: { // Order._id or WalletTransaction._id etc.
    type: mongoose.Schema.Types.ObjectId
  },
  amount: { type: Number, required: true }, // INR
  currency: { type: String, default: 'INR' },
  razorpayOrderId: { type: String, default: null },
  razorpayPaymentId: { type: String, default: null },
  razorpaySignature: { type: String, default: null },
  status: {
    type: String,
    enum: ['created','authorized','captured','failed','expired','refunded'],
    default: 'created'
  },
  expiresAt: { type: Date },
  idempotencyKey: { type: String, index: true, sparse: true },
  meta: { type: Object, default: {} }
}, { timestamps: true });

module.exports = mongoose.model('PaymentIntent', PaymentIntentSchema);
