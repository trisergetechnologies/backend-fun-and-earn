const Coupon = require('../../models/Coupon');
const Order = require('../models/Order');
const User = require('../../models/User');

const WALLETS = ['eCartWallet', 'shortVideoWallet'];

async function uniqueCouponCode() {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const rand = Math.random().toString(36).substring(2, 8).toUpperCase();
    const code = `COUPON-${rand}`;
    const exists = await Coupon.exists({ code });
    if (!exists) return code;
  }
  throw new Error('Could not allocate a coupon code');
}

function resolveCouponCredit(item) {
  const wallet = item.couponWallet;
  const qty = Math.floor(Number(item.quantity) || 0);
  if (qty <= 0) return null;

  if (wallet === 'both') {
    const ecart = Number(item.couponAmountEcart);
    const shortVideo = Number(item.couponAmountShortVideo);
    if (
      !Number.isFinite(ecart) || ecart <= 0
      || !Number.isFinite(shortVideo) || shortVideo <= 0
    ) {
      return null;
    }
    const amountEcart = Math.round(ecart * 100) / 100;
    const amountShort = Math.round(shortVideo * 100) / 100;
    const total = Math.round((amountEcart + amountShort) * 100) / 100;
    return {
      creditWallet: 'both',
      creditSplit: {
        eCartWallet: amountEcart,
        shortVideoWallet: amountShort,
      },
      value: total,
      qty,
    };
  }

  const amount = Number(item.couponAmount);
  if (!WALLETS.includes(wallet) || !Number.isFinite(amount) || amount <= 0) {
    return null;
  }
  return {
    creditWallet: wallet,
    value: Math.round(amount * 100) / 100,
    qty,
  };
}

/**
 * Creates one coupon per unit for eligible order items.
 * Safe to call more than once: issueKey is unique.
 * Never throws to the caller — payment must still succeed if this fails.
 */
async function issueProductCoupons(orderId) {
  if (!orderId) return;
  try {
    const order = await Order.findById(orderId).select('buyerId paymentStatus items').lean();
    if (!order || order.paymentStatus !== 'paid') return;

    const buyer = await User.findById(order.buyerId).select('_id');
    if (!buyer) return;

    for (const item of order.items || []) {
      if (!item.couponEligible) continue;
      const credit = resolveCouponCredit(item);
      if (!credit) continue;

      for (let unitIndex = 0; unitIndex < credit.qty; unitIndex += 1) {
        const issueKey = `${order._id}:${item.productId}:${unitIndex}`;
        let coupon = await Coupon.findOne({ issueKey }).select('_id');
        if (!coupon) {
          try {
            const code = await uniqueCouponCode();
            const doc = {
              code,
              title: `₹${credit.value} Reward Coupon`,
              description: 'Valid once.',
              earnedBy: order.buyerId,
              earnedFromOrder: order._id,
              productId: item.productId,
              unitIndex,
              creditWallet: credit.creditWallet,
              issueKey,
              value: credit.value,
              isActive: true,
              isRedeemed: false,
            };
            if (credit.creditSplit) {
              doc.creditSplit = credit.creditSplit;
            }
            coupon = await Coupon.create(doc);
          } catch (err) {
            if (err && err.code === 11000) {
              coupon = await Coupon.findOne({ issueKey }).select('_id');
            } else {
              throw err;
            }
          }
        }

        if (coupon) {
          await User.updateOne(
            { _id: order.buyerId },
            { $addToSet: { 'wallets.rewardWallet': coupon._id } }
          );
        }
      }
    }
  } catch (err) {
    console.error('[ProductCoupon] issue failed', String(orderId), err.message);
  }
}

module.exports = issueProductCoupons;
