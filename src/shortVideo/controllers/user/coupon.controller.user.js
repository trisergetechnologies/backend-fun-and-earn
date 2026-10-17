const Coupon = require("../../../models/Coupon");
const User = require("../../../models/User");
const WalletTransaction = require("../../../models/WalletTransaction");
const applyCouponCredit = require("../../../helpers/applyCouponCredit");

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

    const credit = applyCouponCredit(user, coupon, { defaultWallet: 'shortVideoWallet' });
    await user.save();
    await WalletTransaction.insertMany(credit.transactions);
    await Coupon.findByIdAndDelete(coupon._id);

    let message = 'Added to your wallet';
    if (credit.split) {
      message = 'Coupon redeemed successfully';
    } else if (credit.wallet === 'eCartWallet') {
      message = 'Added to your Dream Mart wallet';
    }

    res.status(200).json({
      success: true,
      message,
      data: { amount: credit.amount }
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