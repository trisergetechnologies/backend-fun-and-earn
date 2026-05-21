const mongoose = require('mongoose');

const otpSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true
    },
    otp: {
      type: String,
      required: true
    },
    createdAt: {
      type: Date,
      default: Date.now,
      expires: 300 // 5 minutes in seconds
    }
  },
  { timestamps: true }
);

// Auth flows: findOne / deleteMany({ email }), findOne({ email, otp })
otpSchema.index({ email: 1 });
otpSchema.index({ email: 1, otp: 1 });

module.exports = mongoose.model('Otp', otpSchema);
