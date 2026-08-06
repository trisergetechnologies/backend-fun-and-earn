const Settings = require('../../models/Settings');
const MartUserAdDaily = require('../../models/MartUserAdDaily');
const { getIstDateKey, getIstTodayRange } = require('../../utils/istRange');

const MIN_DAILY_LIMIT = 1;
const MAX_DAILY_LIMIT = 20;
const DEFAULT_DAILY_LIMIT = 1;

const MIN_GAP_SECONDS = 10;
const MAX_GAP_SECONDS = 10800;
const DEFAULT_GAP_SECONDS = 1800;

const MIN_BANNER_VISIBLE_SECONDS = 10;
const MAX_BANNER_VISIBLE_SECONDS = 7200;
const DEFAULT_BANNER_VISIBLE_SECONDS = 600;

async function getOrCreateSettings() {
  let settings = await Settings.findOne();
  if (!settings) {
    settings = await Settings.create({});
  }
  return settings;
}

function clampMartDailyLimit(raw) {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return DEFAULT_DAILY_LIMIT;
  return Math.min(MAX_DAILY_LIMIT, Math.max(MIN_DAILY_LIMIT, n));
}

function clampMartGapSeconds(raw) {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return DEFAULT_GAP_SECONDS;
  return Math.min(MAX_GAP_SECONDS, Math.max(MIN_GAP_SECONDS, n));
}

function clampMartBannerVisibleSeconds(raw) {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return DEFAULT_BANNER_VISIBLE_SECONDS;
  return Math.min(
    MAX_BANNER_VISIBLE_SECONDS,
    Math.max(MIN_BANNER_VISIBLE_SECONDS, n)
  );
}

function getMartAdsConfigFromSettings(settings) {
  const dailyLimit = clampMartDailyLimit(
    settings?.dreamMartAdsDailyInterstitialLimit ?? DEFAULT_DAILY_LIMIT
  );
  const minGapSeconds = clampMartGapSeconds(
    settings?.dreamMartAdsMinGapSeconds ?? DEFAULT_GAP_SECONDS
  );
  const bannerEnabled =
    settings?.dreamMartAdsBannerEnabled === undefined
      ? true
      : Boolean(settings.dreamMartAdsBannerEnabled);
  const bannerVisibleSecondsPerDay = clampMartBannerVisibleSeconds(
    settings?.dreamMartAdsBannerVisibleSecondsPerDay ??
      DEFAULT_BANNER_VISIBLE_SECONDS
  );
  return {
    dailyLimit,
    minGapSeconds,
    bannerEnabled,
    bannerVisibleSecondsPerDay,
  };
}

async function getMartUserAdUsage(userId) {
  const dateKey = getIstDateKey();
  const doc = await MartUserAdDaily.findOne({ userId, dateKey }).lean();
  const usedToday = doc?.count ?? 0;
  return { dateKey, usedToday };
}

async function buildMartAdConfigPayload(userId) {
  const settings = await getOrCreateSettings();
  const policy = getMartAdsConfigFromSettings(settings);
  const { usedToday } = await getMartUserAdUsage(userId);
  const { endUtc } = getIstTodayRange();
  const remainingToday = Math.max(0, policy.dailyLimit - usedToday);

  return {
    dailyLimit: policy.dailyLimit,
    minGapSeconds: policy.minGapSeconds,
    bannerEnabled: policy.bannerEnabled,
    bannerVisibleSecondsPerDay: policy.bannerVisibleSecondsPerDay,
    usedToday,
    remainingToday,
    resetsAt: endUtc.toISOString(),
  };
}

/**
 * Atomically reserve one Dream Mart interstitial slot for today (IST).
 */
