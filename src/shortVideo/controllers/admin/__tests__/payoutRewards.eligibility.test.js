'use strict';

const mockSave = jest.fn().mockResolvedValue(undefined);

jest.mock('../../../../models/SystemWallet', () => {
  const ctor = jest.fn().mockImplementation(function MockWallet(data) {
    Object.assign(this, data || {});
    this.save = mockSave;
  });
  ctor.findOne = jest.fn();
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
  isEligibleForLowLevelReward: jest.fn(),
}));

const SystemWallet = require('../../../../models/SystemWallet');
const Achievement = require('../../../../models/Achievement');
const MonthlyAchievement = require('../../../../models/MonthlyAchievement');
const User = require('../../../../models/User');
const EarningLog = require('../../../models/EarningLog');
const SystemEarningLog = require('../../../../models/SystemEarningLog');
const { isEligibleForLowLevelReward } = require('../../../helpers/rewardPayoutEligibility');
const {
  payoutWeeklyRewards,
  payoutMonthlyRewards,
} = require('../system.controller.admin');

function mockAchievementFind(achieversByLevel) {
  const fn = jest.fn().mockImplementation((query) => ({
    populate: jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue(achieversByLevel[query.level] || []),
    }),
  }));
  return fn;
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

    wallet = {
      weeklyPool: 100,
      monthlyPool: 100,
      totalBalance: 0,
      lastWeeklyPayoutAt: new Date('2025-01-01T00:00:00.000Z'),
      lastMonthlyPayoutAt: new Date('2025-02-01T00:00:00.000Z'),
      save: mockSave,
    };

    SystemWallet.findOne.mockResolvedValue(wallet);

    req = { user: { _id: 'admin507f1f77bcf86cd799439099', role: 'admin' } };
    res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  });

  describe('payoutWeeklyRewards', () => {
    it('pays level 1 achiever when eligible', async () => {
      const userId = '507f1f77bcf86cd799439001';
      Achievement.find = mockAchievementFind({
        1: [makeAchiever(userId, 'Emerging Leader Bonus')],
      });
      isEligibleForLowLevelReward.mockResolvedValue(true);
      const expectedSince = wallet.lastWeeklyPayoutAt;

      await payoutWeeklyRewards(req, res);

      expect(isEligibleForLowLevelReward).toHaveBeenCalledWith(
        userId,
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
      expect(EarningLog.insertMany).toHaveBeenCalled();
      expect(wallet.weeklyPool).toBe(0);
      expect(wallet.lastWeeklyPayoutAt).toBeInstanceOf(Date);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true })
      );
    });

    it('skips level 1 achiever when ineligible and returns share to totalBalance', async () => {
      const userId = '507f1f77bcf86cd799439002';
      Achievement.find = mockAchievementFind({
        1: [makeAchiever(userId)],
      });
      isEligibleForLowLevelReward.mockResolvedValue(false);

      await payoutWeeklyRewards(req, res);

      expect(User.bulkWrite).not.toHaveBeenCalled();
      expect(EarningLog.insertMany).not.toHaveBeenCalled();
      expect(wallet.totalBalance).toBe(100);
      expect(SystemEarningLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'inflow',
          source: 'weeklyPayout',
          context: expect.stringContaining('skipped'),
        })
      );
    });

    it('still pays level 3 when eligibility helper returns false', async () => {
      const userId = '507f1f77bcf86cd799439003';
      Achievement.find = mockAchievementFind({
        3: [{ level: 3, title: 'Team Performance Bonus', userId: { _id: userId } }],
      });
      isEligibleForLowLevelReward.mockResolvedValue(false);

      await payoutWeeklyRewards(req, res);

      expect(isEligibleForLowLevelReward).not.toHaveBeenCalled();
      expect(User.bulkWrite).toHaveBeenCalledWith([
        expect.objectContaining({
          updateOne: {
            filter: { _id: userId },
            update: { $inc: { 'wallets.shortVideoWallet': 10 } },
          },
        }),
      ]);
    });

    it('pays only eligible user when two level 1 achievers', async () => {
      const eligibleId = '507f1f77bcf86cd799439004';
      const ineligibleId = '507f1f77bcf86cd799439005';
      Achievement.find = mockAchievementFind({
        1: [makeAchiever(eligibleId), makeAchiever(ineligibleId)],
      });
      isEligibleForLowLevelReward.mockImplementation(async (uid) => {
        return String(uid) === eligibleId;
      });

      await payoutWeeklyRewards(req, res);

      expect(User.bulkWrite).toHaveBeenCalledTimes(1);
      const bulkOps = User.bulkWrite.mock.calls[0][0];
      expect(bulkOps).toHaveLength(1);
      expect(bulkOps[0].updateOne.filter._id).toBe(eligibleId);
      expect(bulkOps[0].updateOne.update.$inc['wallets.shortVideoWallet']).toBe(5);
      expect(wallet.totalBalance).toBe(95);
    });

    it('returns full perLevel when level has zero achievers', async () => {
      Achievement.find = mockAchievementFind({});
      isEligibleForLowLevelReward.mockResolvedValue(true);

      await payoutWeeklyRewards(req, res);

      expect(wallet.totalBalance).toBe(100);
      expect(User.bulkWrite).not.toHaveBeenCalled();
    });
  });

  describe('payoutMonthlyRewards', () => {
    it('uses lastMonthlyPayoutAt for eligibility check', async () => {
      const userId = '507f1f77bcf86cd799439006';
      MonthlyAchievement.find = mockAchievementFind({
        1: [{ level: 1, title: 'Business Associate', userId: { _id: userId } }],
      });
      isEligibleForLowLevelReward.mockResolvedValue(true);
      const expectedSince = wallet.lastMonthlyPayoutAt;

      await payoutMonthlyRewards(req, res);

      expect(isEligibleForLowLevelReward).toHaveBeenCalledWith(
        userId,
        expectedSince,
        expect.any(Map)
      );
      expect(wallet.monthlyPool).toBe(0);
      expect(wallet.lastMonthlyPayoutAt).toBeInstanceOf(Date);
    });

    it('skips level 2 when ineligible', async () => {
      const userId = '507f1f77bcf86cd799439007';
      MonthlyAchievement.find = mockAchievementFind({
        2: [{ level: 2, title: 'Development Associate', userId: { _id: userId } }],
      });
      isEligibleForLowLevelReward.mockResolvedValue(false);

      await payoutMonthlyRewards(req, res);

      expect(isEligibleForLowLevelReward).toHaveBeenCalled();
      expect(User.bulkWrite).not.toHaveBeenCalled();
      expect(wallet.totalBalance).toBe(100);
    });
  });

  describe('regression: level 5 math unchanged', () => {
    it('does not call eligibility for level 5 and pays full share', async () => {
      const userId = '507f1f77bcf86cd799439008';
      Achievement.find = mockAchievementFind({
        5: [{ level: 5, title: 'Team Growth Bonus', userId: { _id: userId } }],
      });

      await payoutWeeklyRewards(req, res);

      expect(isEligibleForLowLevelReward).not.toHaveBeenCalled();
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
