// models/UserAchievement.js
const mongoose = require('mongoose');

const AchievementSchema = new mongoose.Schema({
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

// Ensure one user cannot have the same achievement level recorded twice
AchievementSchema.index({ userId: 1, level: 1 }, { unique: true });

module.exports = mongoose.model('Achievement', AchievementSchema);
