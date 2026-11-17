/**
 * Dream Mart product pricing (GST-inclusive snapshots for customer BC fields).
 *
 * Inputs: basePrice, transportCharge, discountAmount (₹), gst (rate e.g. 0.05)
 * Derived:
 *   exGstList  = basePrice + transportCharge
 *   exGstSell  = max(0, exGstList - discountAmount)
 *   price      = exGstList * (1 + gst)   // inclusive list / strike
 *   finalPrice = exGstSell * (1 + gst)  // inclusive sell
 *   discountPercent = (discountAmount / exGstList) * 100
 */

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function toNum(v, fallback = 0) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

function hasValue(v) {
  return v !== undefined && v !== null && v !== '';
}

/**
 * @param {{ basePrice: number, transportCharge?: number, discountAmount?: number, gst?: number }} input
 */
function computeProductPricing(input = {}) {
  const basePrice = round2(Math.max(0, toNum(input.basePrice, 0)));
  const transportCharge = round2(Math.max(0, toNum(input.transportCharge, 0)));
  let discountAmount = round2(Math.max(0, toNum(input.discountAmount, 0)));
  const gst = Math.max(0, toNum(input.gst, 0.05));

  const exGstList = round2(basePrice + transportCharge);
  if (discountAmount > exGstList) {
    discountAmount = exGstList;
  }
  const exGstSell = round2(Math.max(0, exGstList - discountAmount));
  const price = round2(exGstList * (1 + gst));
  const finalPrice = round2(exGstSell * (1 + gst));
  const discountPercent =
    exGstList > 0 ? round2((discountAmount / exGstList) * 100) : 0;

  return {
    basePrice,
    transportCharge,
    discountAmount,
    gst,
    exGstList,
    exGstSell,
    price,
    finalPrice,
    discountPercent,
  };
}

/**
 * Validate discount before save (does not clamp — use for API errors).
 * @returns {{ ok: true } | { ok: false, message: string }}
 */
function assertDiscountOk({ basePrice, transportCharge = 0, discountAmount = 0 }) {
  const base = toNum(basePrice, NaN);
  const transport = toNum(transportCharge, 0);
  const discount = toNum(discountAmount, 0);

  if (!Number.isFinite(base) || base < 0) {
    return { ok: false, message: 'Invalid price' };
  }
  if (!Number.isFinite(transport) || transport < 0) {
    return { ok: false, message: 'Invalid transport charge' };
  }
  if (!Number.isFinite(discount) || discount < 0) {
    return { ok: false, message: 'Invalid discount amount' };
  }

  const exGstList = round2(base + transport);
  if (discount > exGstList) {
    return {
      ok: false,
      message: 'Discount cannot exceed Price + Transport',
    };
  }
  return { ok: true };
}

/**
 * Resolve sell ex-GST for a product document (prefer stored inputs).
 */
function getExGstSellFromProduct(product) {
  if (!product) return 0;
  const gst = toNum(product.gst, 0);
  if (product.basePrice != null) {
    const priced = computeProductPricing({
      basePrice: product.basePrice,
      transportCharge: product.transportCharge || 0,
      discountAmount: product.discountAmount || 0,
      gst,
    });
    return priced.exGstSell;
  }
  const finalPrice = toNum(product.finalPrice, 0);
  if (gst > 0) return round2(finalPrice / (1 + gst));
  return round2(finalPrice);
}

/**
 * Parse create/update body into pricing inputs.
 * - basePrice from body.basePrice, else body.price (legacy = base), else existing.basePrice/price
 * - discountAmount preferred; legacy discountPercent converted against exGstList
 */
function parsePricingInput(body = {}, existing = null) {
  let basePrice;
  if (hasValue(body.basePrice)) {
    basePrice = parseFloat(body.basePrice);
  } else if (hasValue(body.price)) {
    basePrice = parseFloat(body.price);
  } else if (existing) {
    basePrice = existing.basePrice != null ? existing.basePrice : existing.price;
  } else {
    basePrice = NaN;
  }

  const transportCharge = hasValue(body.transportCharge)
    ? parseFloat(body.transportCharge)
    : existing
      ? toNum(existing.transportCharge, 0)
      : 0;

  let discountAmount;
  if (hasValue(body.discountAmount)) {
    discountAmount = parseFloat(body.discountAmount);
  } else if (hasValue(body.discountPercent) && !hasValue(body.discountAmount)) {
    const pct = parseFloat(body.discountPercent) || 0;
    const exGstList = round2(toNum(basePrice, 0) + toNum(transportCharge, 0));
    discountAmount = round2((exGstList * pct) / 100);
  } else if (existing) {
    discountAmount = toNum(existing.discountAmount, 0);
  } else {
    discountAmount = 0;
  }

  const gst = hasValue(body.gst)
    ? parseFloat(body.gst)
    : existing
      ? toNum(existing.gst, 0.05)
      : 0.05;

  return { basePrice, transportCharge, discountAmount, gst };
}

/**
 * Cart/order breakdown from populated cart items.
 * finalPrice is GST-inclusive; totalGstAmount for BC clients must stay 0 on cart.
 */
function computeCartPricingBreakdown(items = []) {
  let exGstSubtotal = 0;
  let gstBreakdownAmount = 0;
  let inclusiveSubtotal = 0;

  for (const item of items) {
    const product = item?.productId;
    if (!product || typeof product !== 'object') continue;
    const qty = item.quantity || 1;
    const exGstSell = getExGstSellFromProduct(product);
    const gstRate = toNum(product.gst, 0);
    exGstSubtotal += exGstSell * qty;
    gstBreakdownAmount += exGstSell * gstRate * qty;
    inclusiveSubtotal += toNum(product.finalPrice, 0) * qty;
  }

  return {
    exGstSubtotal: round2(exGstSubtotal),
    gstBreakdownAmount: round2(gstBreakdownAmount),
    inclusiveSubtotal: round2(inclusiveSubtotal),
  };
}

function toCartPricingResponse(cart, breakdown) {
  const data =
    cart && typeof cart.toObject === 'function'
      ? cart.toObject()
      : { ...(cart || {}) };
  // BC: old apps do subtotal(finalPrice) + totalGstAmount + delivery
  data.totalGstAmount = 0;
  data.exGstSubtotal = breakdown.exGstSubtotal;
  data.gstBreakdownAmount = breakdown.gstBreakdownAmount;
  return data;
}

module.exports = {
  round2,
  computeProductPricing,
  assertDiscountOk,
  getExGstSellFromProduct,
  parsePricingInput,
  computeCartPricingBreakdown,
  toCartPricingResponse,
};
