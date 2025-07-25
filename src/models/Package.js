const mongoose = require('mongoose');

const PackageSchema = new mongoose.Schema({
  name: {
    type: String,
    enum: ['Gold', 'Diamond'],
    required: true,
    unique: true
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
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, { timestamps: true });

module.exports = mongoose.model('Package', PackageSchema);
