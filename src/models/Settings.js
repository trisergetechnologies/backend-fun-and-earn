const mongoose = require('mongoose');

const SettingsSchema = new mongoose.Schema({
  minWithdrawalAmount: { type: Number, default: 1000 },
  autoSyncDays: { type: Number, default: 3 },
  monthlyPayoutDay: { type: Number, default: 30 },
  referralBonus: { type: Number, default: 0 },
  deliveryMode: {
    type: String,
    enum: ['always_charge', 'no_charge', 'free_above_amount'],
    default: 'no_charge'
  },
  deliveryChargeAmount: { type: Number, default: 0 },
  freeDeliveryAbove: { type: Number, default: 500 },
  /** Reels / Unity LevelPlay */
  adsDailyInterstitialLimit: { type: Number, default: 5 },
  adsBannerEnabled: { type: Boolean, default: true },
  /** Dream Mart / AdMob */
  dreamMartAdsDailyInterstitialLimit: { type: Number, default: 1 },
  dreamMartAdsMinGapSeconds: { type: Number, default: 1800 },
  dreamMartAdsBannerEnabled: { type: Boolean, default: true },
  dreamMartAdsBannerVisibleSecondsPerDay: { type: Number, default: 600 },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Settings', SettingsSchema);
