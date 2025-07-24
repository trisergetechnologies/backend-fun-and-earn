const User = require("../../../models/User");
const Video = require("../../models/Video");



const ACCESS_KEY = process.env.BUNNY_API_KEY;
const STORAGE_ZONE_NAME = process.env.BUNNY_STORAGE_ZONE;
const HOSTNAME = process.env.BUNNY_HOSTNAME;
const CDN_BASE_URL = process.env.BUNNY_CDN_BASE_URL;



const uploadBufferToBunny = (buffer, remotePath) => {
  return new Promise((resolve, reject) => {
    const options = {
      method: 'PUT',
      host: HOSTNAME,
      path: `/${STORAGE_ZONE_NAME}/${remotePath}`,
      headers: {
        AccessKey: ACCESS_KEY,
        'Content-Type': 'application/octet-stream',
        'Content-Length': buffer.length,
      },
    };

    const req = https.request(options, (res) => {
      if (res.statusCode === 201 || res.statusCode === 200) {
        resolve();
      } else {
        reject(new Error(`BunnyCDN upload failed with status ${res.statusCode}`));
      }
    });

    req.on('error', reject);
    req.write(buffer);
    req.end();
  });
};

const uploadVideo = async (req, res) => {
  try {
    const { title = '', description = '', durationInSec } = req.body;
    const { file, user } = req;
    const userId = user._id;

    const videoCount = await Video.countDocuments({ userId });
    if (videoCount >= 100) {
      return res.status(200).json({ success: false, message: 'Upload limit reached (100 videos).' });
    }

    if (!durationInSec || Number(durationInSec) > 60) {
      return res.status(200).json({ success: false, message: 'Invalid video duration' });
    }

    const ext = file.originalname.split('.').pop();
    const uniqueName = `user-${userId}/${Date.now()}-${Math.round(Math.random() * 1e9)}.${ext}`;
    const videoUrl = `${CDN_BASE_URL}/${uniqueName}`;

    // Upload to BunnyCDN directly
    await uploadBufferToBunny(file.buffer, uniqueName);

    const fileSizeInMB = +(file.size / (1024 * 1024)).toFixed(2);

    const video = await Video.create({
      userId,
      title,
      description,
      videoUrl,
      bunnyFilePath: uniqueName,
      durationInSec: Number(durationInSec),
      sizeInMB: fileSizeInMB,
    });

    await User.findByIdAndUpdate(userId, { $push: { 'shortVideoProfile.videoUploads': video._id } });

    return res.status(201).json({
      success: true,
      message: 'Video uploaded successfully',
      data: video,
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Internal server error', error: err.message });
  }
};



const deleteVideo = async (req, res) => {
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

module.exports = { uploadVideo, deleteVideo };