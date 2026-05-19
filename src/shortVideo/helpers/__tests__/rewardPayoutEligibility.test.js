'use strict';

jest.mock('../../../models/User', () => ({
  find: jest.fn(),
  findById: jest.fn(),
}));

jest.mock('../../../models/PackageOrder', () => ({
  exists: jest.fn(),
}));

const User = require('../../../models/User');
const PackageOrder = require('../../../models/PackageOrder');
const {
  collectDownlineUserIds,
  hasNewDownlinePurchaseSince,
  isEligibleForLowLevelReward,
} = require('../rewardPayoutEligibility');

function mockUserFindChain(rows) {
  User.find.mockReturnValue({
    select: jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue(rows),
    }),
  });
}

describe('rewardPayoutEligibility', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('collectDownlineUserIds', () => {
    it('returns empty array when referralCode is missing', async () => {
      expect(await collectDownlineUserIds(null)).toEqual([]);
      expect(User.find).not.toHaveBeenCalled();
    });

    it('collects IDs across multiple BFS levels up to maxDepth', async () => {
      const id1 = '507f1f77bcf86cd799439011';
      const id2 = '507f1f77bcf86cd799439012';
      const id3 = '507f1f77bcf86cd799439013';

      User.find
        .mockReturnValueOnce({
          select: jest.fn().mockReturnValue({
            lean: jest.fn().mockResolvedValue([
              { _id: id1, referralCode: 'RC1' },
              { _id: id2, referralCode: 'RC2' },
            ]),
          }),
        })
        .mockReturnValueOnce({
          select: jest.fn().mockReturnValue({
            lean: jest.fn().mockResolvedValue([{ _id: id3, referralCode: 'RC3' }]),
          }),
        })
        .mockReturnValue({
          select: jest.fn().mockReturnValue({
            lean: jest.fn().mockResolvedValue([]),
          }),
        });

      const ids = await collectDownlineUserIds('ROOT', 10);

      expect(ids.map(String)).toEqual([id1, id2, id3]);
      expect(User.find).toHaveBeenCalledTimes(3);
    });
  });

  describe('hasNewDownlinePurchaseSince', () => {
    const userId = '507f1f77bcf86cd799439020';
    const sinceDate = new Date('2025-01-01T00:00:00.000Z');

    it('returns false when user has no referralCode', async () => {
      User.findById.mockReturnValue({
        select: () => ({
          lean: async () => ({ _id: userId, referralCode: null }),
        }),
      });

      expect(await hasNewDownlinePurchaseSince(userId, sinceDate)).toBe(false);
      expect(PackageOrder.exists).not.toHaveBeenCalled();
    });

    it('returns false when downline is empty', async () => {
      User.findById.mockReturnValue({
        select: () => ({
          lean: async () => ({ _id: userId, referralCode: 'ROOT' }),
        }),
      });
      mockUserFindChain([]);

      expect(await hasNewDownlinePurchaseSince(userId, sinceDate)).toBe(false);
      expect(PackageOrder.exists).not.toHaveBeenCalled();
    });

    it('returns true when a successful order exists after sinceDate', async () => {
      const downlineId = '507f1f77bcf86cd799439011';

      User.findById.mockReturnValue({
        select: () => ({
          lean: async () => ({ _id: userId, referralCode: 'ROOT' }),
        }),
      });
      User.find
        .mockReturnValueOnce({
          select: jest.fn().mockReturnValue({
            lean: jest.fn().mockResolvedValue([{ _id: downlineId, referralCode: 'RC1' }]),
          }),
        })
        .mockReturnValue({
          select: jest.fn().mockReturnValue({
            lean: jest.fn().mockResolvedValue([]),
          }),
        });
      PackageOrder.exists.mockResolvedValue({ _id: 'order1' });

      const result = await hasNewDownlinePurchaseSince(userId, sinceDate);

      expect(result).toBe(true);
      expect(PackageOrder.exists).toHaveBeenCalledWith(
        expect.objectContaining({
          buyerId: { $in: [downlineId] },
          status: 'success',
          createdAt: { $gt: sinceDate },
        })
      );
    });

    it('returns false when PackageOrder.exists is null', async () => {
      User.findById.mockReturnValue({
        select: () => ({
          lean: async () => ({ _id: userId, referralCode: 'ROOT' }),
        }),
      });
      mockUserFindChain([{ _id: '507f1f77bcf86cd799439011', referralCode: 'RC1' }]);
      PackageOrder.exists.mockResolvedValue(null);

      expect(await hasNewDownlinePurchaseSince(userId, sinceDate)).toBe(false);
    });

    it('uses epoch when sinceDate is null (first payout)', async () => {
      User.findById.mockReturnValue({
        select: () => ({
          lean: async () => ({ _id: userId, referralCode: 'ROOT' }),
        }),
      });
      mockUserFindChain([{ _id: '507f1f77bcf86cd799439011', referralCode: 'RC1' }]);
      PackageOrder.exists.mockResolvedValue({ _id: 'order1' });

      await hasNewDownlinePurchaseSince(userId, null);

      expect(PackageOrder.exists).toHaveBeenCalledWith(
        expect.objectContaining({
          createdAt: { $gt: new Date(0) },
        })
      );
    });
  });

  describe('isEligibleForLowLevelReward', () => {
    it('caches result per userId', async () => {
      const userId = '507f1f77bcf86cd799439020';
      const cache = new Map();
      const since = new Date('2025-06-01');

      User.findById.mockReturnValue({
        select: () => ({
          lean: async () => ({ _id: userId, referralCode: 'ROOT' }),
        }),
      });
      mockUserFindChain([{ _id: '507f1f77bcf86cd799439011', referralCode: 'RC1' }]);
      PackageOrder.exists.mockResolvedValue({ _id: 'o1' });

      const first = await isEligibleForLowLevelReward(userId, since, cache);
      const second = await isEligibleForLowLevelReward(userId, since, cache);

      expect(first).toBe(true);
      expect(second).toBe(true);
      expect(User.findById).toHaveBeenCalledTimes(1);
    });
  });
});
