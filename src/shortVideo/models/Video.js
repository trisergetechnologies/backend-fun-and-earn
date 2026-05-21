const mongoose = require('mongoose');

const VideoSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  title: { type: String, default: '' },
  description: { type: String, default: '' },
  videoUrl: { type: String, required: true },
  thumbnailUrl: { type: String, default: '' },

  durationInSec: { type: Number, required: true, max: 60 },
  sizeInMB: { type: Number, required: true },

  views: { type: Number, default: 0 },
  likes: { type: Number, default: 0 },

  bunnyFilePath: { type: String, required: true }, // Full storage path used for deletion
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

// User uploads / admin profile: find({ userId }).sort({ createdAt: -1 })
VideoSchema.index({ userId: 1, createdAt: -1 });
// Feed: match({ isActive: true })
VideoSchema.index({ isActive: 1 });

module.exports = mongoose.model('Video', VideoSchema);
