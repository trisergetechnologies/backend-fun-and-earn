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
    await newUser.populate('package');
    const buyerPackagePrice = newUser.package.price;
    console.log("buyerPackagePrice", buyerPackagePrice);

    for (const user of allUsers) {
      if (!user.package || user._id.equals(newUser._id)) continue;

      const maxRange = user.package.name === 'Diamond' ? 20 : 10;
      const isInRange = Math.abs(user.serialNumber - buyerSerial) <= maxRange;

      if (isInRange) {
        const amount = 0.01 * buyerPackagePrice;
        user.wallets.shortVideoWallet = Number(user.wallets.shortVideoWallet || 0) + amount;
        console.log("ye hai amount, user waller short video", amount, user.wallets.shortVideoWallet);
        await EarningLog.create({
          userId: user._id,
          source: 'networkPurchase',
          fromUser: newUser._id,
          amount,
        });

        await user.save();
      }
    }
  } catch (err) {
    console.error('Error in distributeNetworkPurchaseEarnings:', err);
  }
};
