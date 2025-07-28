const Coupon = require("../../../models/Coupon");
const User = require("../../../models/User");
const WalletTransaction = require("../../../models/WalletTransaction");

exports.redeemCoupon = async (req, res) => {
  try {
    const { code } = req.body;
    const userId = req.user._id;

    const coupon = await Coupon.findOne({ code, earnedBy: userId, isActive: true, isRedeemed: false });
    if (!coupon) {
      return res.status(200).json({
        success: false,
        message: 'Invalid or already redeemed coupon',
        data: null
      });
    }

    const user = await User.findById(userId);

    // Update wallet
    user.wallets.shortVideoWallet += coupon.value;

    // Remove from rewardWallet
    user.wallets.rewardWallet = user.wallets.rewardWallet.filter(id => id.toString() !== coupon._id.toString());
    await user.save();

    // Record wallet transaction
    await WalletTransaction.create({
      userId,
      type: 'earn',
      source: 'coupon',
      fromWallet: 'reward',
      toWallet: 'shortVideoWallet',
      amount: coupon.value,
      status: 'success',
      triggeredBy: 'user',
      notes: `Redeemed coupon: ${coupon.code}`
    });

    // Remove coupon
    await Coupon.findByIdAndDelete(coupon._id);

    res.status(200).json({
      success: true,
      message: 'Coupon redeemed successfully',
      data: { amount: coupon.value }
    });
  } catch (err) {
    console.error('Redeem error:', err);
    res.status(500).json({
      success: false,
      message: 'Server error',
      data: null
    });
  }
};