#!/usr/bin/env node
/**
 * Sync Mongoose schema indexes to MongoDB (background-friendly on MongoDB 4.2+).
 *
 * Usage:
 *   node scripts/ensureIndexes.js              # sync indexes only
 *   node scripts/ensureIndexes.js --backfill   # run safe backfills, then sync
 *
 * Requires MONGO_URI in environment (loads .env from project root).
 */
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const mongoose = require('mongoose');

const MODEL_PATHS = [
  '../src/models/User',
  '../src/models/Package',
  '../src/models/PackageOrder',
  '../src/models/WalletTransaction',
  '../src/models/SystemWallet',
  '../src/models/SystemEarningLog',
  '../src/models/Settings',
  '../src/models/Coupon',
  '../src/models/Otp',
  '../src/models/Achievement',
  '../src/models/MonthlyAchievement',
  '../src/models/AdminLog',
  '../src/eCart/models/Order',
  '../src/eCart/models/Cart',
  '../src/eCart/models/Product',
  '../src/eCart/models/Category',
  '../src/eCart/models/PaymentIntent',
  '../src/eCart/models/WithdrawalRequest',
  '../src/eCart/models/FailedPayment',
  '../src/shortVideo/models/Video',
  '../src/shortVideo/models/VideoLike',
  '../src/shortVideo/models/VideoWatchHistory',
  '../src/shortVideo/models/EarningLog',
];

/**
 * Merge duplicate VideoWatchHistory rows (same userId + videoId).
 * Keeps the oldest _id, sums watchedDuration, preserves rewarded if any row had it.
 * Idempotent — safe to run multiple times.
 */
async function backfillVideoWatchHistoryDuplicates() {
  const VideoWatchHistory = require('../src/shortVideo/models/VideoWatchHistory');

  const dupGroups = await VideoWatchHistory.aggregate([
    {
      $group: {
        _id: { userId: '$userId', videoId: '$videoId' },
        count: { $sum: 1 },
        ids: { $push: '$_id' },
        totalDuration: { $sum: '$watchedDuration' },
        anyRewarded: {
          $max: { $cond: [{ $eq: ['$rewarded', true] }, 1, 0] },
        },
      },
    },
    { $match: { count: { $gt: 1 } } },
  ]);

  if (!dupGroups.length) {
    console.log('[backfill] VideoWatchHistory: no duplicate userId+videoId groups');
    return { merged: 0, removed: 0 };
  }

  let merged = 0;
  let removed = 0;

  for (const g of dupGroups) {
    const ids = g.ids.map((id) => new mongoose.Types.ObjectId(id));
    ids.sort((a, b) => String(a).localeCompare(String(b)));
    const keepId = ids[0];
    const deleteIds = ids.slice(1);

    await VideoWatchHistory.updateOne(
      { _id: keepId },
      {
        $set: {
          watchedDuration: g.totalDuration,
          rewarded: g.anyRewarded === 1,
        },
      }
    );
    const del = await VideoWatchHistory.deleteMany({ _id: { $in: deleteIds } });
    merged += 1;
    removed += del.deletedCount || 0;
  }

  console.log(
    `[backfill] VideoWatchHistory: merged ${merged} groups, removed ${removed} duplicate docs`
  );
  return { merged, removed };
}

async function syncAllIndexes() {
  const results = [];

  for (const rel of MODEL_PATHS) {
    const model = require(require('path').join(__dirname, rel));
    const name = model.modelName;
    try {
      await model.syncIndexes();
      results.push({ model: name, status: 'ok' });
      console.log(`[indexes] ${name}: syncIndexes OK`);
    } catch (err) {
      results.push({ model: name, status: 'error', message: err.message });
      console.error(`[indexes] ${name}: ${err.message}`);
    }
  }

  return results;
}

async function main() {
  const runBackfill = process.argv.includes('--backfill');

  if (!process.env.MONGO_URI) {
    console.error('MONGO_URI is not set');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log(`Connected to ${mongoose.connection.host}/${mongoose.connection.name}`);

  try {
    if (runBackfill) {
      await backfillVideoWatchHistoryDuplicates();
    }

    const results = await syncAllIndexes();
    const failed = results.filter((r) => r.status === 'error');
    if (failed.length) {
      console.error('Some models failed index sync:', failed);
      process.exit(1);
    }
    console.log('All indexes synced successfully.');
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
