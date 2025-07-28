const cron = require('node-cron');
const mongoose = require('mongoose');
const WalletTransaction = require('../models/WalletTransaction');
const User = require('../models/User');

console.log("Scheduler Started")
cron.schedule('0 0 */3 * *', async () => {
  console.log('🔁 Starting wallet transfer job');

  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const eligibleUsers = await User.find({
      applications: { $all: ['shortVideo', 'eCart'] },
      'wallets.shortVideoWallet': { $gt: 0 }
    }).session(session);

    for (const user of eligibleUsers) {
      const transferAmount = user.wallets.shortVideoWallet;

      // Perform the wallet transfer
      user.wallets.eCartWallet += transferAmount;
      user.wallets.shortVideoWallet = 0;
      await user.save({ session });

      // Log the transaction
      const transaction = new WalletTransaction({
        userId: user._id,
        type: 'transfer',
        source: 'manual', 
        fromWallet: 'shortVideoWallet',
        toWallet: 'eCartWallet',
        amount: transferAmount,
        status: 'success',
        triggeredBy: 'system',
        notes: 'Auto transfer from shortVideoWallet to eCartWallet'
      });

      await transaction.save({ session });
    }

    await session.commitTransaction();
    console.log(`✅ Wallets transferred for ${eligibleUsers.length} users.`);

  } catch (error) {
    await session.abortTransaction();
    console.error('❌ Wallet transfer job failed:', error);
  } finally {
    session.endSession();
  }
});
