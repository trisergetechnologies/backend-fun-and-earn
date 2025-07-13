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

module.exports = mongoose.model('VideoWatchHistory', VideoWatchHistorySchema);
