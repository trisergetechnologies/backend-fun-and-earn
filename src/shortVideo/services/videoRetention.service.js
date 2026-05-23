'use strict';

const axios = require('axios');
const dotenv = require('dotenv');
const Video = require('../models/Video');
const VideoLike = require('../models/VideoLike');
const VideoWatchHistory = require('../models/VideoWatchHistory');
const User = require('../../models/User');

dotenv.config();

const BUNNY_STREAM_API_KEY = process.env.BUNNY_STREAM_API_KEY;
const BUNNY_STREAM_LIBRARY_ID = process.env.BUNNY_STREAM_LIBRARY_ID;

const DEFAULT_MAX_PLATFORM_VIDEOS = 200;
const DEFAULT_BATCH_SIZE = 20;

function getMaxPlatformVideos() {
  const parsed = parseInt(process.env.MAX_PLATFORM_VIDEOS, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_PLATFORM_VIDEOS;
}

function getRetentionBatchSize() {
  const parsed = parseInt(process.env.VIDEO_RETENTION_BATCH_SIZE, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_BATCH_SIZE;
}

function isBunnyNotFound(err) {
  return err?.response?.status === 404;
}

async function deleteFromBunny(guid) {
  const url = `https://video.bunnycdn.com/library/${BUNNY_STREAM_LIBRARY_ID}/videos/${guid}`;
  await axios.delete(url, {
    headers: { AccessKey: BUNNY_STREAM_API_KEY },
  });
}

/**
 * Fully removes a video from Bunny, related collections, and MongoDB.
 * On Bunny failure (non-404), leaves the row inactive for retry.
 */
async function deleteVideoFully(video) {
  const videoId = video._id;

  if (video.isActive) {
    await Video.updateOne({ _id: videoId }, { isActive: false });
  }

  try {
    await deleteFromBunny(video.bunnyFilePath);
  } catch (err) {
    if (!isBunnyNotFound(err)) {
      console.error('[videoRetention] Bunny delete failed', {
        videoId,
        guid: video.bunnyFilePath,
        message: err.message,
      });
      return { success: false, videoId, error: err.message };
    }
  }

  await VideoLike.deleteMany({ videoId });
  await VideoWatchHistory.deleteMany({ videoId });
  await User.updateOne(
    { _id: video.userId },
    { $pull: { 'shortVideoProfile.videoUploads': videoId } }
  );
  await Video.deleteOne({ _id: videoId });

  return { success: true, videoId };
}

/**
 * Priority: inactive backlog first, then oldest active videos beyond platform cap.
 */
async function selectVideosForDeletion(limit = getRetentionBatchSize()) {
  const maxVideos = getMaxPlatformVideos();
  const candidates = [];

  const inactive = await Video.find({ isActive: false })
    .sort({ createdAt: 1 })
    .limit(limit)
    .lean();

  candidates.push(...inactive);

  const remaining = limit - candidates.length;
  if (remaining <= 0) {
    return candidates;
  }

  const activeCount = await Video.countDocuments({ isActive: true });
  if (activeCount <= maxVideos) {
    return candidates;
  }

  const overflowCount = activeCount - maxVideos;
  const overflow = await Video.find({ isActive: true })
    .sort({ createdAt: 1 })
    .limit(Math.min(overflowCount, remaining))
    .lean();

  candidates.push(...overflow);
  return candidates;
}

async function runRetentionBatch(limit = getRetentionBatchSize()) {
  const runId = `VIDEO_RETENTION_${Date.now()}`;
  const videos = await selectVideosForDeletion(limit);
  const results = [];

  console.log(`[videoRetention] RUN START`, {
    runId,
    selected: videos.length,
    maxPlatformVideos: getMaxPlatformVideos(),
  });

  for (const video of videos) {
    try {
      const result = await deleteVideoFully(video);
      results.push(result);
      if (!result.success) {
        console.warn(`[videoRetention] skip hard-delete after Bunny failure`, {
          runId,
          videoId: result.videoId,
        });
      }
    } catch (err) {
      console.error(`[videoRetention] unexpected error`, {
        runId,
        videoId: video._id,
        message: err.message,
      });
      results.push({ success: false, videoId: video._id, error: err.message });
    }
  }

  const activeRemaining = await Video.countDocuments({ isActive: true });
  console.log(`[videoRetention] RUN END`, {
    runId,
    processed: results.length,
    succeeded: results.filter((r) => r.success).length,
    activeRemaining,
  });

  return { runId, results, activeRemaining };
}

module.exports = {
  getMaxPlatformVideos,
  getRetentionBatchSize,
  isBunnyNotFound,
  deleteFromBunny,
  deleteVideoFully,
  selectVideosForDeletion,
  runRetentionBatch,
};
