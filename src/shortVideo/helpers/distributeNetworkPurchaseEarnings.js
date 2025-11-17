const User = require('../../models/User');
const EarningLog = require('../models/EarningLog');
const Package = require('../../models/Package');

/**
 * Network Purchase Distribution
 * - Only uplines (above buyer) earn
 * - Gold: up to 10 uplines
 * - Diamond: up to 20 uplines
 * - Each eligible gets 1% of package price
 *
 * Returns distribution summary for leftover tracking
 */
exports.distributeNetworkPurchaseEarnings = async (newUser) => {
  try {
    const allUsers = await User.find({ serialNumber: { $ne: null } })
      .select('_id serialNumber package wallets')
      .sort({ serialNumber: 1 })
      .populate('package');

    const buyerSerial = newUser.serialNumber;
    await newUser.populate('package');
    const buyerPackagePrice = newUser.package.price;

    console.log("buyerPackagePrice", buyerPackagePrice);

    let actualDistributed = 0; // ✅ track how much actually given

    for (const user of allUsers) {
      if (!user.package || user._id.equals(newUser._id)) continue;

      const maxRange = user.package.name === 'Diamond' ? 20 : 10;

      // ✅ Only ABOVE (uplines)
      const isInRange =
        user.serialNumber < buyerSerial && 
        (buyerSerial - user.serialNumber) <= maxRange;

      if (isInRange) {
        const amount = +(0.01 * buyerPackagePrice);

        user.wallets.shortVideoWallet = Number(user.wallets.shortVideoWallet || 0) + amount;
        actualDistributed += amount;

        console.log(
          `Credited ₹${amount} to user ${user._id} (SN=${user.serialNumber}) for buyer SN=${buyerSerial}`
        );

        await EarningLog.create({
          userId: user._id,
          source: 'networkPurchase',
          fromUser: newUser._id,
          amount,
        });

        await user.save();
      }
    }

    // ✅ Return distribution metadata for leftovers
    return {
      type: "purchase",
      mode: "network",
      userId: newUser._id,
      amountBase: buyerPackagePrice,
      expectedPercent: 20,   // fixed rule
      actualDistributed
    };

  } catch (err) {
    console.error('Error in distributeNetworkPurchaseEarnings:', err);
    return {
      type: "purchase",
      mode: "network",
      userId: newUser?._id,
      amountBase: newUser?.package?.price || 0,
      expectedPercent: 20,
      actualDistributed: 0,
      error: err.message
    };
  }
};