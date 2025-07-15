const Coupon = require("../../models/Coupon");
const User = require("../../models/User");


const generateCouponForOrder = async (order) => {
  try {
    // Prevent duplicate coupons for same order
    const existing = await Coupon.findOne({ earnedFromOrder: order._id });
    if (existing) {
      console.log(`[Coupon] Already exists for order ${order._id}`);
      return;
    }

    // Calculate coupon value = 20% of finalAmountPaid
    const rewardValue = Math.round(order.finalAmountPaid * 0.2);

    // Generate a unique code
    let code, exists = true;
    while (exists) {
      const rand = Math.random().toString(36).substring(2, 8).toUpperCase();
      code = `COUPON-${rand}`;
      exists = await Coupon.findOne({ code });
    }

    // Create and save coupon
    const coupon = await Coupon.create({
      code,
      title: `₹${rewardValue} Reward Coupon`,
      earnedBy: order.buyerId,
      earnedFromOrder: order._id,
      value: rewardValue,
      isActive: true,
      isRedeemed: false
    });

    // Push coupon to user's rewardWallet
    await User.findByIdAndUpdate(order.buyerId, {
      $push: { 'wallets.rewardWallet': coupon._id }
    });

  } catch (err) {
    console.error(`[Coupon Error] Failed to create coupon for order ${order._id}:`, err.message);
  }
};

module.exports = generateCouponForOrder;
