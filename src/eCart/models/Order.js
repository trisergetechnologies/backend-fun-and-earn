const mongoose = require('mongoose');
const crypto = require('crypto');

function generatePublicOrderId() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const rand = crypto.randomBytes(5).toString('hex').toUpperCase();
  return `ORD-${y}${m}${day}-${rand}`;
}

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
  },
  selectedVariation: [{
    name: { type: String },
    value: { type: String }
  }]
}, { _id: false });

const OrderSchema = new mongoose.Schema({
  buyerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  /** Human-facing stable id (e.g. ORD-20260404-AB12CD34EF); set on first save for new orders. */
  publicOrderId: {
    type: String,
    unique: true,
    sparse: true,
    trim: true,
    index: true,
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

  totalGstAmount: {
    type: Number,
  },

  paymentStatus: {
    type: String,
    enum: ['paid', 'failed', 'pending', 'authorized', ],
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

  deliveryCharge:{
    type: Number,
    default: 0
  },

  isPackageCronProcessed: {
    type: Boolean,
    default: false
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

OrderSchema.pre('save', async function assignPublicOrderIdAndDefaults() {
  if (this.isPackageCronProcessed === undefined || this.isPackageCronProcessed === null) {
    this.isPackageCronProcessed = false;
  }
  if (this.isNew && !this.publicOrderId) {
    const Model = this.constructor;
    const session = this.$session && this.$session();
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const candidate = generatePublicOrderId();
      let q = Model.findOne({ publicOrderId: candidate }).select('_id').lean();
      if (session) q = q.session(session);
      const taken = await q;
      if (!taken) {
        this.publicOrderId = candidate;
        break;
      }
    }
    if (!this.publicOrderId) {
      throw new Error('Could not assign publicOrderId');
    }
  }
});

module.exports = mongoose.model('Order', OrderSchema);
