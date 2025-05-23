const mongoose = require('mongoose');

// Address schema embedded in eCartProfile
const AddressSchema = new mongoose.Schema({
  addressName: String,
  slugName: { type: String, unique: true }, // Unique slug for address
  fullName: String,
  street: String,
  city: String,
  state: String,
  pincode: String,
  phone: String,
  isDefault: Boolean
}, { _id: false });

// Bank details for monthly or manual withdrawals
const BankDetailsSchema = new mongoose.Schema({
  accountHolderName: String,
  accountNumber: String,
  ifscCode: String,
  upiId: String
}, { _id: false });

// Main shared user schema across E-Cart and Short Video
const UserSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, unique: true, sparse: true }, 
  phone: { type: String, unique: true },
  password: { type: String, required: true },

  role: {
    type: String,
    enum: ['user', 'seller', 'admin'],
    default: 'user'
  },

  applications: [{
    type: String,
    enum: ['shortVideo', 'eCart'] // Indicates active apps user is onboarded with
  }],

  state_address: { type: String, default: "" }, // State or address for eCart users

  referralCode: { type: String },      // User's own referral code
  referredBy: { type: String },        // Referral code used to sign up

  // Short video-specific profile
  shortVideoProfile: {
    watchTime: { type: Number, default: 0 },            // Minutes of video watched
    videoUploads: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Video' }] // Max 100 enforced in controller
  },

  // E-Cart-specific profile
  eCartProfile: {
    addresses: [AddressSchema],
    orders: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Order' }],
    bankDetails: BankDetailsSchema // For UPI payouts
  },

  // Shared wallets used across both apps
  wallets: {
    shortVideoWallet: { type: Number, default: 0 },
    eCartWallet: { type: Number, default: 0 },
    rewardWallet: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Coupon' }]
  },

  token: { type: String, default: "jwt_token" }, // JWT token for user sessions
}, { timestamps: true });

module.exports = mongoose.model('User', UserSchema);
