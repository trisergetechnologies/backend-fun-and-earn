const mongoose = require('mongoose');

/** Global Autopool feature flag + settings (singleton). */
const AutopoolSettingsSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'global', unique: true },
    enabled: { type: Boolean, default: false },
    bootstrapUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('AutopoolSettings', AutopoolSettingsSchema);
