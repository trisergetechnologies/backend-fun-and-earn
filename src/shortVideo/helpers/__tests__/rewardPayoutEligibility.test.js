'use strict';

jest.mock('../../../models/User', () => ({
  find: jest.fn(),
  findById: jest.fn(),
}));

jest.mock('../../../models/PackageOrder', () => ({
  aggregate: jest.fn(),
}));

jest.mock('../rewardPayoutConfig', () => {
  const actual = jest.requireActual('../rewardPayoutConfig');
  return {
    ...actual,
    isEligibilityCheckSkipped: jest.fn(() => false),
  };
});

const User = require('../../../models/User');
const PackageOrder = require('../../../models/PackageOrder');
const rewardPayoutConfig = require('../rewardPayoutConfig');
const {
  collectDownlineUserIds,
  countDistinctNewDownlineBuyersSince,
  isEligibleForAchievementPayout,
} = require('../rewardPayoutEligibility');

function mockUserFindChain(rows) {
  User.find.mockReturnValue({
    select: jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue(rows),
    }),
  });
}

function mockUserById(referralCode) {
  const doc =
    referralCode === null || referralCode === undefined
      ? { referralCode: null }
      : { referralCode };
  User.findById.mockImplementation(() => ({
    select: () => ({
      lean: async () => doc,
    }),
  }));
}

function mockAggregateCount(count) {
  PackageOrder.aggregate.mockResolvedValue(count > 0 ? [{ count }] : []);
}

describe('rewardPayoutEligibility', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    rewardPayoutConfig.isEligibilityCheckSkipped.mockReturnValue(false);
    User.findById.mockImplementation(() => ({
      select: () => ({
        lean: async () => ({ referralCode: 'ROOT' }),
      }),
    }));
  });

  describe('collectDownlineUserIds', () => {
    it('returns empty array when referralCode is missing', async () => {
      expect(await collectDownlineUserIds(null)).toEqual([]);
      expect(User.find).not.toHaveBeenCalled();
    });
  });

  describe('countDistinctNewDownlineBuyersSince', () => {
    const userId = '507f1f77bcf86cd799439020';
    const sinceDate = new Date('2025-01-01T00:00:00.000Z');

    it('returns 0 when user has no referralCode', async () => {
      mockUserById(null);
      expect(
        await countDistinctNewDownlineBuyersSince(userId, sinceDate)
      ).toBe(0);
      expect(PackageOrder.aggregate).not.toHaveBeenCalled();
    });

    it('returns aggregate count for downline buyers', async () => {
      mockUserById('ROOT');
      mockUserFindChain([{ _id: '507f1f77bcf86cd799439011', referralCode: 'RC1' }]);
      mockAggregateCount(3);

      const count = await countDistinctNewDownlineBuyersSince(userId, sinceDate);

      expect(count).toBe(3);
      expect(PackageOrder.aggregate).toHaveBeenCalled();
    });
  });

  describe('isEligibleForAchievementPayout', () => {
    const userId = '507f1f77bcf86cd799439020';
    const since = new Date('2025-01-01T00:00:00.000Z');

    beforeEach(() => {
      mockUserById('ROOT');
      mockUserFindChain([
        { _id: '507f1f77bcf86cd799439011', referralCode: 'RC1' },
      ]);
    });

    it('returns true without DB when eligibility check is skipped via env', async () => {
      rewardPayoutConfig.isEligibilityCheckSkipped.mockReturnValue(true);

      const result = await isEligibleForAchievementPayout(
        userId,
        'weekly',
        1,
        since,
        new Map()
      );

      expect(result).toBe(true);
      expect(User.findById).not.toHaveBeenCalled();
      expect(PackageOrder.aggregate).not.toHaveBeenCalled();
    });

    it('weekly L1: eligible at count 1, not at 0', async () => {
      mockAggregateCount(1);
      expect(
        await isEligibleForAchievementPayout(userId, 'weekly', 1, since, new Map())
      ).toBe(true);

      mockAggregateCount(0);
      expect(
        await isEligibleForAchievementPayout(userId, 'weekly', 1, since, new Map())
      ).toBe(false);
    });

    it('weekly L2: eligible at count 3, not at 2', async () => {
      mockAggregateCount(3);
      expect(
        await isEligibleForAchievementPayout(userId, 'weekly', 2, since, new Map())
      ).toBe(true);

      mockAggregateCount(2);
      expect(
        await isEligibleForAchievementPayout(userId, 'weekly', 2, since, new Map())
      ).toBe(false);
    });

    it('weekly L3: eligible at count 5, not at 4', async () => {
      mockAggregateCount(5);
      expect(
        await isEligibleForAchievementPayout(userId, 'weekly', 3, since, new Map())
      ).toBe(true);

      mockAggregateCount(4);
      expect(
        await isEligibleForAchievementPayout(userId, 'weekly', 3, since, new Map())
      ).toBe(false);
    });

    it('monthly L1/L2/L3 use thresholds 2, 6, 10', async () => {
      mockAggregateCount(2);
      expect(
        await isEligibleForAchievementPayout(userId, 'monthly', 1, since, new Map())
      ).toBe(true);

      mockAggregateCount(6);
      expect(
        await isEligibleForAchievementPayout(userId, 'monthly', 2, since, new Map())
      ).toBe(true);

      mockAggregateCount(10);
      expect(
        await isEligibleForAchievementPayout(userId, 'monthly', 3, since, new Map())
      ).toBe(true);

      mockAggregateCount(9);
      expect(
        await isEligibleForAchievementPayout(userId, 'monthly', 3, since, new Map())
      ).toBe(false);
    });

    it('level 4 is always eligible when checks are enforced', async () => {
      mockAggregateCount(0);
      expect(
        await isEligibleForAchievementPayout(userId, 'weekly', 4, since, new Map())
      ).toBe(true);
      expect(PackageOrder.aggregate).not.toHaveBeenCalled();
    });

    it('caches per userId, poolType, and level', async () => {
      const localCache = new Map();
      mockAggregateCount(5);

      await isEligibleForAchievementPayout(userId, 'weekly', 3, since, localCache);
      await isEligibleForAchievementPayout(userId, 'weekly', 3, since, localCache);

      expect(PackageOrder.aggregate).toHaveBeenCalledTimes(1);
    });

    it('uses epoch when sinceDate is null (first payout)', async () => {
      mockUserFindChain([{ _id: '507f1f77bcf86cd799439011', referralCode: 'RC1' }]);
      mockAggregateCount(1);

      await countDistinctNewDownlineBuyersSince(userId, null);

      expect(PackageOrder.aggregate).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            $match: expect.objectContaining({
              createdAt: { $gt: new Date(0) },
            }),
          }),
        ])
      );
    });
  });
});
