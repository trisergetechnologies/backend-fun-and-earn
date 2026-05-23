'use strict';

jest.mock('../../../services/systemEarningLogs.service', () => ({
  getSystemEarningLogsPage: jest.fn(),
}));

const { getSystemEarningLogsPage } = require('../../../services/systemEarningLogs.service');
const { getSystemEarningLogs } = require('../system.controller.admin');

describe('getSystemEarningLogs controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns logs with populated fromUser shape', async () => {
    getSystemEarningLogsPage.mockResolvedValue({
      logs: [
        {
          _id: 'log1',
          amount: 100,
          type: 'inflow',
          source: 'teamPurchase',
          context: 'Test',
          status: 'success',
          createdAt: new Date('2025-01-01'),
          updatedAt: new Date('2025-01-01'),
          fromUser: {
            id: '507f1f77bcf86cd799439011',
            name: 'Alice',
            serialNumber: 42,
          },
        },
      ],
      pagination: { total: 1, page: 1, limit: 20, totalPages: 1 },
    });

    const req = { query: { page: 1, limit: 20 } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

    await getSystemEarningLogs(req, res);

    expect(getSystemEarningLogsPage).toHaveBeenCalledWith({
      page: 1,
      limit: 20,
      search: undefined,
      type: undefined,
      source: undefined,
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          logs: [
            expect.objectContaining({
              fromUser: {
                id: '507f1f77bcf86cd799439011',
                name: 'Alice',
                serialNumber: 42,
              },
            }),
          ],
        }),
      })
    );
  });

  it('passes filters to service', async () => {
    getSystemEarningLogsPage.mockResolvedValue({
      logs: [],
      pagination: { total: 0, page: 1, limit: 20, totalPages: 1 },
    });

    const req = {
      query: { page: 2, limit: 10, search: 'weekly', type: 'outflow', source: 'weeklyPayout' },
    };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

    await getSystemEarningLogs(req, res);

    expect(getSystemEarningLogsPage).toHaveBeenCalledWith({
      page: 2,
      limit: 10,
      search: 'weekly',
      type: 'outflow',
      source: 'weeklyPayout',
    });
  });
});
