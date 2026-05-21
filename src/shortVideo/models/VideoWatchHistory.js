const mongoose = require('mongoose');

const VideoWatchHistorySchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  videoId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Video',
    required: true
  },

  watchedDuration: {
    type: Number,
    required: true,
    min: 1
  },

  rewarded: {
    type: Boolean,
    default: false
  }

}, { timestamps: true });

// logWatchTime: findOne({ userId, videoId })
VideoWatchHistorySchema.index({ userId: 1, videoId: 1 });

module.exports = mongoose.model('VideoWatchHistory', VideoWatchHistorySchema);
