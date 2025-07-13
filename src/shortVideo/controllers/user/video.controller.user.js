const User = require("../../../models/User");
const Video = require("../../models/Video");

exports.uploadVideo = async (req, res) => {
  try {
    const userId = req.user._id;
    const { title, description, durationInSec, thumbnailUrl } = req.body;

    if (!req.file || !req.file.location) {
      return res.status(200).json({
        success: false,
        message: 'Video upload failed or not found in request.',
        data: null
      });
    }

    if (!durationInSec || durationInSec > 60) {
      return res.status(200).json({
        success: false,
        message: 'Invalid or too long video duration (max 60 seconds)',
        data: null
      });
    }

    const user = await User.findById(userId);
    if (user.shortVideoProfile.videoUploads.length >= 100) {
      return res.status(200).json({
        success: false,
        message: 'Upload limit (100) reached.',
        data: null
      });
    }

    const video = await Video.create({
      userId,
      title,
      description,
      videoUrl: req.file.location, // Multer-S3 puts the URL in req.file.location
      thumbnailUrl,
      durationInSec
    });

    user.shortVideoProfile.videoUploads.push(video._id);
    await user.save();

    res.status(200).json({
      success: true,
      message: 'Video uploaded',
      data: video
    });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({
      success: false,
      message: 'Server error',
      data: null
    });
  }
};


exports.deleteVideo = async (req, res) => {
  try {
    const videoId = req.params.id;
    const userId = req.user._id;

    const video = await Video.findOne({ _id: videoId, userId });
    if (!video) {
      return res.status(200).json({
        success: false,
        message: 'Video not found',
        data: null
      });
    }

    video.isActive = false;
    await video.save();

    res.status(200).json({
      success: true,
      message: 'Video deleted successfully',
      data: null
    });
  } catch (err) {
    console.error('Delete error:', err);
    res.status(500).json({
      success: false,
      message: 'Server error',
      data: null
    });
  }
};
