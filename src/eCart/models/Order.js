const mongoose = require('mongoose');

const AddressSnapshotSchema = new mongoose.Schema({
  addressName: String,
  fullName: String,
  street: String,
  city: String,
  state: String,
  pincode: String,
  phone: String
}, { _id: false });

const OrderItemSchema = new mongoose.Schema({
  productId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },
  sellerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  quantity: {
    type: Number,
    required: true
  },

  // Snapshot fields (immutable record)
  priceAtPurchase: {
    type: Number,
    required: true
  },
  finalPriceAtPurchase: {
    type: Number,
    required: true
  },
  productTitle: {
    type: String,
    required: true
  },
  productThumbnail: {
    type: String
  },
  returnPolicyDays: {
    type: Number,
    default: 3
  }
}, { _id: false });

const OrderSchema = new mongoose.Schema({
  buyerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  items: [OrderItemSchema],

  deliveryAddress: AddressSnapshotSchema, // captured at time of placing

  usedWalletAmount: {
    type: Number,
    default: 0
  },

  usedCouponCode: {
    type: String,
    default: null
  },

  totalAmount: {
    type: Number,
    required: true
  },

  finalAmountPaid: {
    type: Number,
    required: true
  },

  paymentStatus: {
    type: String,
    enum: ['paid', 'failed'],
    default: 'paid'
  },

  status: {
    type: String,
    enum: ['placed', 'processing', 'shipped', 'delivered', 'cancelled', 'returned'],
    default: 'placed'
  },

  paymentInfo: {
    gateway: { type: String, default: 'mock' },  // or 'razorpay'
    paymentId: { type: String }
  },

  cancelRequested: {
    type: Boolean,
    default: false
  },

  cancelReason: {
    type: String
  },

  refundStatus: {
    type: String,
    enum: ['not_applicable', 'pending', 'refunded'],
    default: 'not_applicable'
  },

  returnRequested: {
    type: Boolean,
    default: false
  },

  returnReason: {
    type: String,
    default: null
  },

  returnStatus: {
    type: String,
    enum: ['none', 'pending', 'approved', 'rejected', 'completed'],
    default: 'none'
  },

  trackingUpdates: [{
  status: {
    type: String,
    enum: ['placed', 'processing', 'shipped', 'delivered', 'cancelled', 'returned']
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  note: {
    type: String,
    default: ''
  }
}]

}, { timestamps: true });

module.exports = mongoose.model('Order', OrderSchema);
