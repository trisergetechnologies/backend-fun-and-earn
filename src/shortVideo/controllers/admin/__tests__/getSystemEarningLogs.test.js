'use strict';

jest.mock('../../../../models/SystemEarningLog', () => ({
  aggregate: jest.fn(),
}));

const SystemEarningLog = require('../../../../models/SystemEarningLog');
const { getSystemEarningLogs } = require('../system.controller.admin');

describe('getSystemEarningLogs', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns logs with populated fromUser shape', async () => {
    SystemEarningLog.aggregate.mockResolvedValue([
      {
        rows: [
          {
            _id: 'log1',
            amount: 100,
            type: 'inflow',
            source: 'teamPurchase',
            context: 'Test',
            status: 'success',
            createdAt: new Date('2025-01-01'),
            updatedAt: new Date('2025-01-01'),
            fromUserDoc: {
              _id: '507f1f77bcf86cd799439011',
              name: 'Alice',
              serialNumber: 42,
            },
          },
        ],
        total: [{ count: 1 }],
      },
    ]);

    const req = { query: { page: 1, limit: 20 } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

    await getSystemEarningLogs(req, res);

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
});
