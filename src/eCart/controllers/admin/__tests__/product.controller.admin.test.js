/**
 * Unit tests for admin product controller. All dependencies mocked; no DB or HTTP.
 */
jest.mock('../../../models/Category', () => ({ findById: jest.fn() }));
jest.mock('../../../models/Product', () => {
  const save = jest.fn().mockResolvedValue(undefined);
  const MockProduct = jest.fn().mockImplementation(function (attrs) {
    return { ...attrs, save };
  });
  MockProduct.findById = jest.fn();
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
      expect(callArg.basePrice).toBe(100);
      expect(callArg.price).toBe(105); // inclusive list
      expect(callArg.finalPrice).toBe(105);
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
      expect(Product.mock.calls[0][0].price).toBe(118);
    });

    it('applies transport and flat discountAmount into inclusive snapshots', async () => {
      Category.findById.mockResolvedValue({ _id: 'c1' });
      const req = {
        user: { role: 'admin' },
        body: {
          title: 'Test',
          description: '',
          basePrice: 100,
          transportCharge: 20,
          discountAmount: 10,
          stock: 5,
          categoryId: 'c1',
          sellerId: 's1',
          gst: 0.05,
        },
        file: null,
      };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await addProduct(req, res);

      const callArg = Product.mock.calls[0][0];
      expect(callArg.basePrice).toBe(100);
      expect(callArg.transportCharge).toBe(20);
      expect(callArg.discountAmount).toBe(10);
      expect(callArg.price).toBe(126); // (100+20)*1.05
      expect(callArg.finalPrice).toBe(115.5); // (120-10)*1.05
      expect(callArg.discountPercent).toBeCloseTo(8.33, 2);
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
      Product.findById.mockResolvedValue({
        images: ['https://x/old.jpg'],
        basePrice: 200,
        transportCharge: 0,
        discountAmount: 20,
        price: 210,
        finalPrice: 189,
        discountPercent: 10,
        gst: 0.05,
      });
      Product.findByIdAndUpdate.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockResolvedValue(updatedDoc),
        }),
      });

      const req = {
        params: { id: 'p1' },
        body: {
          gst: '0.12',
          variations: '[{"name":"Color","options":["Red"]}]',
          existingImages: '["https://x/old.jpg"]',
        },
      };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await updateProduct(req, res);

      expect(Product.findByIdAndUpdate).toHaveBeenCalledWith(
        'p1',
        expect.objectContaining({
          gst: 0.12,
          variations: [{ name: 'Color', options: ['Red'] }],
          images: ['https://x/old.jpg'],
        }),
        expect.any(Object)
      );
    });

    it('applies image removals via existingImages before update', async () => {
      const updatedDoc = {
        _id: 'p1',
        price: 200,
        discountPercent: 10,
        finalPrice: 180,
        images: ['https://x/keep.jpg'],
        save: jest.fn().mockResolvedValue(undefined),
      };
      Product.findById.mockResolvedValue({
        images: ['https://x/keep.jpg', 'https://x/remove.jpg'],
        basePrice: 200,
        transportCharge: 0,
        discountAmount: 20,
        price: 210,
        finalPrice: 189,
        discountPercent: 10,
        gst: 0.05,
      });
      Product.findByIdAndUpdate.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockResolvedValue(updatedDoc),
        }),
      });

      const req = {
        params: { id: 'p1' },
        body: { existingImages: JSON.stringify(['https://x/keep.jpg']) },
      };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await updateProduct(req, res);

      expect(Product.findByIdAndUpdate).toHaveBeenCalledWith(
        'p1',
        expect.objectContaining({
          images: ['https://x/keep.jpg'],
        }),
        expect.any(Object)
      );
    });
  });
});
