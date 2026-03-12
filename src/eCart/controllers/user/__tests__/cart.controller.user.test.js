/**
 * Unit tests for cart controller. All dependencies are mocked; no DB or HTTP.
 */
const { getCart, addCart } = require('../cart.controller.user');

// Mock models: paths from __tests__ to eCart/models and src/models
jest.mock('../../../models/Cart', () => {
  const findOne = jest.fn();
  function MockCart(attrs) {
    return { ...attrs, save: jest.fn().mockResolvedValue(undefined) };
  }
  MockCart.findOne = findOne;
  return MockCart;
});
jest.mock('../../../models/Product', () => ({ findOne: jest.fn(), findById: jest.fn() }));
jest.mock('../../../../models/Settings', () => ({ findOne: jest.fn() }));

const Cart = require('../../../models/Cart');
const Product = require('../../../models/Product');
const Settings = require('../../../../models/Settings');

describe('cart.controller.user', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getCart', () => {
    it('returns empty cart when user has no cart', async () => {
      Cart.findOne.mockReturnValue({ populate: jest.fn().mockResolvedValue(null) });
      const req = { user: { _id: 'user1', role: 'user' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await getCart(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({ items: [], useWallet: false }),
        })
      );
    });

    it('applies delivery charge when deliveryMode is always_charge', async () => {
      const cart = {
        items: [
          { productId: { finalPrice: 100, gst: 0.05 }, quantity: 2 },
        ],
        totalGstAmount: 0,
        save: jest.fn().mockResolvedValue(undefined),
      };
      Cart.findOne.mockReturnValue({ populate: jest.fn().mockResolvedValue(cart) });
      Settings.findOne.mockResolvedValue({
        deliveryMode: 'always_charge',
        deliveryChargeAmount: 50,
        freeDeliveryAbove: 500,
      });

      const req = { user: { _id: 'user1', role: 'user' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await getCart(req, res);

      expect(cart.deliveryCharge).toBe(50);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, data: expect.any(Object) })
      );
    });

    it('sets delivery to 0 when deliveryMode is no_charge', async () => {
      const cart = {
        items: [
          { productId: { finalPrice: 100, gst: 0.05 }, quantity: 2 },
        ],
        totalGstAmount: 0,
        save: jest.fn().mockResolvedValue(undefined),
      };
      Cart.findOne.mockReturnValue({ populate: jest.fn().mockResolvedValue(cart) });
      Settings.findOne.mockResolvedValue({ deliveryMode: 'no_charge' });

      const req = { user: { _id: 'user1', role: 'user' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await getCart(req, res);

      expect(cart.deliveryCharge).toBe(0);
    });

    it('charges delivery when subtotal below freeDeliveryAbove (free_above_amount)', async () => {
      const cart = {
        items: [
          { productId: { finalPrice: 100, gst: 0.05 }, quantity: 2 },
        ],
        totalGstAmount: 0,
        save: jest.fn().mockResolvedValue(undefined),
      };
      Cart.findOne.mockReturnValue({ populate: jest.fn().mockResolvedValue(cart) });
      Settings.findOne.mockResolvedValue({
        deliveryMode: 'free_above_amount',
        deliveryChargeAmount: 80,
        freeDeliveryAbove: 500,
      });

      const req = { user: { _id: 'user1', role: 'user' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await getCart(req, res);

      expect(cart.deliveryCharge).toBe(80);
    });

    it('free delivery when subtotal >= freeDeliveryAbove (free_above_amount)', async () => {
      const cart = {
        items: [
          { productId: { finalPrice: 300, gst: 0.05 }, quantity: 2 },
        ],
        totalGstAmount: 0,
        save: jest.fn().mockResolvedValue(undefined),
      };
      Cart.findOne.mockReturnValue({ populate: jest.fn().mockResolvedValue(cart) });
      Settings.findOne.mockResolvedValue({
        deliveryMode: 'free_above_amount',
        deliveryChargeAmount: 80,
        freeDeliveryAbove: 500,
      });

      const req = { user: { _id: 'user1', role: 'user' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await getCart(req, res);

      expect(cart.deliveryCharge).toBe(0);
    });

    it('rejects non-user role', async () => {
      const req = { user: { _id: 'user1', role: 'admin' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await getCart(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: false, message: 'Only users can access cart' })
      );
    });
  });

  describe('addCart', () => {
    it('rejects when productId or quantity invalid', async () => {
      const req = {
        user: { _id: 'user1', role: 'user' },
        body: { productId: '', quantity: 0 },
      };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await addCart(req, res);

      expect(Product.findOne).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: false, message: 'Invalid product or quantity' })
      );
    });

    it('rejects when product not found or out of stock', async () => {
      Product.findOne.mockResolvedValue(null);
      const req = {
        user: { _id: 'user1', role: 'user' },
        body: { productId: 'pid1', quantity: 1 },
      };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await addCart(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: false, message: 'Product unavailable or out of stock' })
      );
    });

    it('rejects when product has variations but invalid selectedVariation', async () => {
      Product.findOne.mockResolvedValue({
        _id: 'p1',
        sellerId: 's1',
        stock: 10,
        variations: [{ name: 'Size', options: ['S', 'M'] }],
      });
      Cart.findOne.mockResolvedValue(null);
      const req = {
        user: { _id: 'user1', role: 'user' },
        body: { productId: 'p1', quantity: 1, selectedVariation: [{ name: 'Size', value: 'XL' }] },
      };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await addCart(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: false, message: expect.stringContaining('Please select a valid option') })
      );
    });

    it('accepts valid selectedVariation when product has variations and creates cart', async () => {
      const product = {
        _id: 'p1',
        sellerId: 's1',
        stock: 10,
        variations: [{ name: 'Size', options: ['S', 'M'] }],
      };
      Product.findOne.mockResolvedValue(product);
      Cart.findOne.mockResolvedValue(null);

      const req = {
        user: { _id: 'user1', role: 'user' },
        body: { productId: 'p1', quantity: 1, selectedVariation: [{ name: 'Size', value: 'M' }] },
      };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await addCart(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, message: 'Product added to cart' })
      );
    });
  });
});