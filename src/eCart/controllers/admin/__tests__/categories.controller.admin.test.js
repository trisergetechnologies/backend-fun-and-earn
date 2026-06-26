jest.mock('../../../models/Category', () => ({
  findOne: jest.fn(),
  findById: jest.fn(),
  findByIdAndUpdate: jest.fn(),
  create: jest.fn(),
}));
jest.mock('../../../models/Product', () => ({
  countDocuments: jest.fn(),
}));

const Category = require('../../../models/Category');
const Product = require('../../../models/Product');
const { deleteCategory, addCategory } = require('../categories.controller.admin');

describe('categories.controller.admin', () => {
  beforeEach(() => jest.clearAllMocks());

  it('deleteCategory blocks when products exist', async () => {
    Product.countDocuments.mockResolvedValue(3);
    const req = { user: { role: 'admin' }, params: { id: 'cat1' } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

    await deleteCategory(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: expect.stringContaining('3 product') })
    );
  });

  it('addCategory reactivates inactive slug match', async () => {
    const inactive = {
      title: 'Old',
      slug: 'old-cat',
      isActive: false,
      save: jest.fn().mockResolvedValue(undefined),
    };
    Category.findOne
      .mockResolvedValueOnce(inactive)
      .mockResolvedValueOnce(null);
    const req = {
      user: { role: 'admin', _id: 'admin1' },
      body: { title: 'Old Cat', description: 'desc' },
    };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

    await addCategory(req, res);

    expect(inactive.isActive).toBe(true);
    expect(inactive.save).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, message: expect.stringContaining('reactivated') })
    );
  });
});
