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

module.exports = mongoose.model('Video', VideoSchema);
