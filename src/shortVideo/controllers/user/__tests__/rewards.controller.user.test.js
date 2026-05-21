'use strict';

jest.mock('../../../services/rewardsPayoutEligible.service', () => ({
  getPayoutEligibleUsers: jest.fn(),
}));

jest.mock('../../../services/topEarners.service', () => ({
  getTopEarnersPage: jest.fn(),
}));

const { getPayoutEligibleUsers } = require('../../../services/rewardsPayoutEligible.service');
const { getTopEarnersPage } = require('../../../services/topEarners.service');
const { getPayoutEligible, getTopEarners } = require('../rewards.controller.user');

describe('rewards.controller.user', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getPayoutEligible', () => {
    it('returns 200 with service data', async () => {
      const payload = {
        meta: { poolType: 'weekly', eligibilityRulesActive: true },
        users: [],
        pagination: { page: 1, limit: 20, total: 0, totalPages: 1, hasMore: false },
      };
      getPayoutEligibleUsers.mockResolvedValue(payload);

      const req = { query: { poolType: 'weekly', page: 1, limit: 20 } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await getPayoutEligible(req, res);

      expect(getPayoutEligibleUsers).toHaveBeenCalledWith({
        poolType: 'weekly',
        page: 1,
        limit: 20,
      });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, data: payload })
      );
    });

    it('rejects invalid poolType', async () => {
      const req = { query: { poolType: 'daily' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await getPayoutEligible(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: false })
      );
    });
  });

  describe('getTopEarners', () => {
    it('returns ranked users with pagination', async () => {
      getTopEarnersPage.mockResolvedValue({
        users: [
          {
            rank: 1,
            userId: '507f1f77bcf86cd799439001',
            totalEarned: 500,
            name: 'Alice',
            serialNumber: 1,
            referralCode: 'A1',
            packageName: 'Gold',
          },
        ],
        pagination: { page: 1, limit: 20, total: 1, totalPages: 1, hasMore: false },
      });

      const req = { query: { page: 1, limit: 20 } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await getTopEarners(req, res);

      expect(getTopEarnersPage).toHaveBeenCalledWith({ page: 1, limit: 15 });
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            users: expect.arrayContaining([
              expect.objectContaining({ rank: 1, name: 'Alice', totalEarned: 500 }),
            ]),
          }),
        })
      );
    });
  });
});
