const { addEcartCouponCredit } = require('./ecartCouponCredit');

/**
 * Credits user wallets from a coupon and returns WalletTransaction docs to create.
 * Mutates user.wallets balances and removes the coupon from rewardWallet.
 * Does not save the user or create transactions — caller does that.
 *
 * @param {object} user
 * @param {object} coupon
 * @param {{ defaultWallet?: 'eCartWallet' | 'shortVideoWallet' }} [options]
 * @returns {{ amount: number, split: boolean, wallet?: string, transactions: object[] }}
 */
function applyCouponCredit(user, coupon, options = {}) {
  const code = coupon.code;
  const couponId = coupon._id.toString();
  const userId = user._id;
  const defaultWallet = options.defaultWallet === 'shortVideoWallet'
    ? 'shortVideoWallet'
    : 'eCartWallet';

  user.wallets.rewardWallet = (user.wallets.rewardWallet || []).filter(
    (id) => id.toString() !== couponId
  );

  if (coupon.creditWallet === 'both') {
    const ecart = Number(coupon.creditSplit?.eCartWallet);
    const shortVideo = Number(coupon.creditSplit?.shortVideoWallet);
    if (
      !Number.isFinite(ecart) || ecart <= 0
      || !Number.isFinite(shortVideo) || shortVideo <= 0
    ) {
      throw new Error('Invalid split coupon amounts');
    }
    const amountEcart = Math.round(ecart * 100) / 100;
    const amountShort = Math.round(shortVideo * 100) / 100;

    user.wallets.eCartWallet = (user.wallets.eCartWallet || 0) + amountEcart;
    addEcartCouponCredit(user, amountEcart);
    user.wallets.shortVideoWallet = (user.wallets.shortVideoWallet || 0) + amountShort;

    const total = Math.round((amountEcart + amountShort) * 100) / 100;
    return {
      amount: total,
      split: true,
      transactions: [
        {
          userId,
          type: 'earn',
          source: 'coupon',
          fromWallet: 'reward',
          toWallet: 'eCartWallet',
          amount: amountEcart,
          status: 'success',
          triggeredBy: 'user',
          notes: `Redeemed coupon: ${code}`,
        },
        {
          userId,
          type: 'earn',
          source: 'coupon',
          fromWallet: 'reward',
          toWallet: 'shortVideoWallet',
          amount: amountShort,
          status: 'success',
          triggeredBy: 'user',
          notes: `Redeemed coupon: ${code}`,
        },
      ],
    };
  }

  const wallet = (coupon.creditWallet === 'eCartWallet' || coupon.creditWallet === 'shortVideoWallet')
    ? coupon.creditWallet
    : defaultWallet;

  user.wallets[wallet] = (user.wallets[wallet] || 0) + coupon.value;
  if (wallet === 'eCartWallet') {
    addEcartCouponCredit(user, coupon.value);
  }

  return {
    amount: coupon.value,
    split: false,
    wallet,
    transactions: [
      {
        userId,
        type: 'earn',
        source: 'coupon',
        fromWallet: 'reward',
        toWallet: wallet,
        amount: coupon.value,
        status: 'success',
        triggeredBy: 'user',
        notes: `Redeemed coupon: ${code}`,
      },
    ],
  };
}

module.exports = applyCouponCredit;
