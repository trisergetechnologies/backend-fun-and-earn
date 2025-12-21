const mongoose = require("mongoose");
const Package = require("../models/Package");
const User = require("../models/User");
const { distributeTeamPurchaseEarnings } = require("../shortVideo/helpers/distributeTeamPurchaseEarnings");
const { distributeNetworkPurchaseEarnings } = require("../shortVideo/helpers/distributeNetworkPurchaseEarnings");
const  { captureLeftovers } = require("../shortVideo/helpers/captureLeftovers");
const { checkAndAssignAchievements } = require('../shortVideo/helpers/checkAndAssignAchievements');
const { checkAndAssignMonthlyAchievements } = require('');

exports.purchasePackageDirect = async (userId, packageId) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  let result = {
        success: false,
        message: 'Buy not Successful'
    }

  try {

    const user = await User.findById(userId)
    .session(session)
    .populate('package');
    if (!user) throw new Error('User not found');


    // If same package already purchased
    if (user.package && String(user.package._id) === packageId) {
      await session.abortTransaction();
      return result
    }

    const selectedPackage = await Package.findById(packageId).session(session);
    if (!selectedPackage || !selectedPackage.isActive) {
      await session.abortTransaction();
      return result
    }

    // Assign serial number only if first-time purchase
    let assignedSerial = user.serialNumber;
    if (!assignedSerial) {
      const lastUserWithSerial = await User.findOne({ serialNumber: { $ne: null } })
        .sort({ serialNumber: -1 })
        .select('serialNumber')
        .session(session);

      assignedSerial = lastUserWithSerial ? lastUserWithSerial.serialNumber + 1 : 1;
      user.serialNumber = assignedSerial;
    }

    // Assign package and serial
    user.package = selectedPackage._id;
    
    user.isActive = true;
    // Save user
    await user.save({ session });

    await new PackageOrder({
      buyerId: user._id,
      packageId: selectedPackage._id,

      packageSnapshot: {
        name: selectedPackage.name,
        price: selectedPackage.price,
        membersUpto: selectedPackage.membersUpto,
        description: selectedPackage.description || '',
        color: selectedPackage.color || '',
        icon: selectedPackage.icon || ''
      },

      source: 'user',               // because user initiated purchase
      fromWallet: 'shortVideoWallet', // matches the wallet deducted from
      amount: selectedPackage.price,
      status: 'success',            // since transaction succeeded here
      triggeredBy: 'user',
      notes: `Purchased ${selectedPackage.name} package from dream mart`
    }).save({ session });


    // Trigger earnings (non-blocking after commit)
    await session.commitTransaction();
    session.endSession();


    const result1 = await distributeTeamPurchaseEarnings(user._id, selectedPackage.price);
    await captureLeftovers(result1);

    const result2 = await distributeNetworkPurchaseEarnings(user);
    await captureLeftovers(result2);


    await checkAndAssignAchievements(user);
    await checkAndAssignMonthlyAchievements(user);

    result.success = true;
    result.message = "Buy Successfully"

    return result

  } catch (err) {
    console.error('Purchase Package Error:', err);
    await session.abortTransaction();
    session.endSession();

    return result
  }
};