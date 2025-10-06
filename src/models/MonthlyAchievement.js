const mongoose = require('mongoose');

const MonthlyAchievementSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  level: {
    type: Number,
    required: true
  },

  title: {
    type: String,
    required: true
  },

  achievedAt: {
    type: Date,
    default: Date.now
  }
}, { timestamps: true });

// ✅ Ensure one user cannot have the same monthly achievement level twice
MonthlyAchievementSchema.index({ userId: 1, level: 1 }, { unique: true });

module.exports = mongoose.model('MonthlyAchievement', MonthlyAchievementSchema);