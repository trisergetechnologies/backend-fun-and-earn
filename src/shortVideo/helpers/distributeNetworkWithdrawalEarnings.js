const User = require("../../models/User");
const EarningLog = require("../models/EarningLog");
const Package = require('../../models/Package');

exports.distributeNetworkWithdrawalEarnings = async (user, withdrawalAmount) => {
  try {
    const allUsers = await User.find({ serialNumber: { $ne: null } }).select('_id serialNumber package wallets');

    const currentSN = user.serialNumber;

    for (const u of allUsers) {
      if (!u.package) continue;

      const maxRange = u.package.name === 'Diamond' ? 20 : 10;

      if (Math.abs(u.serialNumber - currentSN) <= maxRange && u._id.toString() !== user._id.toString()) {
        const earning = +(withdrawalAmount * 0.004).toFixed(2);

        u.wallets.shortVideoWallet += earning;

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
  } catch (err) {
    console.error('Error in distributeNetworkWithdrawalEarnings:', err);
  }
};
