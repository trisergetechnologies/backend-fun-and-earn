const mongoose = require('mongoose');

const PackageSchema = new mongoose.Schema({
  name: {
    type: String,
    enum: ['Basic', 'Starter', 'Gold', 'Diamond'],
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
  levelUpto: {
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

// Active catalog: find({ isActive: true }).sort({ price: 1 })
PackageSchema.index({ isActive: 1, price: 1 });

module.exports = mongoose.model('Package', PackageSchema);
