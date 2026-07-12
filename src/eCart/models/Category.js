const mongoose = require('mongoose');

const CategorySchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },

  slug: {
    type: String,
    required: true,
    unique: true,
    lowercase: true
  },

  description: {
    type: String,
    default: ''
  },

  /** Ionicons glyph name used by Dream Mart (e.g. shirt-outline) */
  icon: {
    type: String,
    default: 'grid-outline',
    trim: true,
  },

  ownerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  ownerRole: {
    type: String,
    enum: ['seller', 'admin'],
    required: true
  },

  isActive: {
    type: Boolean,
    default: true
  }

}, { timestamps: true });

module.exports = mongoose.model('Category', CategorySchema);
