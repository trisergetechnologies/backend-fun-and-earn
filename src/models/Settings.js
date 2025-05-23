const mongoose = require('mongoose');

const SettingsSchema = new mongoose.Schema({
  minWithdrawalAmount: { type: Number, default: 1000 },
  autoSyncDays: { type: Number, default: 3 },           // Sync ShortVideo → E-Cart
  monthlyPayoutDay: { type: Number, default: 30 },
  referralBonus: { type: Number, default: 0 },           // Reserved for future
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Settings', SettingsSchema);
