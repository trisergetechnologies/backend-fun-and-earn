const mongoose = require('mongoose');

const AutopoolReferralEventSchema = new mongoose.Schema(
  {
    eventId: { type: String, required: true, unique: true },
    manualEntryId: { type: String, required: true, unique: true },
    referrerUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    referredUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    referrerSerialNumber: { type: Number, required: true },
    participationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AutopoolParticipation',
      required: true,
    },
    poolLevel: { type: Number, default: 1 },
    source: { type: String, default: 'manual_dream_points_entry' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('AutopoolReferralEvent', AutopoolReferralEventSchema);
