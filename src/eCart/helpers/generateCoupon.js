const Coupon = require("../../models/Coupon");
const User = require("../../models/User");


const generateCouponForOrder = async (order) => {
  try {
    if (!order || !order._id) {
      console.log(`[Coupon] Invalid order passed`);
      return;
    }

    // Prevent duplicate coupons for same order
    const existing = await Coupon.findOne({ earnedFromOrder: order._id });
    if (existing) {
      console.log(`[Coupon] Already exists for order ${order._id}`);
      return;
    }

    // Use order.totalAmount (cart/order value BEFORE GST). Fallback to finalAmountPaid if missing.
    const baseAmount = typeof order.totalAmount === 'number' && order.totalAmount >= 0
      ? order.totalAmount
      : (typeof order.finalAmountPaid === 'number' ? order.finalAmountPaid : 0);

    // Calculate coupon value = 5% of baseAmount
    const rewardValue = Math.round(baseAmount * 0.05);

    // If rewardValue is zero, skip coupon creation
    if (rewardValue <= 0) {
      console.log(`[Coupon] Reward value is zero for order ${order._id}, skipping coupon creation.`);
      return;
    }

    // Generate a unique code
    let code;
    let exists = true;
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

    console.log(`[Coupon] Created coupon ${code} for order ${order._id}, value ₹${rewardValue}`);
  } catch (err) {
    console.error(`[Coupon Error] Failed to create coupon for order ${order._id}:`, err.message);
  }
};

module.exports = generateCouponForOrder;
