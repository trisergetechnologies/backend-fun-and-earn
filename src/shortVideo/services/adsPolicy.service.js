const Settings = require('../../models/Settings');
const UserAdDaily = require('../../models/UserAdDaily');
const { getIstDateKey, getIstTodayRange } = require('../../utils/istRange');

const MIN_DAILY_LIMIT = 5;
const MAX_DAILY_LIMIT = 20;
const DEFAULT_DAILY_LIMIT = 5;

async function getOrCreateSettings() {
  let settings = await Settings.findOne();
  if (!settings) {
    settings = await Settings.create({});
  }
  return settings;
}

function clampDailyLimit(raw) {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return DEFAULT_DAILY_LIMIT;
  return Math.min(MAX_DAILY_LIMIT, Math.max(MIN_DAILY_LIMIT, n));
}

function getAdsConfigFromSettings(settings) {
  const dailyLimit = clampDailyLimit(
    settings?.adsDailyInterstitialLimit ?? DEFAULT_DAILY_LIMIT
  );
  const bannerEnabled =
    settings?.adsBannerEnabled === undefined
      ? true
      : Boolean(settings.adsBannerEnabled);
  return { dailyLimit, bannerEnabled };
}

async function getUserAdUsage(userId) {
  const dateKey = getIstDateKey();
  const doc = await UserAdDaily.findOne({ userId, dateKey }).lean();
  const usedToday = doc?.count ?? 0;
  return { dateKey, usedToday };
}

async function buildAdConfigPayload(userId) {
  const settings = await getOrCreateSettings();
  const { dailyLimit, bannerEnabled } = getAdsConfigFromSettings(settings);
  const { usedToday } = await getUserAdUsage(userId);
  const { endUtc } = getIstTodayRange();
  const remainingToday = Math.max(0, dailyLimit - usedToday);

  return {
    dailyLimit,
    bannerEnabled,
    usedToday,
    remainingToday,
    resetsAt: endUtc.toISOString(),
  };
}

/**
 * Atomically reserve one interstitial slot for today (IST).
 * @returns {{ allowed: boolean, usedToday: number, remainingToday: number, dailyLimit: number }}
 */
async function consumeInterstitialSlot(userId) {
  const settings = await getOrCreateSettings();
  const { dailyLimit } = getAdsConfigFromSettings(settings);
  const dateKey = getIstDateKey();

  const updated = await UserAdDaily.findOneAndUpdate(
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
    const { usedToday } = await getUserAdUsage(userId);
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

function validateAdsSettingsUpdate(body) {
  const errors = [];
  if (body.adsDailyInterstitialLimit !== undefined) {
    const n = Number(body.adsDailyInterstitialLimit);
    if (!Number.isInteger(n) || n < MIN_DAILY_LIMIT || n > MAX_DAILY_LIMIT) {
      errors.push(
        `adsDailyInterstitialLimit must be an integer between ${MIN_DAILY_LIMIT} and ${MAX_DAILY_LIMIT}`
      );
    }
  }
  if (
    body.adsBannerEnabled !== undefined &&
    typeof body.adsBannerEnabled !== 'boolean'
  ) {
    errors.push('adsBannerEnabled must be a boolean');
  }
  return errors;
}

module.exports = {
  MIN_DAILY_LIMIT,
  MAX_DAILY_LIMIT,
  DEFAULT_DAILY_LIMIT,
  clampDailyLimit,
  getOrCreateSettings,
  getAdsConfigFromSettings,
  buildAdConfigPayload,
  consumeInterstitialSlot,
  validateAdsSettingsUpdate,
};
