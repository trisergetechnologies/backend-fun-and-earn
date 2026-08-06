/**
 * Unit tests for Dream Mart ads policy. Dependencies mocked; no DB.
 */
jest.mock('../../../models/Settings', () => ({
  findOne: jest.fn(),
  create: jest.fn(),
}));
jest.mock('../../../models/MartUserAdDaily', () => ({
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
}));
jest.mock('../../../utils/istRange', () => ({
  getIstDateKey: jest.fn(() => '2026-08-06'),
  getIstTodayRange: jest.fn(() => ({
    endUtc: new Date('2026-08-06T18:30:00.000Z'),
  })),
}));

const Settings = require('../../../models/Settings');
const MartUserAdDaily = require('../../../models/MartUserAdDaily');
const {
  clampMartDailyLimit,
  clampMartGapSeconds,
  clampMartBannerVisibleSeconds,
  getMartAdsConfigFromSettings,
  buildMartAdConfigPayload,
  consumeMartInterstitialSlot,
  validateDreamMartAdsSettingsUpdate,
  applyDreamMartAdsClamps,
} = require('../dreamMartAdsPolicy.service');

describe('dreamMartAdsPolicy.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('clamps', () => {
    it('clamps daily limit to 1–20', () => {
      expect(clampMartDailyLimit(0)).toBe(1);
      expect(clampMartDailyLimit(1)).toBe(1);
      expect(clampMartDailyLimit(20)).toBe(20);
      expect(clampMartDailyLimit(99)).toBe(20);
      expect(clampMartDailyLimit('x')).toBe(1);
    });

    it('clamps gap and banner seconds', () => {
      expect(clampMartGapSeconds(5)).toBe(10);
      expect(clampMartGapSeconds(1800)).toBe(1800);
      expect(clampMartGapSeconds(20000)).toBe(10800);
      expect(clampMartBannerVisibleSeconds(5)).toBe(10);
      expect(clampMartBannerVisibleSeconds(600)).toBe(600);
      expect(clampMartBannerVisibleSeconds(9000)).toBe(7200);
    });
  });

  describe('getMartAdsConfigFromSettings', () => {
    it('uses Mart defaults independently of Reels fields', () => {
      const cfg = getMartAdsConfigFromSettings({
        adsDailyInterstitialLimit: 10,
        adsBannerEnabled: false,
      });
      expect(cfg).toEqual({
        dailyLimit: 1,
        minGapSeconds: 1800,
        bannerEnabled: true,
        bannerVisibleSecondsPerDay: 600,
      });
    });

    it('reads Mart fields from settings', () => {
      const cfg = getMartAdsConfigFromSettings({
        dreamMartAdsDailyInterstitialLimit: 3,
        dreamMartAdsMinGapSeconds: 90,
        dreamMartAdsBannerEnabled: false,
        dreamMartAdsBannerVisibleSecondsPerDay: 120,
      });
      expect(cfg).toEqual({
        dailyLimit: 3,
        minGapSeconds: 90,
        bannerEnabled: false,
        bannerVisibleSecondsPerDay: 120,
      });
    });
  });

  describe('validateDreamMartAdsSettingsUpdate', () => {
    it('accepts valid payload', () => {
      expect(
        validateDreamMartAdsSettingsUpdate({
          dreamMartAdsDailyInterstitialLimit: 5,
          dreamMartAdsMinGapSeconds: 60,
          dreamMartAdsBannerEnabled: true,
          dreamMartAdsBannerVisibleSecondsPerDay: 300,
        })
      ).toEqual([]);
    });

    it('rejects out-of-range Mart fields', () => {
      const errors = validateDreamMartAdsSettingsUpdate({
        dreamMartAdsDailyInterstitialLimit: 0,
        dreamMartAdsMinGapSeconds: 5,
        dreamMartAdsBannerEnabled: 'yes',
        dreamMartAdsBannerVisibleSecondsPerDay: 5,
      });
      expect(errors.length).toBe(4);
    });
  });

  describe('applyDreamMartAdsClamps', () => {
    it('mutates updateData with clamped values', () => {
      const data = {
        dreamMartAdsDailyInterstitialLimit: 50,
        dreamMartAdsMinGapSeconds: 1,
        dreamMartAdsBannerVisibleSecondsPerDay: 99999,
      };
      applyDreamMartAdsClamps(data);
      expect(data.dreamMartAdsDailyInterstitialLimit).toBe(20);
      expect(data.dreamMartAdsMinGapSeconds).toBe(10);
      expect(data.dreamMartAdsBannerVisibleSecondsPerDay).toBe(7200);
    });
  });

  describe('buildMartAdConfigPayload', () => {
    it('returns config with usage', async () => {
      Settings.findOne.mockResolvedValue({
        dreamMartAdsDailyInterstitialLimit: 2,
        dreamMartAdsMinGapSeconds: 100,
        dreamMartAdsBannerEnabled: true,
        dreamMartAdsBannerVisibleSecondsPerDay: 200,
      });
      MartUserAdDaily.findOne.mockReturnValue({
        lean: jest.fn().mockResolvedValue({ count: 1 }),
      });

      const payload = await buildMartAdConfigPayload('user1');
      expect(payload).toEqual({
        dailyLimit: 2,
        minGapSeconds: 100,
        bannerEnabled: true,
        bannerVisibleSecondsPerDay: 200,
        usedToday: 1,
        remainingToday: 1,
        resetsAt: '2026-08-06T18:30:00.000Z',
      });
    });
  });

  describe('consumeMartInterstitialSlot', () => {
    it('allows when under limit', async () => {
      Settings.findOne.mockResolvedValue({
        dreamMartAdsDailyInterstitialLimit: 2,
      });
      MartUserAdDaily.findOneAndUpdate.mockResolvedValue({ count: 1 });

      const result = await consumeMartInterstitialSlot('user1');
      expect(result).toEqual({
        allowed: true,
        usedToday: 1,
        remainingToday: 1,
        dailyLimit: 2,
      });
    });

    it('rejects when exhausted', async () => {
      Settings.findOne.mockResolvedValue({
        dreamMartAdsDailyInterstitialLimit: 1,
      });
      MartUserAdDaily.findOneAndUpdate.mockResolvedValue(null);
      MartUserAdDaily.findOne.mockReturnValue({
        lean: jest.fn().mockResolvedValue({ count: 1 }),
      });

      const result = await consumeMartInterstitialSlot('user1');
      expect(result).toEqual({
        allowed: false,
        usedToday: 1,
        remainingToday: 0,
        dailyLimit: 1,
      });
    });
  });
});
