const User = require("../../../models/User");
const WalletTransaction = require("../../../models/WalletTransaction");

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
      // Validate that the amount is positive
      if (amount <= 0) {
        return res.status(200).json({
          success: false,
          message: 'Valid amount is required for bulk credit',
          data: null
        });
      }

      // Find all users who meet the watch time threshold
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

      // Start bulk credit process
      const bulkCreditResults = [];

      for (const user of users) {
        // Add amount to user's wallet
        user.wallets.shortVideoWallet += amount;

        // Reset the user's watch time
        user.shortVideoProfile.watchTime = 0;

        // Save user
        await user.save();

        // Log wallet transaction for each user
        const transaction = await new WalletTransaction({
          userId: user._id,
          type: 'earn',
          source: 'watchTime',
          fromWallet: 'system',
          toWallet: 'shortVideoWallet',
          amount,
          status: 'success',
          triggeredBy: 'admin',
          notes: `Credited watch time earnings after 10+ hours`
        }).save();

        bulkCreditResults.push({
          userId: user._id,
          creditedAmount: amount,
          newWalletBalance: user.wallets.shortVideoWallet,
          transactionId: transaction._id
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Bulk earnings credited successfully and watch time reset',
        data: bulkCreditResults
      });
    }

    // If bulk is false, proceed with the single user credit (existing functionality)
    const { userId: singleUserId, amount: singleAmount } = req.body;

    if (!singleUserId || !singleAmount || singleAmount <= 0) {
      return res.status(200).json({
        success: false,
        message: 'UserId and valid amount are required',
        data: null
      });
    }

    // Find user with watch time >= 10 hours
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

    // Add money to wallet
    user.wallets.shortVideoWallet += singleAmount;

    // Reset watch time
    user.shortVideoProfile.watchTime = 0;

    // Save user
    await user.save();

    // Log wallet transaction
    await new WalletTransaction({
      userId: user._id,
      type: 'earn',
      source: 'watchTime',
      fromWallet: 'system',
      toWallet: 'shortVideoWallet',
      amount: singleAmount,
      status: 'success',
      triggeredBy: 'admin',
      notes: `Credited watch time earnings after 10+ hours`
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
      {},
      { $set: { 'shortVideoProfile.watchTime': 0 } }
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
    return res.status(200).json({
      success: false,
      message: 'Internal Server Error',
      data: null
    });
  }
};
