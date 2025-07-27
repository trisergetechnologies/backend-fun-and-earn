const axios = require('axios');
const FormData = require('form-data');
const User = require("../../../models/User");
const Video = require("../../models/Video");
const streamifier = require('streamifier');
const ffmpeg = require('fluent-ffmpeg');
const { Readable } = require('stream');
const dotenv = require('dotenv');
dotenv.config();

ffmpeg.setFfprobePath('/usr/bin/ffprobe');
ffmpeg.setFfmpegPath('/usr/bin/ffmpeg');




const BUNNY_STREAM_API_KEY = process.env.BUNNY_STREAM_API_KEY;
const BUNNY_STREAM_LIBRARY_ID = process.env.BUNNY_STREAM_LIBRARY_ID;

// function getVideoDurationFromBuffer(buffer) {
//   return new Promise((resolve, reject) => {
//     const stream = streamifier.createReadStream(buffer);
//     ffmpeg(stream).ffprobe((err, metadata) => {
//       if (err) return reject(err);
//       resolve(metadata.format.duration);
//     });
//   });
// }


function getVideoDurationFromBuffer(buffer) {
  return new Promise((resolve, reject) => {
    const stream = streamifier.createReadStream(buffer);
    ffmpeg(stream).ffprobe((err, metadata) => {
      if (err) return reject(err);
      resolve(metadata.format.duration);
    });
  });
}

const createBunnyVideo = async (title) => {
  const response = await axios.post(
    `https://video.bunnycdn.com/library/${BUNNY_STREAM_LIBRARY_ID}/videos?includeUploadUrl=true`,
    { title },
    {
      headers: {
        AccessKey: BUNNY_STREAM_API_KEY,
        'Content-Type': 'application/json',
      },
    }
  );
  console.log("data from create bunny video", response.data);
  return response.data; // Contains uploadUrl, guid, videoId
};

const uploadRawToBunny = async (uploadUrl, buffer) => {
  console.log("uploadUrl in upload raw to bunny", uploadUrl);
  const response = await axios.put(uploadUrl, buffer, {
    headers: {
      'Content-Type': 'application/octet-stream',
    },
    maxBodyLength: Infinity,
  });

  if (response.status !== 200) throw new Error('Upload to Bunny Stream failed');
};

const uploadToBunnyStream = async (buffer, title) => {
  const videoMeta = await createBunnyVideo(title);
  console.log("video meta data from upload to bunny stream", videoMeta);
  await uploadRawToBunny(videoMeta.uploadUrl, buffer);

  return {
    videoId: videoMeta.videoId,
    guid: videoMeta.guid,
  };
};

const uploadVideo = async (req, res) => {
  try {
    const { title = '', description = '' } = req.body;
    const { file, user } = req;
    const userId = user._id;
    const MAX_DURATION = 60;

    const videoCount = await Video.countDocuments({ userId });
    if (videoCount >= 100) {
      return res.status(200).json({ success: false, message: 'Upload limit reached (100 videos).' });
    }

    const duration = await getVideoDurationFromBuffer(file.buffer);
    if (duration > MAX_DURATION) {
      return res.status(400).json({ error: `Video too long (${duration}s). Max allowed is ${MAX_DURATION}s.` });
    }

    const fileSizeInMB = +(file.size / (1024 * 1024)).toFixed(2);

    // Bunny 2-step upload
    const bunnyRes = await uploadToBunnyStream(file.buffer, title);
    const videoUrl = `https://video.bunnycdn.com/play/${bunnyRes.guid}`;
    const bunnyFilePath = bunnyRes.guid;

    const video = await Video.create({
      userId,
      title,
      description,
      videoUrl,
      bunnyFilePath,
      durationInSec: Number(duration),
      sizeInMB: fileSizeInMB,
    });

    await User.findByIdAndUpdate(userId, {
      $push: { 'shortVideoProfile.videoUploads': video._id },
    });

    return res.status(201).json({
      success: true,
      message: 'Video uploaded successfully',
      data: video,
    });

  } catch (err) {
    console.error('Video upload failed:', err);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: err.message,
    });
  }
};

// const ACCESS_KEY = process.env.BUNNY_API_KEY;
// const STORAGE_ZONE_NAME = process.env.BUNNY_STORAGE_ZONE;
// const HOSTNAME = process.env.BUNNY_HOSTNAME;
// const CDN_BASE_URL = process.env.BUNNY_CDN_BASE_URL;


// function getVideoDurationFromBuffer(buffer) {
//   return new Promise((resolve, reject) => {
//     const stream = streamifier.createReadStream(buffer);

//     ffmpeg(stream)
//       .ffprobe((err, metadata) => {
//         if (err) return reject(err);
//         resolve(metadata.format.duration);
//       });
//   });
// }


// const uploadBufferToBunny = (buffer, remotePath) => {
//   return new Promise((resolve, reject) => {
//     const options = {
//       method: 'PUT',
//       host: HOSTNAME,
//       path: `/${STORAGE_ZONE_NAME}/${remotePath}`,
//       headers: {
//         AccessKey: ACCESS_KEY,
//         'Content-Type': 'application/octet-stream',
//         'Content-Length': buffer.length,
//       },
//     };

//     const req = https.request(options, (res) => {
//       if (res.statusCode === 201 || res.statusCode === 200) {
//         resolve();
//       } else {
//         reject(new Error(`BunnyCDN upload failed with status ${res.statusCode}`));
//       }
//     });

//     req.on('error', reject);
//     req.write(buffer);
//     req.end();
//   });
// };

// const uploadVideo = async (req, res) => {
//   try {
//     const { title = '', description = '' } = req.body;
//     const { file, user } = req;
//     const userId = user._id;
//     const MAX_DURATION = 60;


//     const videoCount = await Video.countDocuments({ userId });
//     if (videoCount >= 100) {
//       return res.status(200).json({ success: false, message: 'Upload limit reached (100 videos).' });
//     }

//     const duration = await getVideoDurationFromBuffer(file.buffer);
//     if (duration > MAX_DURATION) {
//       return res.status(400).json({ error: `Video too long (${duration}s). Max allowed is ${MAX_DURATION}s.` });
//     }

//     const ext = file.originalname.split('.').pop();
//     const uniqueName = `user-${userId}/${Date.now()}-${Math.round(Math.random() * 1e9)}.${ext}`;
//     const videoUrl = `${CDN_BASE_URL}/${uniqueName}`;

//     // Upload to BunnyCDN directly
//     await uploadBufferToBunny(file.buffer, uniqueName);

//     const fileSizeInMB = +(file.size / (1024 * 1024)).toFixed(2);

//     const video = await Video.create({
//       userId,
//       title,
//       description,
//       videoUrl,
//       bunnyFilePath: uniqueName,
//       durationInSec: Number(duration),
//       sizeInMB: fileSizeInMB,
//     });

//     await User.findByIdAndUpdate(userId, { $push: { 'shortVideoProfile.videoUploads': video._id } });

//     return res.status(201).json({
//       success: true,
//       message: 'Video uploaded successfully',
//       data: video,
//     });

//   } catch (err) {
//     console.error(err);
//     return res.status(500).json({ success: false, message: 'Internal server error', error: err.message });
//   }
// };

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