const User = require("../../../models/User");
const Video = require("../../models/Video");
const VideoLike = require("../../models/VideoLike");
const VideoWatchHistory = require("../../models/VideoWatchHistory");

const mongoose = require('mongoose');

exports.getFeed = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 10;

    // Step 1: Get total count of active videos
    const total = await Video.countDocuments({ isActive: true });

    // Step 2: Use aggregation to get random paginated results
    const videos = await Video.aggregate([
      { $match: { isActive: true } },
      { $sample: { size: total } }, // Randomize
      { $skip: (page - 1) * limit },
      { $limit: limit },
      {
        $lookup: {
          from: 'users',
          localField: 'userId',
          foreignField: '_id',
          as: 'userInfo',
        },
      },
      { $unwind: '$userInfo' },
      {
        $project: {
          videoUrl: 1,
          title: 1,
          likes: 1,
          bunnyFilePath: 1,
          createdAt: 1,
          user: '$userInfo.name',
        },
      },
    ]);

    const formattedVideos = videos.map((video) => ({
      id: video._id,
      videoUrl: `https://vz-f8479119-66c.b-cdn.net/${video.bunnyFilePath}/playlist.m3u8`,
      title: video.title,
      user: video.user,
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
    const { user } = req;
    const userId = user._id;

    // Safely process watchedDuration into an integer
    const duration = Math.floor(Number(watchedDuration));

    console.log("videoId", videoId, "watch dur:  ", duration);

    if (!videoId || isNaN(duration) || duration <= 0 || duration > 60) {
      return res.status(200).json({
        success: false,
        message: 'Invalid data',
        data: null
      });
    }

    // Check if the user already has a watch history for this video
    const existingHistory = await VideoWatchHistory.findOne({ userId, videoId });

    if (existingHistory) {
      existingHistory.watchedDuration += duration;
      await existingHistory.save();
    } else {
      await VideoWatchHistory.create({
        userId,
        videoId,
        watchedDuration: duration,
        rewarded: true
      });
    }

    console.log("time before: ", user.shortVideoProfile.watchTime);
    const newWatchTime = user.shortVideoProfile.watchTime + duration;
    user.shortVideoProfile.watchTime = newWatchTime;
    await user.save();
    console.log("time after: ", user.shortVideoProfile.watchTime);

    res.status(200).json({
      success: true,
      message: `Added ${duration} points`,
      data: { points: duration }
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
