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

  images: {
    type: [String],
    validate: {
      validator(arr) {
        return !arr || arr.length <= 5;
      },
      message: 'Maximum 5 images allowed per product',
    },
  },

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

  gst: {
    type: Number,
    default: 0.05
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
  
  isSpecial:{
    type: Boolean,
    default: false
  },

  package:{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Package'
  },

  createdByRole: {
    type: String,
    enum: ['admin', 'seller'],
    required: true
  },

  variations: [{
    name: { type: String },
    options: [{ type: String }]
  }]

}, { timestamps: true });

// Category browse: find({ categoryId, isActive })
ProductSchema.index({ categoryId: 1, isActive: 1 });
// Seller admin lists
ProductSchema.index({ sellerId: 1, createdAt: -1 });
// Catalog: find({ isActive: true })
ProductSchema.index({ isActive: 1, createdAt: -1 });

module.exports = mongoose.model('Product', ProductSchema);
