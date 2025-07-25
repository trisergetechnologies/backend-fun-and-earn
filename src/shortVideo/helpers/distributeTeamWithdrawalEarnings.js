const User = require("../../models/User");
const EarningLog = require("../models/EarningLog");
const Package = require('../../models/Package');

const TEAM_WITHDRAWAL_PERCENTAGES = [8.32, 3.33, 1.66, 1.33, 0.99, 0.99, 0.99, 0.99, 0.66, 0.66];

exports.distributeTeamWithdrawalEarnings = async (userId, withdrawalAmount) => {
  try {
    let currentUser = await User.findById(userId);
    if (!currentUser) return;

    let currentReferral = currentUser.referredBy;
    let level = 0;

    while (currentReferral && level < 10) {
      const referrer = await User.findOne({ referralCode: currentReferral }).populate('package');
      if (!referrer || !referrer.package) break;

      const maxLevel = referrer.package.name === 'Diamond' ? 10 : 5;
      if (level >= maxLevel) break;

      const percent = TEAM_WITHDRAWAL_PERCENTAGES[level] / 100;
      const earningAmount = +(withdrawalAmount * percent).toFixed(2);

      referrer.wallets.shortVideoWallet += earningAmount;

      await Promise.all([
        new EarningLog({
          userId: referrer._id,
          type: 'team',
          source: 'withdrawal',
          level: level + 1,
          earnedFrom: userId,
          amount: earningAmount
        }).save(),

        referrer.save()
      ]);

      currentReferral = referrer.referredBy;
      level++;
    }
  } catch (err) {
    console.error('Error in distributeTeamWithdrawalEarnings:', err);
  }
};
