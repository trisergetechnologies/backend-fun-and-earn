const User = require("../../../models/User");
const Video = require("../../models/Video");
const VideoLike = require("../../models/VideoLike");
const VideoWatchHistory = require("../../models/VideoWatchHistory");

exports.getFeed = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 10;
    const skip = (page - 1) * limit;

    // Fetch videos with pagination, sorted by creation date
    const videos = await Video.find({ isActive: true })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('userId', 'name') // only get username
      .lean();

    const formattedVideos = videos.map((video) => ({
      id: video._id,
      videoUrl: video.videoUrl,
      title: video.title,
      user: video.userId.name,
      likes: video.likes,
      comments: 0,
    }));

    return res.status(200).json({ success: true, data: formattedVideos });
  } catch (err) {
    console.error('Error fetching reel feed:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
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
