'use strict';

jest.mock('../../../models/SystemEarningLog', () => ({
  countDocuments: jest.fn(),
  find: jest.fn(),
}));

jest.mock('../../../models/User', () => ({
  find: jest.fn(),
}));

const SystemEarningLog = require('../../../models/SystemEarningLog');
const User = require('../../../models/User');
const {
  getSystemEarningLogsPage,
  mapLogRow,
  buildBaseMatch,
} = require('../systemEarningLogs.service');

describe('systemEarningLogs.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('buildBaseMatch', () => {
    it('adds type and source filters', () => {
      expect(buildBaseMatch('inflow', 'weeklyPayout')).toEqual({
        type: 'inflow',
        source: 'weeklyPayout',
      });
    });

    it('ignores all', () => {
      expect(buildBaseMatch('all', 'all')).toEqual({});
    });
  });

  describe('mapLogRow', () => {
    it('maps fromUser from userMap', () => {
      const userMap = new Map([
        [
          '507f1f77bcf86cd799439011',
          { _id: '507f1f77bcf86cd799439011', name: 'Alice', serialNumber: 42 },
        ],
      ]);
      const row = mapLogRow(
        {
          _id: 'log1',
          amount: 100,
          type: 'inflow',
          source: 'teamPurchase',
          context: 'Test',
          status: 'success',
          createdAt: new Date(),
          updatedAt: new Date(),
          fromUser: '507f1f77bcf86cd799439011',
        },
        userMap
      );
      expect(row.fromUser).toEqual({
        id: '507f1f77bcf86cd799439011',
        name: 'Alice',
        serialNumber: 42,
      });
    });
  });

  describe('getSystemEarningLogsPage', () => {
    it('paginates with find before user hydrate', async () => {
      SystemEarningLog.countDocuments.mockResolvedValue(1);
      const lean = jest.fn().mockResolvedValue([
        {
          _id: 'log1',
          amount: 100,
          type: 'inflow',
          source: 'teamPurchase',
          context: 'Test',
          status: 'success',
          createdAt: new Date('2025-01-01'),
          updatedAt: new Date('2025-01-01'),
          fromUser: '507f1f77bcf86cd799439011',
        },
      ]);
      SystemEarningLog.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          skip: jest.fn().mockReturnValue({
            limit: jest.fn().mockReturnValue({ lean }),
          }),
        }),
      });
      User.find.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([
            {
              _id: '507f1f77bcf86cd799439011',
              name: 'Alice',
              serialNumber: 42,
            },
          ]),
        }),
      });

      const result = await getSystemEarningLogsPage({ page: 1, limit: 20 });

      expect(SystemEarningLog.find).toHaveBeenCalled();
      expect(result.logs).toHaveLength(1);
      expect(result.logs[0].fromUser.serialNumber).toBe(42);
      expect(result.pagination.total).toBe(1);
    });

    it('applies type filter in count and find', async () => {
      SystemEarningLog.countDocuments.mockResolvedValue(0);
      SystemEarningLog.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          skip: jest.fn().mockReturnValue({
            limit: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
          }),
        }),
      });

      await getSystemEarningLogsPage({ page: 1, limit: 20, type: 'outflow' });

      expect(SystemEarningLog.countDocuments).toHaveBeenCalledWith({ type: 'outflow' });
      expect(SystemEarningLog.find).toHaveBeenCalledWith({ type: 'outflow' });
    });
  });
});
