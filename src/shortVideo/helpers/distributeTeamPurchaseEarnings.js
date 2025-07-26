const User = require('../../models/User');
const EarningLog = require('../models/EarningLog');
const Package = require('../../models/Package');

const TEAM_PURCHASE_PERCENTAGES = [25, 10, 5, 4, 3, 3, 3, 3, 2, 2]; // Level 1 to 10

exports.distributeTeamPurchaseEarnings = async (userId, packagePrice) => {
  try {
    let currentUser = await User.findById(userId).populate('package');
    if (!currentUser) return;

    let currentReferral = currentUser.referredBy;
    let level = 0;

    // Traverse up to 10 levels
    while (currentReferral && level < 10) {
      const referrer = await User.findOne({ referralCode: currentReferral }).populate('package');
      if (!referrer || !referrer.package) break;

      const maxEarningLevel = referrer.package.name === 'Diamond' ? 10 : 5;

      if (level < maxEarningLevel) {
        const percent = TEAM_PURCHASE_PERCENTAGES[level];
        const earningAmount = +(packagePrice * (percent / 100)).toFixed(2);

        // Add earnings to wallet
        referrer.wallets.shortVideoWallet += earningAmount;

        await Promise.all([
          new EarningLog({
            userId: referrer._id,
            type: 'team',
            source: 'purchase',
            level: level + 1,
            earnedFrom: userId,
            amount: earningAmount
          }).save(),

          referrer.save()
        ]);
      }

      // Move to next level up in referral chain
      currentReferral = referrer.referredBy;
      level++;
    }

  } catch (err) {
    console.error('Error in distributeTeamPurchaseEarnings:', err);
  }
};