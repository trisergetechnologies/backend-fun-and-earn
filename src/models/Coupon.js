const mongoose = require('mongoose');

const CouponSchema = new mongoose.Schema({
  code: {
    type: String,
    required: true,
    unique: true
  },
  title: {
    type: String,
    default: 'Earned Coupon'
  },
  description: {
    type: String,
    default: "Valid once per user. Redeem on Short Videos."
  },

  earnedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  earnedFromOrder: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order'
  },

  // Whether coupon is still valid for use
  isActive: {
    type: Boolean,
    default: true
  },

  // Whether coupon has already been synced to short video system
  isRedeemed: {
    type: Boolean,
    default: false
  },

  // not applicable for now
  expiresAt: {
    type: Date
  }

}, { timestamps: true });

module.exports = mongoose.model('Coupon', CouponSchema);
