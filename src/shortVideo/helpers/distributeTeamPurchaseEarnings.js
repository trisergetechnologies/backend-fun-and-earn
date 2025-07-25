const User = require('../../models/User');
const EarningLog = require('../models/EarningLog');
const Package = require('../../models/Package');

const TEAM_PURCHASE_PERCENTAGES = [25, 10, 5, 4, 3, 3, 3, 3, 2, 2];

exports.distributeTeamPurchaseEarnings = async (userId, packagePrice) => {
  try {
    let currentUser = await User.findById(userId).populate('package');
    if (!currentUser) return;

    let currentReferral = currentUser.referredBy;
    let level = 0;

    while (currentReferral && level < 10) {
      const referrer = await User.findOne({ referralCode: currentReferral }).populate('package');
      if (!referrer || !referrer.package) break;

      const maxLevel = referrer.package.name === 'Diamond' ? 10 : 5;
      if (level >= maxLevel) break;

      const percent = TEAM_PURCHASE_PERCENTAGES[level];
      const earningAmount = +(packagePrice * (percent / 100)).toFixed(2);

      referrer.wallets.shortVideoWallet += earningAmount;

      await Promise.all([
        new EarningLog({
          userId: referrer._id,
          source: 'teamPurchase',
          fromUser: userId,
          amount: earningAmount
        }).save(),

        referrer.save()
      ]);

      currentReferral = referrer.referredBy;
      level++;
    }
  } catch (err) {
    console.error('Error in distributeTeamPurchaseEarnings:', err);
  }
};
