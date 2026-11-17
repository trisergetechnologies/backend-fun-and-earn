const {
  computeProductPricing,
  assertDiscountOk,
  getExGstSellFromProduct,
  parsePricingInput,
  computeCartPricingBreakdown,
  toCartPricingResponse,
  round2,
} = require('../productPricing');

describe('productPricing', () => {
  describe('computeProductPricing', () => {
    it('computes inclusive list/sell with transport, flat discount, gst 5%', () => {
      const r = computeProductPricing({
        basePrice: 100,
        transportCharge: 0,
        discountAmount: 10,
        gst: 0.05,
      });
      expect(r.exGstList).toBe(100);
      expect(r.exGstSell).toBe(90);
      expect(r.price).toBe(105);
      expect(r.finalPrice).toBe(94.5);
      expect(r.discountPercent).toBe(10);
    });

    it('includes transport in ex-GST list', () => {
      const r = computeProductPricing({
        basePrice: 100,
        transportCharge: 20,
        discountAmount: 0,
        gst: 0.05,
      });
      expect(r.exGstList).toBe(120);
      expect(r.price).toBe(126);
      expect(r.finalPrice).toBe(126);
      expect(r.discountPercent).toBe(0);
    });

    it('handles zero discount and zero transport', () => {
      const r = computeProductPricing({
        basePrice: 200,
        transportCharge: 0,
        discountAmount: 0,
        gst: 0.18,
      });
      expect(r.price).toBe(236);
      expect(r.finalPrice).toBe(236);
    });

    it('handles gst 0', () => {
      const r = computeProductPricing({
        basePrice: 100,
        transportCharge: 10,
        discountAmount: 5,
        gst: 0,
      });
      expect(r.price).toBe(110);
      expect(r.finalPrice).toBe(105);
      expect(r.discountPercent).toBe(round2((5 / 110) * 100));
    });

    it('clamps discount to exGstList (100% off)', () => {
      const r = computeProductPricing({
        basePrice: 50,
        transportCharge: 0,
        discountAmount: 999,
        gst: 0.05,
      });
      expect(r.discountAmount).toBe(50);
      expect(r.exGstSell).toBe(0);
      expect(r.finalPrice).toBe(0);
      expect(r.discountPercent).toBe(100);
    });

    it('rounds to 2 decimals', () => {
      const r = computeProductPricing({
        basePrice: 99.999,
        transportCharge: 0.001,
        discountAmount: 0,
        gst: 0.05,
      });
      expect(r.basePrice).toBe(100);
      expect(r.exGstList).toBe(100);
      expect(r.price).toBe(105);
    });
  });

  describe('assertDiscountOk', () => {
    it('rejects discount above price+transport', () => {
      const r = assertDiscountOk({
        basePrice: 100,
        transportCharge: 10,
        discountAmount: 120,
      });
      expect(r.ok).toBe(false);
    });

    it('accepts valid discount', () => {
      expect(
        assertDiscountOk({
          basePrice: 100,
          transportCharge: 10,
          discountAmount: 110,
        }).ok
      ).toBe(true);
    });
  });

  describe('getExGstSellFromProduct', () => {
    it('uses basePrice inputs when present', () => {
      expect(
        getExGstSellFromProduct({
          basePrice: 100,
          transportCharge: 20,
          discountAmount: 10,
          gst: 0.05,
          finalPrice: 999,
        })
      ).toBe(110);
    });

    it('falls back to finalPrice / (1+gst)', () => {
      expect(
        getExGstSellFromProduct({ finalPrice: 105, gst: 0.05 })
      ).toBe(100);
    });
  });

  describe('backward compatibility payable', () => {
    it('old app total (inclusive + totalGstAmount 0) matches new breakdown total', () => {
      const priced = computeProductPricing({
        basePrice: 100,
        transportCharge: 20,
        discountAmount: 10,
        gst: 0.05,
      });
      const qty = 2;
      const inclusiveSubtotal = priced.finalPrice * qty;
      const oldAppTotal = inclusiveSubtotal + 0 + 40; // delivery 40, cart.totalGstAmount=0
      const exGstSubtotal = priced.exGstSell * qty;
      const gstBreakdown = priced.exGstSell * priced.gst * qty;
      const newAppTotal = exGstSubtotal + gstBreakdown + 40;
      expect(round2(oldAppTotal)).toBe(round2(newAppTotal));
      expect(round2(inclusiveSubtotal)).toBe(round2(exGstSubtotal + gstBreakdown));
    });

    it('toCartPricingResponse zeros totalGstAmount and exposes breakdown', () => {
      const priced = computeProductPricing({
        basePrice: 100,
        transportCharge: 0,
        discountAmount: 10,
        gst: 0.05,
      });
      const breakdown = computeCartPricingBreakdown([
        {
          quantity: 1,
          productId: {
            basePrice: priced.basePrice,
            transportCharge: priced.transportCharge,
            discountAmount: priced.discountAmount,
            gst: priced.gst,
            finalPrice: priced.finalPrice,
          },
        },
      ]);
      const data = toCartPricingResponse({ items: [], totalGstAmount: 99 }, breakdown);
      expect(data.totalGstAmount).toBe(0);
      expect(data.exGstSubtotal).toBe(90);
      expect(data.gstBreakdownAmount).toBe(4.5);
    });
  });

  describe('parsePricingInput', () => {
    it('uses basePrice when provided', () => {
      const r = parsePricingInput({
        basePrice: '100',
        transportCharge: '15',
        discountAmount: '5',
        gst: '0.05',
      });
      expect(r).toEqual({
        basePrice: 100,
        transportCharge: 15,
        discountAmount: 5,
        gst: 0.05,
      });
    });

    it('treats legacy price as base and discountPercent as flat', () => {
      const r = parsePricingInput({
        price: 100,
        discountPercent: 10,
        gst: 0.05,
      });
      expect(r.basePrice).toBe(100);
      expect(r.discountAmount).toBe(10);
      expect(r.transportCharge).toBe(0);
    });

    it('merges with existing on partial update', () => {
      const r = parsePricingInput(
        { discountAmount: 20 },
        {
          basePrice: 100,
          transportCharge: 10,
          discountAmount: 5,
          gst: 0.18,
        }
      );
      expect(r.basePrice).toBe(100);
      expect(r.transportCharge).toBe(10);
      expect(r.discountAmount).toBe(20);
      expect(r.gst).toBe(0.18);
    });
  });
});
