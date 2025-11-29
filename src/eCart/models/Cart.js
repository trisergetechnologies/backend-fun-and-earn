// e-cart/models/Cart.js
const mongoose = require('mongoose');

const CartItemSchema = new mongoose.Schema({
  productId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },
  quantity: {
    type: Number,
    required: true,
    min: 1
  }
}, { _id: false });

const CartSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    unique: true, // One cart per user
    required: true
  },

  items: [CartItemSchema],
  
  totalGstAmount: {
    type: Number,
    default: 0
  },

  deliveryCharge:{
    type: Number,
    default: 0
  },

  useWallet: {
    type: Boolean,
    default: false
  }

}, { timestamps: true });

module.exports = mongoose.model('Cart', CartSchema);
