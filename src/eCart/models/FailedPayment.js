const mongoose = require('mongoose');

const FailedPaymentSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  paymentId: {
    type: String,
    required: true,
    unique: true
  },

  paidAmount: {
    type: Number,
    required: true
  },

  walletUsed: {
    type: Number,
    default: 0
  },

  gateway: {
    type: String,
    default: 'mock' // or 'razorpay', etc.
  },

  reason: {
    type: String,
    required: true
  },

  refunded: {
    type: Boolean,
    default: false
  },

  refundId: {
    type: String,
    default: null
  }

}, { timestamps: true });

module.exports = mongoose.model('FailedPayment', FailedPaymentSchema);
