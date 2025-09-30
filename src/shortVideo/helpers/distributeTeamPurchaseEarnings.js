const User = require('../../models/User');
const EarningLog = require('../models/EarningLog');
const Package = require('../../models/Package');

const TEAM_PURCHASE_PERCENTAGES = [20, 7.5, 4.5, 4, 3.5, 3, 2.5, 2, 1.5, 1];

// exports.distributeTeamPurchaseEarnings = async (userId, packagePrice) => {

//   try {
//     let currentUser = await User.findById(userId).populate('package');
//     if (!currentUser) return;

//     let currentReferral = currentUser.referredBy;
//     let level = 0;

//     // Traverse up to 10 levels
//     while (currentReferral && level < 10) {
//       const referrer = await User.findOne({ referralCode: currentReferral }).populate('package');
//       if (!referrer || !referrer.package) break;

//       const maxEarningLevel = referrer.package.name === 'Diamond' ? 10 : 5;

//       if (level < maxEarningLevel) {
//         const percent = TEAM_PURCHASE_PERCENTAGES[level];
//         const earningAmount = +(packagePrice * (percent / 100)).toFixed(2);

//         // Add earnings to wallet
//         referrer.wallets.shortVideoWallet += earningAmount;

//         await Promise.all([
//           new EarningLog({
//           userId: referrer._id,
//           source: 'teamPurchase',
//           fromUser: userId,
//           amount: earningAmount
//           }).save(),

//           referrer.save()
//         ]);
//       }

//       // Move to next level up in referral chain
//       currentReferral = referrer.referredBy;
//       level++;
//     }

//   } catch (err) {
//     console.error('Error in distributeTeamPurchaseEarnings:', err);
//   }
// };

/**
 * Team Purchase Distribution
 * - Gold: up to 5 levels
 * - Diamond: up to 10 levels
 * - Expected distribution: total 49.5% of package price
 *
 * Returns distribution metadata for leftovers.
 */



exports.distributeTeamPurchaseEarnings = async (userId, packagePrice) => {
  try {
    let currentUser = await User.findById(userId).populate('package');
    if (!currentUser) return;

    let currentReferral = currentUser.referredBy;
    let level = 0;
    let actualDistributed = 0; // ✅ track how much we gave out

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
        actualDistributed += earningAmount; // ✅ accumulate distributed total

        await Promise.all([
          new EarningLog({
            userId: referrer._id,
            source: 'teamPurchase',
            fromUser: userId,
            amount: earningAmount
          }).save(),

          referrer.save()
        ]);
      }

      // Move to next level up in referral chain
      currentReferral = referrer.referredBy;
      level++;
    }

    // ✅ Return distribution summary
    return {
      type: "purchase",
      mode: "team",
      userId,
      amountBase: packagePrice,
      expectedPercent: 49.5,      // rule: max 49.5% total distribution
      actualDistributed
    };

  } catch (err) {
    console.error('Error in distributeTeamPurchaseEarnings:', err);
    return {
      type: "purchase",
      mode: "team",
      userId,
      amountBase: packagePrice,
      expectedPercent: 49.5,
      actualDistributed: 0,
      error: err.message
    };
  }
};