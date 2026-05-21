'use strict';

jest.mock('../../../models/Achievement', () => ({
  aggregate: jest.fn(),
}));

jest.mock('../../../models/MonthlyAchievement', () => ({
  aggregate: jest.fn(),
}));

jest.mock('../../../models/SystemWallet', () => ({
  findOne: jest.fn(),
}));

jest.mock('../../../models/User', () => ({
  findById: jest.fn(),
}));

jest.mock('../../helpers/rewardPayoutConfig', () => ({
  isEligibilityCheckSkipped: jest.fn(() => false),
  getMinNewUsers: jest.fn((poolType, level) => {
    const weekly = { 1: 1, 2: 3, 3: 5 };
    const monthly = { 1: 2, 2: 6, 3: 10 };
    return (poolType === 'monthly' ? monthly : weekly)[level] ?? null;
  }),
  WEEKLY_MIN_NEW_USERS: { 1: 1, 2: 3, 3: 5 },
  MONTHLY_MIN_NEW_USERS: { 1: 2, 2: 6, 3: 10 },
}));

jest.mock('../../helpers/rewardPayoutEligibility', () => ({
  countDistinctNewDownlineBuyersSince: jest.fn(),
}));

const Achievement = require('../../../models/Achievement');
const SystemWallet = require('../../../models/SystemWallet');
const User = require('../../../models/User');
const { countDistinctNewDownlineBuyersSince } = require('../../helpers/rewardPayoutEligibility');
const {
  computeEligibleLevels,
  getPayoutEligibleUsers,
} = require('../rewardsPayoutEligible.service');

describe('rewardsPayoutEligible.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    SystemWallet.findOne.mockReturnValue({
      lean: async () => ({
        lastWeeklyPayoutAt: new Date('2025-01-01'),
        lastMonthlyPayoutAt: new Date('2025-02-01'),
      }),
    });
  });

  describe('computeEligibleLevels', () => {
    it('weekly L1+L2: 4 new buyers qualifies for both', () => {
      const levels = computeEligibleLevels([1, 2], 'weekly', 4, true);
      expect(levels).toEqual([1, 2]);
    });

    it('weekly L1+L2: 2 new buyers qualifies only L1', () => {
      const levels = computeEligibleLevels([1, 2], 'weekly', 2, true);
      expect(levels).toEqual([1]);
    });
  });

  describe('getPayoutEligibleUsers', () => {
    const userId = '507f1f77bcf86cd799439011';

    beforeEach(() => {
      Achievement.aggregate.mockResolvedValue([
        {
          _id: userId,
          achievements: [
            { level: 1, title: 'Emerging Leader Bonus' },
            { level: 2, title: 'Team Builder Bonus' },
          ],
          maxLevel: 2,
        },
      ]);
      countDistinctNewDownlineBuyersSince.mockResolvedValue(4);
      User.findById.mockReturnValue({
        select: jest.fn().mockReturnValue({
          populate: jest.fn().mockReturnValue({
            lean: async () => ({
              _id: userId,
              name: 'Test User',
              serialNumber: 42,
              referralCode: 'RC42',
              package: { name: 'Gold' },
            }),
          }),
        }),
      });
    });

    it('returns eligible user with meta and pagination', async () => {
      const result = await getPayoutEligibleUsers({
        poolType: 'weekly',
        page: 1,
        limit: 20,
      });

      expect(result.meta.poolType).toBe('weekly');
      expect(result.meta.eligibilityRulesActive).toBe(true);
      expect(result.users).toHaveLength(1);
      expect(result.users[0].eligibleLevels).toEqual([1, 2]);
      expect(result.users[0].newBuyersSinceLastPayout).toBe(4);
      expect(result.pagination.total).toBe(1);
    });
  });
});
