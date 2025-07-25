const Package = require('../../models/Package');
const User = require('../../models/User');
const EarningLog = require('../models/EarningLog');

exports.distributeNetworkPurchaseEarnings = async (newUser) => {
  try {
    const allUsers = await User.find({ serialNumber: { $ne: null } })
      .select('_id serialNumber package wallets')
      .sort({ serialNumber: 1 })
      .populate('package');

    const buyerSerial = newUser.serialNumber;
    const buyerPackagePrice = newUser.package.price;

    for (const user of allUsers) {
      if (!user.package) continue;

      const maxRange = user.package.name === 'Diamond' ? 20 : 10;

      if (Math.abs(user.serialNumber - buyerSerial) <= maxRange && user._id.toString() !== newUser._id.toString()) {
        const amount = 0.01 * buyerPackagePrice;

        // user.wallets.shortVideoWallet = (user.wallets.shortVideoWallet || 0) + amount;
        user.wallets.shortVideoWallet = Number(user.wallets.shortVideoWallet || 0) + amount;

        await Promise.all([
          new EarningLog({
            userId: user._id,
            type: 'network',
            source: 'purchase',
            earnedFrom: newUser._id,
            amount,
          }).save(),

          user.save()
        ]);
      }
    }
  } catch (err) {
    console.error('Error in distributeNetworkPurchaseEarnings:', err);
  }
};
