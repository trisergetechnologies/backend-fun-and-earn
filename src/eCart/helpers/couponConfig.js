const WALLETS = ['eCartWallet', 'shortVideoWallet'];
const MAX_AMOUNT = 100000;
const AMOUNT_PATTERN = /^\d+(\.\d{1,2})?$/;

/**
 * @param {object} body
 * @param {{ applyDefault?: boolean }} [options]
 * applyDefault true (create): missing checkbox means not eligible.
 * applyDefault false (update): missing checkbox leaves existing coupon fields unchanged.
 */
function parseCouponConfig(body, options = {}) {
  const applyDefault = options.applyDefault === true;
  const raw = body?.couponEligible;
  const present = raw !== undefined && raw !== null && raw !== '';

  if (!present) {
    if (!applyDefault) return { ok: true, fields: null };
    return {
      ok: true,
      fields: { couponEligible: false, couponWallet: null, couponAmount: null },
    };
  }

  const eligible = raw === true || raw === 'true' || raw === '1';
  if (!eligible) {
    return {
      ok: true,
      fields: { couponEligible: false, couponWallet: null, couponAmount: null },
    };
  }

  const wallet = typeof body.couponWallet === 'string' ? body.couponWallet.trim() : '';
  if (!WALLETS.includes(wallet)) {
    return { ok: false, message: 'Choose where this coupon is credited' };
  }

  const amountText = String(body.couponAmount ?? '').trim();
  if (!AMOUNT_PATTERN.test(amountText)) {
    return { ok: false, message: 'Enter a valid coupon amount' };
  }

  const amount = Math.round(Number(amountText) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT) {
    return { ok: false, message: 'Enter a valid coupon amount' };
  }

  return {
    ok: true,
    fields: { couponEligible: true, couponWallet: wallet, couponAmount: amount },
  };
}

function couponItemSnapshot(product) {
  const wallet = product?.couponWallet;
  const amount = Number(product?.couponAmount);
  const eligible = product?.couponEligible === true
    && WALLETS.includes(wallet)
    && Number.isFinite(amount)
    && amount > 0
    && amount <= MAX_AMOUNT;

  if (!eligible) {
    return { couponEligible: false };
  }

  return {
    couponEligible: true,
    couponWallet: wallet,
    couponAmount: Math.round(amount * 100) / 100,
  };
}

module.exports = { parseCouponConfig, couponItemSnapshot, WALLETS, MAX_AMOUNT };
