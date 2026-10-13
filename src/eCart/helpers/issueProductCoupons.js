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
      const wallet = item.couponWallet;
      const amount = Number(item.couponAmount);
      const qty = Math.floor(Number(item.quantity) || 0);
      if (!WALLETS.includes(wallet) || !Number.isFinite(amount) || amount <= 0 || qty <= 0) {
        continue;
      }

      for (let unitIndex = 0; unitIndex < qty; unitIndex += 1) {
        const issueKey = `${order._id}:${item.productId}:${unitIndex}`;
        let coupon = await Coupon.findOne({ issueKey }).select('_id');
        if (!coupon) {
          try {
            const code = await uniqueCouponCode();
            coupon = await Coupon.create({
              code,
              title: `₹${amount} Reward Coupon`,
              description: 'Valid once.',
              earnedBy: order.buyerId,
              earnedFromOrder: order._id,
              productId: item.productId,
              unitIndex,
              creditWallet: wallet,
              issueKey,
              value: amount,
              isActive: true,
              isRedeemed: false,
            });
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
