const User = require("../../models/User");
const EarningLog = require("../models/EarningLog");
const Package = require('../../models/Package');

const TEAM_WITHDRAWAL_PERCENTAGES = [5, 2, 1.5, 1.25, 1.10, 1, 0.9, 0.8, 0.7, 0.6];

exports.distributeTeamWithdrawalEarnings = async (userId, withdrawalAmount) => {
  try {
    // Get current user with package populated
    const currentUser = await User.findById(userId).populate('package');
    if (!currentUser) return;

    let currentReferral = currentUser.referredBy;
    let level = 0;

    // Traverse up to 10 levels in referral chain
    while (currentReferral && level < 10) {
      const referrer = await User.findOne({ referralCode: currentReferral }).populate('package');
      if (!referrer || !referrer.package) break;

      const maxEarningLevel = referrer.package.name === 'Diamond' ? 10 : 5;

      if (level < maxEarningLevel) {
        const percent = TEAM_WITHDRAWAL_PERCENTAGES[level];
        const earningAmount = +(withdrawalAmount * (percent / 100)).toFixed(2);

        // Add earnings to wallet
        referrer.wallets.shortVideoWallet += earningAmount;

        // Save earning log and update referrer wallet simultaneously
        await Promise.all([
          new EarningLog({
          userId: referrer._id,
          source: 'teamWithdrawal',
          fromUser: userId,
          amount: earningAmount
          }).save(),

          referrer.save()
        ]);
      }

      // Move up referral chain
      currentReferral = referrer.referredBy;
      level++;
    }
  } catch (err) {
    console.error('Error in distributeTeamWithdrawalEarnings:', err);
  }
};

