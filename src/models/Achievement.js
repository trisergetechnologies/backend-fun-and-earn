const mongoose = require('mongoose');

const AchievementSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },

  // Their highest unlocked achievement
  level: { type: Number, required: true }, 
  title: { type: String, required: true },

  // Lifetime achievement (no weekly reset)
  achievedAt: { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model('Achievement', AchievementSchema);
