const mongoose = require('mongoose');
const User = require('../../../models/User');
const Package = require('../../../models/Package');
const { distributeTeamPurchaseEarnings } = require('../../helpers/distributeTeamPurchaseEarnings');
const { distributeNetworkPurchaseEarnings } = require('../../helpers/distributeNetworkPurchaseEarnings');
const WalletTransaction = require('../../../models/WalletTransaction');

exports.purchasePackage = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const userId = req.user._id;
    const { packageId } = req.body;

    const user = await User.findById(userId).session(session);
    if (!user) throw new Error('User not found');

    if (!user.wallets.shortVideoWallet || user.wallets.shortVideoWallet <= 0) {
      throw new Error('Insufficient balance');
    }

    // Check if user already has a package
    if (user.package) {
      await session.abortTransaction();
      return res.status(200).json({ success: false, message: 'Package already purchased' });
    }

    const selectedPackage = await Package.findById(packageId).session(session);
    if (!selectedPackage || !selectedPackage.isActive) {
      await session.abortTransaction();
      return res.status(200).json({ success: false, message: 'Invalid or inactive package' });
    }

    if (user.wallets.shortVideoWallet < selectedPackage.price) {
      await session.abortTransaction();
      return res.status(200).json({ success: false, message: 'Insufficient wallet balance' });
    }

    // Assign serial number
    const lastUserWithSerial = await User.findOne({ serialNumber: { $ne: null } })
      .sort({ serialNumber: -1 })
      .select('serialNumber')
      .session(session);

    const nextSerial = lastUserWithSerial ? lastUserWithSerial.serialNumber + 1 : 1;

    // Deduct amount
    user.wallets.shortVideoWallet -= selectedPackage.price;

    // Assign package and serial
    user.package = selectedPackage._id;
    user.serialNumber = nextSerial;

    // Save user
    await user.save({ session });

    // Log wallet transaction
    await new WalletTransaction({
      userId: user._id,
      type: 'spend',
      source: 'purchase',
      fromWallet: 'shortVideoWallet',
      amount: selectedPackage.price,
      status: 'success',
      triggeredBy: 'user',
      notes: `Purchased ${selectedPackage.name} package`
    }).save({ session });

    // Trigger earnings (non-blocking after commit)
    await session.commitTransaction();
    session.endSession();

    // Now run team and network earnings
    await distributeTeamPurchaseEarnings(user._id, selectedPackage.price);
    await distributeNetworkPurchaseEarnings(user);

    return res.status(200).json({
      success: true,
      message: `${selectedPackage.name} package purchased successfully`,
      data: {
        serialNumber: nextSerial,
        package: selectedPackage.name,
        balance: user.wallets.shortVideoWallet
      }
    });

  } catch (err) {
    console.error('Purchase Package Error:', err);
    await session.abortTransaction();
    session.endSession();

    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to purchase package'
    });
  }
};


exports.getPackages = async (req, res) => {
  try {
    const packages = await Package.find({ isActive: true }).sort({ price: 1 });
    res.status(200).json({
      success: true,
      data: packages
    });
  } catch (error) {
    console.error('Error fetching packages:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch packages'
    });
  }
};
