const User = require("../../../models/User");
const Video = require("../../models/Video");
const VideoLike = require("../../models/VideoLike");
const VideoWatchHistory = require("../../models/VideoWatchHistory");

exports.getFeed = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 10;
    const videos = await Video.find({ isActive: true })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    res.status(200).json({
      success: true,
      message: 'Feed fetched successfully',
      data: videos
    });
  } catch (err) {
    console.error('Feed error:', err);
    res.status(500).json({
      success: false,
      message: 'Server error',
      data: null
    });
  }
};


exports.logWatchTime = async (req, res) => {
  try {
    const { videoId, watchedDuration } = req.body;
    const userId = req.user._id;

    if (!videoId || !watchedDuration || watchedDuration <= 0 || watchedDuration > 60) {
      return res.status(200).json({
        success: false,
        message: 'Invalid data',
        data: null
      });
    }

    // Check if the user already has a watch history for this video
    const existingHistory = await VideoWatchHistory.findOne({ userId, videoId });

    if (existingHistory) {
      existingHistory.watchedDuration += watchedDuration;
      await existingHistory.save();
    } else {
      await VideoWatchHistory.create({
        userId,
        videoId,
        watchedDuration,
        rewarded: true
      });
    }

    // Update user's wallet and total watch time
    await User.findByIdAndUpdate(userId, {
      $inc: {
        'wallets.shortVideoWallet': watchedDuration,
        'shortVideoProfile.watchTime': watchedDuration
      }
    });

    res.status(200).json({
      success: true,
      message: `Added ${watchedDuration} points`,
      data: { points: watchedDuration }
    });
  } catch (err) {
    console.error('Watch error:', err);
    res.status(500).json({
      success: false,
      message: 'Server error',
      data: null
    });
  }
};


exports.toggleLike = async (req, res) => {
  try {
    const { videoId } = req.body;
    const userId = req.user._id;

    const existing = await VideoLike.findOne({ userId, videoId });

    if (existing) {
      await VideoLike.deleteOne({ _id: existing._id });
      await Video.findByIdAndUpdate(videoId, { $inc: { likes: -1 } });

      return res.status(200).json({
        success: true,
        message: 'Unliked',
        data: null
      });
    } else {
      await VideoLike.create({ userId, videoId });
      await Video.findByIdAndUpdate(videoId, { $inc: { likes: 1 } });

      return res.status(201).json({
        success: true,
        message: 'Liked',
        data: null
      });
    }
  } catch (err) {
    console.error('Like error:', err);
    res.status(500).json({
      success: false,
      message: 'Server error',
      data: null
    });
  }
};
