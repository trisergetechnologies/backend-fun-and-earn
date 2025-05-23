const mongoose = require('mongoose');

const ProductSchema = new mongoose.Schema({
  sellerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  categoryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    required: true
  },

  title: {
    type: String,
    required: true,
    trim: true
  },

  description: {
    type: String,
    trim: true
  },

  images: [{
    type: String  // URL or filename
  }],

  price: {
    type: Number,
    required: true,
    min: 0
  },

  discountPercent: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },

  finalPrice: {
    type: Number,
    required: true,
    min: 0
  },

  stock: {
    type: Number,
    required: true,
    min: 0
  },

  isActive: {
    type: Boolean,
    default: true
  },

  createdByRole: {
    type: String,
    enum: ['admin', 'seller'],
    required: true
  }

}, { timestamps: true });

module.exports = mongoose.model('Product', ProductSchema);
