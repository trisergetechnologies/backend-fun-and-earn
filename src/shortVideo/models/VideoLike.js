const mongoose = require('mongoose');

const VideoLikeSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  videoId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Video',
    required: true
  }

}, { timestamps: true });

VideoLikeSchema.index({ userId: 1, videoId: 1 }, { unique: true }); // prevent duplicate likes

module.exports = mongoose.model('VideoLike', VideoLikeSchema);
