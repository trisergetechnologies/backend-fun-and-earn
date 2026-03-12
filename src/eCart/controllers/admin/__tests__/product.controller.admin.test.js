/**
 * Unit tests for admin product controller. All dependencies mocked; no DB or HTTP.
 */
jest.mock('../../../models/Category', () => ({ findById: jest.fn() }));
jest.mock('../../../models/Product', () => {
  const save = jest.fn().mockResolvedValue(undefined);
  const MockProduct = jest.fn().mockImplementation(function (attrs) {
    return { ...attrs, save };
  });
  MockProduct.findByIdAndUpdate = jest.fn();
  return MockProduct;
});
jest.mock('../../../../models/User', () => ({}));

const Category = require('../../../models/Category');
const Product = require('../../../models/Product');
const { addProduct, updateProduct } = require('../product.controller.admin');

describe('product.controller.admin', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('addProduct', () => {
    it('rejects when required fields missing', async () => {
      const req = { user: { role: 'admin' }, body: { title: '', price: 100, stock: 1, categoryId: 'c1', sellerId: 's1' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await addProduct(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: false, message: 'Missing or invalid required fields' })
      );
    });

    it('uses default gst 0.05 when gst not provided', async () => {
      Category.findById.mockResolvedValue({ _id: 'c1' });
      const req = {
        user: { role: 'admin' },
        body: { title: 'Test', description: '', price: 100, stock: 5, categoryId: 'c1', sellerId: 's1', discountPercent: 0 },
        file: null,
      };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await addProduct(req, res);

      expect(Product).toHaveBeenCalled();
      const callArg = Product.mock.calls[0][0];
      expect(callArg.gst).toBe(0.05);
    });

    it('parses gst from body when provided', async () => {
      Category.findById.mockResolvedValue({ _id: 'c1' });
      const req = {
        user: { role: 'admin' },
        body: { title: 'Test', description: '', price: 100, stock: 5, categoryId: 'c1', sellerId: 's1', gst: '0.18' },
        file: null,
      };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await addProduct(req, res);

      expect(Product).toHaveBeenCalled();
      expect(Product.mock.calls[0][0].gst).toBe(0.18);
    });

    it('parses variations from JSON string', async () => {
      Category.findById.mockResolvedValue({ _id: 'c1' });
      const req = {
        user: { role: 'admin' },
        body: {
          title: 'Shirt',
          description: '',
          price: 500,
          stock: 10,
          categoryId: 'c1',
          sellerId: 's1',
          variations: JSON.stringify([{ name: 'Size', options: ['S', 'M', 'L'] }]),
        },
        file: null,
      };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await addProduct(req, res);

      expect(Product).toHaveBeenCalled();
      expect(Product.mock.calls[0][0].variations).toEqual([{ name: 'Size', options: ['S', 'M', 'L'] }]);
    });

    it('rejects when category does not exist', async () => {
      Category.findById.mockResolvedValue(null);
      const req = {
        user: { role: 'admin' },
        body: { title: 'Test', price: 100, stock: 5, categoryId: 'c1', sellerId: 's1' },
      };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await addProduct(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: false, message: 'Selected category does not exist' })
      );
    });
  });

  describe('updateProduct', () => {
    it('parses gst and variations from body and calls findByIdAndUpdate', async () => {
      const updatedDoc = {
        _id: 'p1',
        price: 200,
        discountPercent: 10,
        finalPrice: 180,
        images: [],
        save: jest.fn().mockResolvedValue(undefined),
      };
      Product.findByIdAndUpdate.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockResolvedValue(updatedDoc),
        }),
      });

      const req = {
        params: { id: 'p1' },
        body: { gst: '0.12', variations: '[{"name":"Color","options":["Red"]}]' },
      };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await updateProduct(req, res);

      expect(Product.findByIdAndUpdate).toHaveBeenCalledWith(
        'p1',
        expect.objectContaining({
          gst: 0.12,
          variations: [{ name: 'Color', options: ['Red'] }],
        }),
        expect.any(Object)
      );
    });
  });
});
