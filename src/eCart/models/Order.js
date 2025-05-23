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
  priceAtPurchase: {
    type: Number,
    required: true
  },
  finalPriceAtPurchase: {
    type: Number,
    required: true
  }
}, { _id: false });

const OrderSchema = new mongoose.Schema({
  buyerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  items: [OrderItemSchema],

  deliveryAddress: AddressSnapshotSchema, // snapshot of address at time of order

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
    enum: ['placed', 'processing', 'shipped', 'delivered', 'cancelled'],
    default: 'placed'
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
  }

}, { timestamps: true });

module.exports = mongoose.model('Order', OrderSchema);
