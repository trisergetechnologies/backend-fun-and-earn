'use strict';

jest.mock('../../../models/Achievement', () => ({
  aggregate: jest.fn(),
  distinct: jest.fn(),
}));

jest.mock('../../../models/MonthlyAchievement', () => ({
  aggregate: jest.fn(),
  distinct: jest.fn(),
}));

jest.mock('../../../models/User', () => ({
  find: jest.fn(),
}));

const Achievement = require('../../../models/Achievement');
const { getAchievementOverview } = require('../adminAchievements.service');

describe('adminAchievements.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('getAchievementOverview returns totals for weekly', async () => {
    Achievement.aggregate.mockResolvedValue([
      { level: 1, count: 10, uniqueUsers: 8 },
      { level: 2, count: 5, uniqueUsers: 5 },
    ]);
    Achievement.distinct.mockResolvedValue(['id1', 'id2']);

    const result = await getAchievementOverview('weekly');

    expect(result.poolType).toBe('weekly');
    expect(result.totalRecords).toBe(15);
    expect(result.uniqueUsers).toBe(2);
    expect(result.byLevel).toHaveLength(2);
  });
});
