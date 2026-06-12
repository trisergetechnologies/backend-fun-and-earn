'use strict';

const mockSave = jest.fn().mockResolvedValue(undefined);

jest.mock('../../../../models/SystemWallet', () => {
  const ctor = jest.fn().mockImplementation(function MockWallet(data) {
    Object.assign(this, data || {});
    this.save = mockSave;
  });
  ctor.findOne = jest.fn();
  ctor.findOneAndUpdate = jest.fn();
  return ctor;
});

jest.mock('../../../../models/Achievement', () => ({
  find: jest.fn(),
}));

jest.mock('../../../../models/MonthlyAchievement', () => ({
  find: jest.fn(),
}));

jest.mock('../../../../models/User', () => ({
  bulkWrite: jest.fn().mockResolvedValue({}),
}));

jest.mock('../../../models/EarningLog', () => ({
  insertMany: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../../../models/SystemEarningLog', () => ({
  create: jest.fn().mockResolvedValue({}),
}));

jest.mock('../../../helpers/rewardPayoutEligibility', () => ({
  isEligibleForAchievementPayout: jest.fn(),
}));

jest.mock('../../../helpers/rewardPayoutConfig', () => ({
  isEligibilityCheckSkipped: jest.fn(),
  getMinNewUsers: jest.fn((poolType, level) => {
    const weekly = { 1: 1, 2: 3, 3: 5 };
    const monthly = { 1: 2, 2: 6, 3: 10 };
    const map = poolType === 'monthly' ? monthly : weekly;
    return map[level] ?? null;
  }),
}));

const SystemWallet = require('../../../../models/SystemWallet');
const Achievement = require('../../../../models/Achievement');
const MonthlyAchievement = require('../../../../models/MonthlyAchievement');
const User = require('../../../../models/User');
const EarningLog = require('../../../models/EarningLog');
const SystemEarningLog = require('../../../../models/SystemEarningLog');
const { isEligibleForAchievementPayout } = require('../../../helpers/rewardPayoutEligibility');
const { isEligibilityCheckSkipped } = require('../../../helpers/rewardPayoutConfig');
const {
  payoutWeeklyRewards,
  payoutMonthlyRewards,
} = require('../system.controller.admin');

function mockAchievementFind(achieversByLevel) {
  return jest.fn().mockImplementation((query) => ({
    populate: jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue(achieversByLevel[query.level] || []),
    }),
  }));
}

function makeAchiever(id, title = 'Bonus') {
  return {
    level: 1,
    title,
    userId: { _id: id, referralCode: `RC_${id}` },
  };
}

