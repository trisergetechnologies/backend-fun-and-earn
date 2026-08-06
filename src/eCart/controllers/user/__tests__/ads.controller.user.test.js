/**
 * Unit tests for eCart user ads controller.
 */
jest.mock('../../../services/dreamMartAdsPolicy.service', () => ({
  buildMartAdConfigPayload: jest.fn(),
  consumeMartInterstitialSlot: jest.fn(),
}));

const {
  buildMartAdConfigPayload,
  consumeMartInterstitialSlot,
} = require('../../../services/dreamMartAdsPolicy.service');
const {
  getAdConfig,
  consumeInterstitial,
} = require('../ads.controller.user');

describe('ads.controller.user (Mart)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('getAdConfig returns payload', async () => {
    const data = {
      dailyLimit: 1,
      minGapSeconds: 1800,
      bannerEnabled: true,
      bannerVisibleSecondsPerDay: 600,
      usedToday: 0,
      remainingToday: 1,
      resetsAt: '2026-08-06T18:30:00.000Z',
    };
    buildMartAdConfigPayload.mockResolvedValue(data);

    const req = { user: { _id: 'u1' } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await getAdConfig(req, res);

    expect(buildMartAdConfigPayload).toHaveBeenCalledWith('u1');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, data })
    );
  });

  it('consumeInterstitial returns allowed false message when exhausted', async () => {
    consumeMartInterstitialSlot.mockResolvedValue({
      allowed: false,
      usedToday: 1,
      remainingToday: 0,
      dailyLimit: 1,
    });

    const req = { user: { _id: 'u1' } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await consumeInterstitial(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        message: 'Daily interstitial limit reached',
        data: expect.objectContaining({ allowed: false }),
      })
    );
  });

  it('consumeInterstitial happy path', async () => {
    consumeMartInterstitialSlot.mockResolvedValue({
      allowed: true,
      usedToday: 1,
      remainingToday: 0,
      dailyLimit: 1,
    });

    const req = { user: { _id: 'u1' } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await consumeInterstitial(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        message: 'Interstitial slot reserved',
        data: expect.objectContaining({ allowed: true }),
      })
    );
  });
});
