const User = require('../../models/User');
const EarningLog = require('../models/EarningLog');
const Package = require('../../models/Package');

// Team purchase percentages for each level (up to 10)
const TEAM_PURCHASE_PERCENTAGES = [10, 8, 6, 5, 4, 3, 2, 1, 0.5, 0.5]; // total = 50% assumed

exports.distributeTeamPurchaseEarnings = async (userId, packagePrice) => {
  try {
    let currentUser = await User.findById(userId);
    if (!currentUser) return;

    let uplines = [];
    let currentReferral = currentUser.referredBy;

    // Traverse up to 10 levels
    for (let level = 0; level < 10 && currentReferral; level++) {
      const referrer = await User.findOne({ referralCode: currentReferral });
      if (!referrer || !referrer.package) break;

      const percent = TEAM_PURCHASE_PERCENTAGES[level];
      const earningAmount = (percent / 100) * packagePrice;

      referrer.wallets.shortVideoWallet += earningAmount;

      // Log earnings and wallet transaction
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

      currentReferral = referrer.referredBy;
    }
  } catch (err) {
    console.error('Error in distributeTeamPurchaseEarnings:', err);
  }
};
