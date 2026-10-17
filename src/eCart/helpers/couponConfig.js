const WALLETS = ['eCartWallet', 'shortVideoWallet'];
const WALLET_MODES = [...WALLETS, 'both'];
const MAX_AMOUNT = 100000;
const AMOUNT_PATTERN = /^\d+(\.\d{1,2})?$/;

function emptyCouponFields() {
  return {
    couponEligible: false,
    couponWallet: null,
    couponAmount: null,
    couponAmountEcart: null,
    couponAmountShortVideo: null,
  };
}

function parseAmount(raw, label) {
  const amountText = String(raw ?? '').trim();
  if (!AMOUNT_PATTERN.test(amountText)) {
    return { ok: false, message: `Enter a valid ${label}` };
  }
  const amount = Math.round(Number(amountText) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT) {
    return { ok: false, message: `Enter a valid ${label}` };
  }
  return { ok: true, amount };
}

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
    return { ok: true, fields: emptyCouponFields() };
  }

  const eligible = raw === true || raw === 'true' || raw === '1';
  if (!eligible) {
    return { ok: true, fields: emptyCouponFields() };
  }

  const wallet = typeof body.couponWallet === 'string' ? body.couponWallet.trim() : '';
  if (!WALLET_MODES.includes(wallet)) {
    return { ok: false, message: 'Choose where this coupon is credited' };
  }

  if (wallet === 'both') {
    const ecart = parseAmount(body.couponAmountEcart, 'Dream Mart amount');
    if (!ecart.ok) return ecart;
    const shortVideo = parseAmount(body.couponAmountShortVideo, 'Fun & Enjoy amount');
    if (!shortVideo.ok) return shortVideo;

    return {
      ok: true,
      fields: {
        couponEligible: true,
        couponWallet: 'both',
        couponAmount: null,
        couponAmountEcart: ecart.amount,
        couponAmountShortVideo: shortVideo.amount,
      },
    };
  }

  const single = parseAmount(body.couponAmount, 'coupon amount');
  if (!single.ok) return single;

  return {
    ok: true,
    fields: {
      couponEligible: true,
      couponWallet: wallet,
      couponAmount: single.amount,
      couponAmountEcart: null,
      couponAmountShortVideo: null,
    },
  };
}

function couponItemSnapshot(product) {
  const wallet = product?.couponWallet;

  if (product?.couponEligible === true && wallet === 'both') {
    const ecart = Number(product?.couponAmountEcart);
    const shortVideo = Number(product?.couponAmountShortVideo);
    const ok =
      Number.isFinite(ecart)
      && ecart > 0
      && ecart <= MAX_AMOUNT
      && Number.isFinite(shortVideo)
      && shortVideo > 0
      && shortVideo <= MAX_AMOUNT;
    if (!ok) return { couponEligible: false };
    return {
      couponEligible: true,
      couponWallet: 'both',
      couponAmountEcart: Math.round(ecart * 100) / 100,
      couponAmountShortVideo: Math.round(shortVideo * 100) / 100,
    };
  }

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

/** Fields to $unset when clearing or switching coupon modes. */
function couponUnsetForFields(fields) {
  if (!fields) return null;
  if (!fields.couponEligible) {
    return {
      couponWallet: 1,
      couponAmount: 1,
      couponAmountEcart: 1,
      couponAmountShortVideo: 1,
    };
  }
  if (fields.couponWallet === 'both') {
    return { couponAmount: 1 };
  }
  return { couponAmountEcart: 1, couponAmountShortVideo: 1 };
}

/** $set payload from parseCouponConfig fields (eligible case). */
function couponSetFromFields(fields) {
  if (!fields || !fields.couponEligible) {
    return { couponEligible: false };
  }
  if (fields.couponWallet === 'both') {
    return {
      couponEligible: true,
      couponWallet: 'both',
      couponAmountEcart: fields.couponAmountEcart,
      couponAmountShortVideo: fields.couponAmountShortVideo,
    };
  }
  return {
    couponEligible: true,
    couponWallet: fields.couponWallet,
    couponAmount: fields.couponAmount,
  };
}

module.exports = {
  parseCouponConfig,
  couponItemSnapshot,
  couponUnsetForFields,
  couponSetFromFields,
  WALLETS,
  WALLET_MODES,
  MAX_AMOUNT,
};
