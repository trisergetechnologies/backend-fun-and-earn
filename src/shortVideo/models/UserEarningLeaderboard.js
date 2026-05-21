'use strict';

const mongoose = require('mongoose');

const UserEarningLeaderboardSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    totalEarned: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

UserEarningLeaderboardSchema.index({ totalEarned: -1 });

module.exports = mongoose.model('UserEarningLeaderboard', UserEarningLeaderboardSchema);