describe('payoutRewards eligibility gate', () => {
  let wallet;
  let req;
  let res;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSave.mockClear();
    isEligibilityCheckSkipped.mockReturnValue(false);

    wallet = {
      weeklyPool: 100,
      monthlyPool: 100,
      totalBalance: 0,
      lastWeeklyPayoutAt: new Date('2025-01-01T00:00:00.000Z'),
      lastMonthlyPayoutAt: new Date('2025-02-01T00:00:00.000Z'),
      save: mockSave,
    };

    SystemWallet.findOne.mockResolvedValue(wallet);
    SystemWallet.findOneAndUpdate.mockImplementation(async (filter) => {
      const poolField = filter.weeklyPool != null ? 'weeklyPool' : 'monthlyPool';
      const poolValue = wallet[poolField];
      if (poolValue == null || poolValue <= 0) return null;
      return wallet;
    });

    req = { user: { _id: 'admin507f1f77bcf86cd799439099', role: 'admin' } };
    res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  });

  describe('payoutWeeklyRewards', () => {
    it('pays level 1 achiever when eligible', async () => {
      const userId = '507f1f77bcf86cd799439001';
      Achievement.find = mockAchievementFind({
        1: [makeAchiever(userId, 'Emerging Leader Bonus')],
      });
      isEligibleForAchievementPayout.mockResolvedValue(true);
      const expectedSince = wallet.lastWeeklyPayoutAt;

      await payoutWeeklyRewards(req, res);

      expect(isEligibleForAchievementPayout).toHaveBeenCalledWith(
        userId,
        'weekly',
        1,
        expectedSince,
        expect.any(Map)
      );
      expect(User.bulkWrite).toHaveBeenCalledWith([
        expect.objectContaining({
          updateOne: {
            filter: { _id: userId },
            update: { $inc: { 'wallets.shortVideoWallet': 10 } },
          },
        }),
      ]);
      expect(wallet.weeklyPool).toBe(0);
      expect(wallet.lastWeeklyPayoutAt).toBeInstanceOf(Date);
    });

    it('returns full level bucket when all achievers are ineligible', async () => {
      const userId = '507f1f77bcf86cd799439002';
      Achievement.find = mockAchievementFind({
        1: [makeAchiever(userId)],
      });
      isEligibleForAchievementPayout.mockResolvedValue(false);

      await payoutWeeklyRewards(req, res);

      expect(User.bulkWrite).not.toHaveBeenCalled();
      expect(wallet.totalBalance).toBe(100);
      expect(SystemEarningLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'inflow',
          source: 'weeklyPayout',
          context: 'No eligible achievers at level 1, funds returned',
        })
      );
    });

    it('gates level 3 weekly when ineligible', async () => {
      const userId = '507f1f77bcf86cd799439003a';
      Achievement.find = mockAchievementFind({
        3: [{ level: 3, title: 'Team Performance Bonus', userId: { _id: userId } }],
      });
      isEligibleForAchievementPayout.mockResolvedValue(false);
      const expectedSince = wallet.lastWeeklyPayoutAt;

      await payoutWeeklyRewards(req, res);

      expect(isEligibleForAchievementPayout).toHaveBeenCalledWith(
        userId,
        'weekly',
        3,
        expectedSince,
        expect.any(Map)
      );
      expect(User.bulkWrite).not.toHaveBeenCalled();
    });

    it('still pays level 3 when eligibility helper returns false but checks skipped via env', async () => {
      isEligibilityCheckSkipped.mockReturnValue(true);
      const userId = '507f1f77bcf86cd799439003';
      Achievement.find = mockAchievementFind({
        3: [{ level: 3, title: 'Team Performance Bonus', userId: { _id: userId } }],
      });

      await payoutWeeklyRewards(req, res);

      expect(isEligibleForAchievementPayout).not.toHaveBeenCalled();
      expect(User.bulkWrite).toHaveBeenCalled();
    });

    it('pays all level 1 achievers when env skips eligibility', async () => {
      isEligibilityCheckSkipped.mockReturnValue(true);
      const userId = '507f1f77bcf86cd799439004';
      Achievement.find = mockAchievementFind({
        1: [makeAchiever(userId)],
      });

      await payoutWeeklyRewards(req, res);

      expect(isEligibleForAchievementPayout).not.toHaveBeenCalled();
      expect(User.bulkWrite).toHaveBeenCalled();
    });

    it('divides level bucket only among eligible achievers', async () => {
      const eligibleId = '507f1f77bcf86cd799439005';
      const ineligibleId = '507f1f77bcf86cd799439006';
      Achievement.find = mockAchievementFind({
        1: [makeAchiever(eligibleId), makeAchiever(ineligibleId)],
      });
      isEligibleForAchievementPayout.mockImplementation(async (uid) => {
        return String(uid) === eligibleId;
      });

      await payoutWeeklyRewards(req, res);

      expect(User.bulkWrite).toHaveBeenCalledTimes(1);
      const bulkOps = User.bulkWrite.mock.calls[0][0];
      expect(bulkOps[0].updateOne.filter._id).toBe(eligibleId);
      expect(bulkOps[0].updateOne.update.$inc['wallets.shortVideoWallet']).toBe(10);
      expect(wallet.totalBalance).toBe(90);
    });

    it('rejects payout when atomic pool claim fails (concurrent request)', async () => {
      SystemWallet.findOneAndUpdate.mockResolvedValue(null);

      await payoutWeeklyRewards(req, res);

      expect(User.bulkWrite).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: 'No funds in weekly pool',
        })
      );
    });

    it('logs totalPaid as full level bucket when one of two achievers is eligible', async () => {
      const eligibleId = '507f1f77bcf86cd799439010';
      const ineligibleId = '507f1f77bcf86cd799439011';
      Achievement.find = mockAchievementFind({
        1: [makeAchiever(eligibleId), makeAchiever(ineligibleId)],
      });
      isEligibleForAchievementPayout.mockImplementation(async (uid) => {
        return String(uid) === eligibleId;
      });

      await payoutWeeklyRewards(req, res);

      const response = res.json.mock.calls[0][0];
      expect(response.data.totalPaid).toBe(10);
    });
  });

  describe('payoutMonthlyRewards', () => {
    it('uses lastMonthlyPayoutAt and monthly pool type', async () => {
      const userId = '507f1f77bcf86cd799439007';
      MonthlyAchievement.find = mockAchievementFind({
        1: [{ level: 1, title: 'Business Associate', userId: { _id: userId } }],
      });
      isEligibleForAchievementPayout.mockResolvedValue(true);
      const expectedSince = wallet.lastMonthlyPayoutAt;

      await payoutMonthlyRewards(req, res);

      expect(isEligibleForAchievementPayout).toHaveBeenCalledWith(
        userId,
        'monthly',
        1,
        expectedSince,
        expect.any(Map)
      );
      expect(wallet.monthlyPool).toBe(0);
      expect(wallet.lastMonthlyPayoutAt).toBeInstanceOf(Date);
    });

    it('returns full level bucket when monthly achiever is ineligible', async () => {
      const userId = '507f1f77bcf86cd799439008';
      MonthlyAchievement.find = mockAchievementFind({
        2: [{ level: 2, title: 'Development Associate', userId: { _id: userId } }],
      });
      isEligibleForAchievementPayout.mockResolvedValue(false);
      const expectedSince = wallet.lastMonthlyPayoutAt;

      await payoutMonthlyRewards(req, res);

      expect(isEligibleForAchievementPayout).toHaveBeenCalledWith(
        userId,
        'monthly',
        2,
        expectedSince,
        expect.any(Map)
      );
      expect(User.bulkWrite).not.toHaveBeenCalled();
      expect(SystemEarningLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          context: 'No eligible achievers at level 2, funds returned',
        })
      );
    });

    it('rejects payout when atomic monthly pool claim fails', async () => {
      SystemWallet.findOneAndUpdate.mockResolvedValue(null);

      await payoutMonthlyRewards(req, res);

      expect(User.bulkWrite).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: 'No funds in monthly reward pool',
        })
      );
    });
  });

  describe('regression: level 5 math unchanged', () => {
    it('does not call eligibility for level 5 and pays full share', async () => {
      const userId = '507f1f77bcf86cd799439009';
      Achievement.find = mockAchievementFind({
        5: [{ level: 5, title: 'Team Growth Bonus', userId: { _id: userId } }],
      });
      isEligibleForAchievementPayout.mockResolvedValue(false);

      await payoutWeeklyRewards(req, res);

      expect(isEligibleForAchievementPayout).not.toHaveBeenCalled();
      expect(User.bulkWrite).toHaveBeenCalledWith([
        expect.objectContaining({
          updateOne: {
            filter: { _id: userId },
            update: { $inc: { 'wallets.shortVideoWallet': 10 } },
          },
        }),
      ]);
      const response = res.json.mock.calls[0][0];
      expect(response.data.totalPaid).toBe(10);
    });
  });
});
