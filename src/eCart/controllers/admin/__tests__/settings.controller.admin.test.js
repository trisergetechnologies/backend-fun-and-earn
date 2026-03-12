/**
 * Unit tests for settings controller. All dependencies mocked; no DB or HTTP.
 */
jest.mock('../../../../models/Settings', () => ({
  findOne: jest.fn(),
  create: jest.fn(),
}));

const Settings = require('../../../../models/Settings');
const { getSettings, updateSettings } = require('../settings.controller.admin');

describe('settings.controller.admin', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getSettings', () => {
    it('returns existing settings when found', async () => {
      const doc = { deliveryMode: 'no_charge', deliveryChargeAmount: 0, freeDeliveryAbove: 500 };
      Settings.findOne.mockResolvedValue(doc);

      const req = {};
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await getSettings(req, res);

      expect(Settings.create).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, data: doc })
      );
    });

    it('creates and returns settings when none exist', async () => {
      Settings.findOne.mockResolvedValue(null);
      const created = { _id: 'new', deliveryMode: 'no_charge' };
      Settings.create.mockResolvedValue(created);

      const req = {};
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await getSettings(req, res);

      expect(Settings.create).toHaveBeenCalledWith({});
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, data: created })
      );
    });
  });

  describe('updateSettings', () => {
    it('updates only allowed delivery fields', async () => {
      const existing = {
        _id: 's1',
        deliveryMode: 'no_charge',
        save: jest.fn().mockResolvedValue(undefined),
      };
      Settings.findOne.mockResolvedValue(existing);

      const req = {
        body: {
          deliveryMode: 'free_above_amount',
          deliveryChargeAmount: 80,
          freeDeliveryAbove: 600,
          someDisallowedField: 'ignored',
        },
      };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await updateSettings(req, res);

      expect(existing.save).toHaveBeenCalled();
      expect(existing.deliveryMode).toBe('free_above_amount');
      expect(existing.deliveryChargeAmount).toBe(80);
      expect(existing.freeDeliveryAbove).toBe(600);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, message: 'Settings updated successfully' })
      );
    });

    it('creates settings when none exist on update', async () => {
      Settings.findOne.mockResolvedValue(null);
      const created = { _id: 'new', deliveryMode: 'always_charge', save: jest.fn() };
      Settings.create.mockResolvedValue(created);

      const req = { body: { deliveryMode: 'always_charge', deliveryChargeAmount: 50 } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await updateSettings(req, res);

      expect(Settings.create).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true })
      );
    });
  });
});
