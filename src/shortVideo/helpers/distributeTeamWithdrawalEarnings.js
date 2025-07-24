const User = require("../../models/User");
const EarningLog = require("../models/EarningLog");
const Package = require('../../models/Package');

// Percentage for withdrawal earnings — similar level-wise logic
const TEAM_WITHDRAWAL_PERCENTAGES = [4, 3, 2.5, 2, 1.5, 1, 0.8, 0.5, 0.4, 0.3]; // % scaled by 0.1 to get actual

exports.distributeTeamWithdrawalEarnings = async (userId, withdrawalAmount) => {
  try {
    let currentUser = await User.findById(userId);
    if (!currentUser) return;

    let currentReferral = currentUser.referredBy;

    for (let level = 0; level < 10 && currentReferral; level++) {
      const referrer = await User.findOne({ referralCode: currentReferral });
      if (!referrer || !referrer.package) break;

      const percent = TEAM_WITHDRAWAL_PERCENTAGES[level] / 100;
      const earning = +(withdrawalAmount * percent).toFixed(2);

      referrer.wallets.shortVideoWallet += earning;

      await Promise.all([
        new EarningLog({
          userId: referrer._id,
          type: 'team',
          source: 'withdrawal',
          level: level + 1,
          earnedFrom: userId,
          amount: earning
        }).save(),



        referrer.save()
      ]);

      currentReferral = referrer.referredBy;
    }
  } catch (err) {
    console.error('Error in distributeTeamWithdrawalEarnings:', err);
  }
};
