const mongoose = require('mongoose');

const PackageOrderSchema = new mongoose.Schema({
  // Who made the purchase
  buyerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  // Which package was purchased
  packageId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Package',
    required: true
  },

  // Snapshot of package details at time of purchase
  packageSnapshot: {
    name: {
      type: String,
      enum: ['Gold', 'Diamond'],
      required: true
    },
    price: {
      type: Number,
      required: true
    },
    membersUpto: {
      type: Number,
      required: true
    },
    description: {
      type: String,
      default: ''
    },
    color: {
      type: String,
      default: ''
    },
    icon: {
      type: String,
      default: ''
    }
  },

  // Source of purchase
  source: {
    type: String,
    enum: ['user', 'admin'],
    required: true
  },

  // From which wallet or method the payment was done
  fromWallet: {
    type: String,
    enum: ['shortVideoWallet', 'eCartWallet', 'externalPayment'],
    required: true
  },

  // Total amount paid (after discounts, before/with tax)
  amount: {
    type: Number,
    required: true,
    min: 0
  },

  // Optional tax field
  tax: {
    type: Number,
    default: 0
  },

  // Transaction status
  status: {
    type: String,
    enum: ['pending', 'success', 'failed'],
    default: 'pending'
  },

  // Who triggered the transaction
  triggeredBy: {
    type: String,
    enum: ['user', 'system', 'admin'],
    default: 'system'
  },

  // Optional metadata / notes
  notes: {
    type: String,
    default: ''
  }

}, { timestamps: true });

module.exports = mongoose.model('PackageOrder', PackageOrderSchema);