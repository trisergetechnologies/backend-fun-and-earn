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
    if (!user) {
      return res.status(200).json({
        success: false,
        message: 'Something went wrong. Please try again.',
        data: null
      });
    }

    const wallet = (coupon.creditWallet === 'eCartWallet' || coupon.creditWallet === 'shortVideoWallet')
      ? coupon.creditWallet
      : 'shortVideoWallet';

    user.wallets[wallet] = (user.wallets[wallet] || 0) + coupon.value;

    user.wallets.rewardWallet = user.wallets.rewardWallet.filter(id => id.toString() !== coupon._id.toString());
    await user.save();

    await WalletTransaction.create({
      userId,
      type: 'earn',
      source: 'coupon',
      fromWallet: 'reward',
      toWallet: wallet,
      amount: coupon.value,
      status: 'success',
      triggeredBy: 'user',
      notes: `Redeemed coupon: ${coupon.code}`
    });

    await Coupon.findByIdAndDelete(coupon._id);

    res.status(200).json({
      success: true,
      message: wallet === 'eCartWallet' ? 'Added to your Dream Mart wallet' : 'Added to your wallet',
      data: { amount: coupon.value }
    });
  } catch (err) {
    console.error('Redeem error:', err);
    res.status(500).json({
      success: false,
      message: 'Something went wrong. Please try again.',
      data: null
    });
  }
};