async function consumeMartInterstitialSlot(userId) {
  const settings = await getOrCreateSettings();
  const { dailyLimit } = getMartAdsConfigFromSettings(settings);
  const dateKey = getIstDateKey();

  const updated = await MartUserAdDaily.findOneAndUpdate(
    {
      userId,
      dateKey,
      $or: [{ count: { $exists: false } }, { count: { $lt: dailyLimit } }],
    },
    {
      $inc: { count: 1 },
      $setOnInsert: { userId, dateKey },
    },
    { upsert: true, new: true }
  );

  if (!updated) {
    const { usedToday } = await getMartUserAdUsage(userId);
    return {
      allowed: false,
      usedToday,
      remainingToday: 0,
      dailyLimit,
    };
  }

  const usedToday = updated.count;
  const remainingToday = Math.max(0, dailyLimit - usedToday);
  return {
    allowed: true,
    usedToday,
    remainingToday,
    dailyLimit,
  };
}

function validateDreamMartAdsSettingsUpdate(body) {
  const errors = [];

  if (body.dreamMartAdsDailyInterstitialLimit !== undefined) {
    const n = Number(body.dreamMartAdsDailyInterstitialLimit);
    if (
      !Number.isInteger(n) ||
      n < MIN_DAILY_LIMIT ||
      n > MAX_DAILY_LIMIT
    ) {
      errors.push(
        `dreamMartAdsDailyInterstitialLimit must be an integer between ${MIN_DAILY_LIMIT} and ${MAX_DAILY_LIMIT}`
      );
    }
  }

  if (body.dreamMartAdsMinGapSeconds !== undefined) {
    const n = Number(body.dreamMartAdsMinGapSeconds);
    if (!Number.isInteger(n) || n < MIN_GAP_SECONDS || n > MAX_GAP_SECONDS) {
      errors.push(
        `dreamMartAdsMinGapSeconds must be an integer between ${MIN_GAP_SECONDS} and ${MAX_GAP_SECONDS}`
      );
    }
  }

  if (
    body.dreamMartAdsBannerEnabled !== undefined &&
    typeof body.dreamMartAdsBannerEnabled !== 'boolean'
  ) {
    errors.push('dreamMartAdsBannerEnabled must be a boolean');
  }

  if (body.dreamMartAdsBannerVisibleSecondsPerDay !== undefined) {
    const n = Number(body.dreamMartAdsBannerVisibleSecondsPerDay);
    if (
      !Number.isInteger(n) ||
      n < MIN_BANNER_VISIBLE_SECONDS ||
      n > MAX_BANNER_VISIBLE_SECONDS
    ) {
      errors.push(
        `dreamMartAdsBannerVisibleSecondsPerDay must be an integer between ${MIN_BANNER_VISIBLE_SECONDS} and ${MAX_BANNER_VISIBLE_SECONDS}`
      );
    }
  }

  return errors;
}

function applyDreamMartAdsClamps(updateData) {
  if (updateData.dreamMartAdsDailyInterstitialLimit !== undefined) {
    updateData.dreamMartAdsDailyInterstitialLimit = clampMartDailyLimit(
      updateData.dreamMartAdsDailyInterstitialLimit
    );
  }
  if (updateData.dreamMartAdsMinGapSeconds !== undefined) {
    updateData.dreamMartAdsMinGapSeconds = clampMartGapSeconds(
      updateData.dreamMartAdsMinGapSeconds
    );
  }
  if (updateData.dreamMartAdsBannerVisibleSecondsPerDay !== undefined) {
    updateData.dreamMartAdsBannerVisibleSecondsPerDay =
      clampMartBannerVisibleSeconds(
        updateData.dreamMartAdsBannerVisibleSecondsPerDay
      );
  }
  return updateData;
}

module.exports = {
  MIN_DAILY_LIMIT,
  MAX_DAILY_LIMIT,
  DEFAULT_DAILY_LIMIT,
  MIN_GAP_SECONDS,
  MAX_GAP_SECONDS,
  DEFAULT_GAP_SECONDS,
  MIN_BANNER_VISIBLE_SECONDS,
  MAX_BANNER_VISIBLE_SECONDS,
  DEFAULT_BANNER_VISIBLE_SECONDS,
  clampMartDailyLimit,
  clampMartGapSeconds,
  clampMartBannerVisibleSeconds,
  getOrCreateSettings,
  getMartAdsConfigFromSettings,
  buildMartAdConfigPayload,
  consumeMartInterstitialSlot,
  validateDreamMartAdsSettingsUpdate,
  applyDreamMartAdsClamps,
};
