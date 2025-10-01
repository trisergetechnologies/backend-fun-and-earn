const User = require("../../../models/User");
const WalletTransaction = require("../../../models/WalletTransaction");
const EarningLog = require("../../models/EarningLog");

// 10 hours = 36000 seconds
const WATCH_TIME_THRESHOLD = 10 * 3600;

exports.getUsersWithWatchTime = async (req, res) => {
  try {
    const { userId } = req.query;

    if (userId) {
      // Find a specific user if they meet the condition
      const user = await User.findOne({
        _id: userId,
        'shortVideoProfile.watchTime': { $gte: WATCH_TIME_THRESHOLD }
      }).select('name email phone shortVideoProfile.watchTime');

      if (!user) {
        return res.status(200).json({
          success: false,
          message: 'User not found or watch time below 10 hours',
          data: null
        });
      }

      return res.status(200).json({
        success: true,
        message: 'User fetched successfully',
        data: user
      });
    }

    // Otherwise → fetch all eligible users
    const users = await User.find({
      'shortVideoProfile.watchTime': { $gte: WATCH_TIME_THRESHOLD }
    }).select('name email phone shortVideoProfile.watchTime');

    return res.status(200).json({
      success: true,
      message: 'Users with watch time >= 10 hours fetched successfully',
      data: users
    });

  } catch (err) {
    console.error('Get Users With WatchTime Error:', err);
    return res.status(200).json({
      success: false,
      message: 'Internal Server Error',
      data: null
    });
  }
};



exports.creditWatchTimeEarnings = async (req, res) => {
  try {
    const { userId, amount, bulk = false } = req.body;

    // If bulk mode is enabled, credit to all users meeting the threshold
    if (bulk) {
      if (amount <= 0) {
        return res.status(200).json({
          success: false,
          message: 'Valid amount is required for bulk credit',
          data: null
        });
      }

      const users = await User.find({
        'shortVideoProfile.watchTime': { $gte: WATCH_TIME_THRESHOLD }
      });

      if (users.length === 0) {
        return res.status(200).json({
          success: false,
          message: 'No users found with the required watch time',
          data: null
        });
      }

      const bulkCreditResults = [];

      for (const user of users) {
        user.wallets.shortVideoWallet += amount;
        user.shortVideoProfile.watchTime = 0;
        await user.save();

        // ✅ Log into EarningLog instead of WalletTransaction
        const log = await new EarningLog({
          userId: user._id,
          amount,
          source: 'watchTime', // ✅ make sure enum updated
          fromUser: user._id,  // self, since watch time is their own effort
          triggeredBy: 'admin',
          notes: `Credited watch time earnings after 10+ hours`,
          status: 'success'
        }).save();

        bulkCreditResults.push({
          userId: user._id,
          creditedAmount: amount,
          newWalletBalance: user.wallets.shortVideoWallet,
          logId: log._id
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Bulk earnings credited successfully and watch time reset',
        data: bulkCreditResults
      });
    }

    // Single user credit
    const { userId: singleUserId, amount: singleAmount } = req.body;

    if (!singleUserId || !singleAmount || singleAmount <= 0) {
      return res.status(200).json({
        success: false,
        message: 'UserId and valid amount are required',
        data: null
      });
    }

    const user = await User.findOne({
      _id: singleUserId,
      'shortVideoProfile.watchTime': { $gte: WATCH_TIME_THRESHOLD }
    });

    if (!user) {
      return res.status(200).json({
        success: false,
        message: 'User not found or watch time below 10 hours',
        data: null
      });
    }

    user.wallets.shortVideoWallet += singleAmount;
    user.shortVideoProfile.watchTime = 0;
    await user.save();

    // ✅ Log into EarningLog instead of WalletTransaction
    await new EarningLog({
      userId: user._id,
      amount: singleAmount,
      source: 'watchTime',
      fromUser: user._id,
      triggeredBy: 'admin',
      notes: `Credited watch time earnings after 10+ hours`,
      status: 'success'
    }).save();

    return res.status(200).json({
      success: true,
      message: 'Earnings credited successfully and watch time reset',
      data: {
        userId: user._id,
        creditedAmount: singleAmount,
        newWalletBalance: user.wallets.shortVideoWallet
      }
    });

  } catch (err) {
    console.error('Credit Watch Time Earnings Error:', err);
    return res.status(200).json({
      success: false,
      message: 'Internal Server Error',
      data: null
    });
  }
};



exports.resetAllWatchTime = async (req, res) => {
  try {
    const result = await User.updateMany(
      {
        applications: 'shortVideo', // matches if array contains 'shortVideo'
        'shortVideoProfile.watchTime': { $exists: true } // only if the field exists
      },
      {
        $set: { 'shortVideoProfile.watchTime': 0 }
      }
    );

    return res.status(200).json({
      success: true,
      message: 'All user watch times reset to 0 successfully',
      data: {
        matchedCount: result.matchedCount,
        modifiedCount: result.modifiedCount
      }
    });

  } catch (err) {
    console.error('Reset Watch Time Error:', err);
    return res.status(500).json({ // changed to 500 for error case
      success: false,
      message: 'Internal Server Error',
      data: null
    });
  }
};


exports.rechargeShortVideoWallet = async (req, res) => {
  try {
    const admin = req.user;

    // Ensure user is an admin
    if (!admin || admin.role !== 'admin') {
      return res.status(200).json({ success: false, message: 'Unauthorized', data: null });
    }

    const { userId, amount } = req.body;

    // Input validation
    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(200).json({ success: false, message: 'Invalid or missing user ID', data: null });
    }

    if (!amount || typeof amount !== 'number' || amount <= 0) {
      return res.status(200).json({ success: false, message: 'Invalid amount', data: null });
    }

    // Find user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(200).json({ success: false, message: 'User not found', data: null });
    }

    // Recharge wallet
    user.wallets.shortVideoWallet += amount;
    await user.save();

    // Log wallet transaction (optional, but recommended)
    await WalletTransaction.create({
      userId: user._id,
      type: 'earn',
      fromWallet: 'shortVideoWallet',
      source: 'admin',
      amount,
      status: 'success',
      triggeredBy: 'admin',
      notes: `Admin recharge by ${admin.name}`
    });

    return res.status(200).json({
      success: true,
      message: `Short video wallet recharged with ₹${amount}`,
      data: {
        userId: user._id,
        name: user.name,
        newBalance: user.wallets.shortVideoWallet
      }
    });

  } catch (err) {
    console.error('Admin Recharge Error:', err);
    return res.status(500).json({ success: false, message: 'Internal Server Error', data: null });
  }
};