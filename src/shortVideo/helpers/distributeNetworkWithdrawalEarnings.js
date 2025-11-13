const User = require("../../models/User");
const EarningLog = require("../models/EarningLog");
const Package = require('../../models/Package');

/**
 * Network Withdrawal Distribution
 * - Diamond: within 20 above/below
 * - Gold: within 10 above/below
 * - Each eligible gets 0.4% of withdrawalAmount
 *
 * Returns distribution metadata for leftovers.
 */
exports.distributeNetworkWithdrawalEarnings = async (user, withdrawalAmount) => {
  try {
    const allUsers = await User.find({ serialNumber: { $ne: null } })
      .select('_id serialNumber package wallets').populate('package');

    const test = await User.find({ serialNumber: { $ne: null } })
      .select('_id serialNumber package wallets');

    console.log("Package **without populate**", test[0]?.package);

    const currentSN = user.serialNumber;
    let actualDistributed = 0; // ✅ track distribution

    console.log("Package **with populate**", allUsers[0]?.package);

    for (const u of allUsers) {
      if (!u.package) continue;

      const maxRange = u.package.name === 'Diamond' ? 20 : 10;

      const isInRange =
        Math.abs(u.serialNumber - currentSN) <= maxRange &&
        u._id.toString() !== user._id.toString();

      if (isInRange) {
        const earning = +(withdrawalAmount * 0.004).toFixed(2); // 0.4%

        u.wallets.shortVideoWallet += earning;
        actualDistributed += earning;

        await Promise.all([
          new EarningLog({
            userId: u._id,
            type: 'network',
            source: 'networkWithdrawal',
            fromUser: user._id,
            notes: '',
            amount: earning
          }).save(),

          u.save()
        ]);
      }
    }

    // ✅ Return distribution summary for leftover capture
    return {
      type: "withdrawal",
      mode: "network",
      userId: user._id,
      amountBase: withdrawalAmount,
      expectedPercent: 16,    // rule: total 16% max
      actualDistributed
    };

  } catch (err) {
    console.error('Error in distributeNetworkWithdrawalEarnings:', err);
    return {
      type: "withdrawal",
      mode: "network",
      userId: user._id,
      amountBase: withdrawalAmount,
      expectedPercent: 16,
      actualDistributed: 0,
      error: err.message
    };
  }
};