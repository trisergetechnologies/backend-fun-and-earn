jest.mock('../../../models/Product', () => ({
  countDocuments: jest.fn(),
  updateMany: jest.fn().mockResolvedValue({}),
}));
jest.mock('../../../../models/User', () => {
  const save = jest.fn().mockResolvedValue(undefined);
  return {
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
    create: jest.fn(),
    find: jest.fn(),
    countDocuments: jest.fn(),
  };
});

const Product = require('../../../models/Product');
const User = require('../../../../models/User');
const { deleteSeller } = require('../seller.controller.admin');

describe('seller.controller.admin deleteSeller', () => {
  beforeEach(() => jest.clearAllMocks());

  it('deactivates seller, clears token, and deactivates products', async () => {
    User.findOneAndUpdate.mockReturnValue({
      select: jest.fn().mockResolvedValue({ _id: 'seller1', isActive: false }),
    });
    const req = { user: { role: 'admin' }, params: { id: 'seller1' } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

    await deleteSeller(req, res);

    expect(User.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'seller1', role: 'seller' },
      { isActive: false, token: null },
      { new: true }
    );
    expect(Product.updateMany).toHaveBeenCalledWith(
      { sellerId: 'seller1' },
      { isActive: false }
    );
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true })
    );
  });
});
