const User = require("../../../models/User");
const mongoose = require('mongoose');

// 1. Get Users (with filters)
exports.getUsers = async (req, res) => {
  try {
    const admin = req.user;
    const { id } = req.params;
    const { appFilter } = req.query; // 'eCart', 'shortVideo', or 'both'

    // Get single user by ID
    if (id) {
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(200).json({
          success: false,
          message: 'Invalid user ID',
          data: null
        });
      }

      const user = await User.findOne(
        { _id: id, role: 'user' },
        { password: 0, token: 0 }
      )
        .populate('shortVideoProfile.videoUploads')
        .populate('eCartProfile.orders')
        .populate('package')
        .populate('wallets.rewardWallet');

      if (!user) {
        return res.status(200).json({
          success: false,
          message: 'User not found',
          data: null
        });
      }

      return res.status(200).json({
        success: true,
        message: 'User details fetched',
        data: user
      });
    }

    // Build filter for all users
    const filter = { role: 'user' };

    // Add application filter if provided
    if (appFilter) {
      switch (appFilter) {
        case 'eCart':
          filter.applications = 'eCart';
          break;
        case 'shortVideo':
          filter.applications = 'shortVideo';
          break;
        case 'both':
          filter.applications = { $all: ['eCart', 'shortVideo'] };
          break;
        default:
          return res.status(200).json({
            success: false,
            message: 'Invalid app filter. Use: eCart, shortVideo, or both',
            data: null
          });
      }
    }

    // Get all users (with optional filter)
    const users = await User.find(filter, { password: 0, token: 0 })
      .populate('shortVideoProfile.videoUploads')
      .populate('eCartProfile.orders')
      .populate('package')
      .populate('wallets.rewardWallet')
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      message: appFilter ? `Users filtered by ${appFilter}` : 'All users fetched',
      data: users
    });

  } catch (err) {
    console.error('Get Users Error:', err);
    return res.status(500).json({
      success: false,
      message: 'Internal Server Error',
      data: null
    });
  }
};


// 2. Update User
exports.updateUser = async (req, res) => {
  try {
    const admin = req.user;
    const { id } = req.params;

    // Prevent role and sensitive data updates
    if (req.body.role || req.body.password || req.body.token) {
      delete req.body.role;
      delete req.body.password;
      delete req.body.token;
    }

    const updatedUser = await User.findOneAndUpdate(
      { _id: id, role: 'user' },
      req.body,
      { new: true, runValidators: true }
    ).select('-password -token');

    if (!updatedUser) {
      return res.status(200).json({
        success: false,
        message: 'User not found',
        data: null
      });
    }

    return res.status(200).json({
      success: true,
      message: 'User updated successfully',
      data: updatedUser
    });

  } catch (err) {
    console.error('Update User Error:', err);
    return res.status(500).json({
      success: false,
      message: 'Internal Server Error',
      data: null
    });
  }
};

// 3. Delete User (Soft Delete)
exports.deleteUser = async (req, res) => {
  try {
    const admin = req.user;
    const { id } = req.params;

    // Soft delete (set isActive to false)
    const deletedUser = await User.findOneAndUpdate(
      { _id: id, role: 'user' },
      { isActive: false },
      { new: true }
    ).select('-password -token');

    if (!deletedUser) {
      return res.status(200).json({
        success: false,
        message: 'User not found',
        data: null
      });
    }

    return res.status(200).json({
      success: true,
      message: 'User deactivated successfully',
      data: deletedUser
    });

  } catch (err) {
    console.error('Delete User Error:', err);
    return res.status(500).json({
      success: false,
      message: 'Internal Server Error',
      data: null
    });
  }
};


exports.getMe = async (req, res) => {
  try {
    const user = req.user;

    return res.status(200).json({
      success: true,
      message: 'User profile fetched successfully',
      data: {
        _id: user._id,
        name: user.name,
        email: user.email,
        gender: user.gender,
        phone: user.phone,
        eCartProfile: user.eCartProfile,
        shortVideoProfile: user.shortVideoProfile,
        role: user.role,
        applications: user.applications,
        state_address: user.state_address,
        referralCode: user.referralCode,
        referredBy: user.referredBy,
        packages: user.package?.name ? user.package : false,
        wallets: user.wallets,
        createdAt: user.createdAt
      }
    });
  } catch (err) {
    console.error('Get User Error:', err);
    return res.status(200).json({
      success: false,
      message: 'Internal Server Error',
      data: null
    });
  }
};



exports.adminShortVideoActivate = async (req, res) => {
  try {
    const admin = req.user; // Optional: check if admin.role === 'admin'
    const { userId, referralCode } = req.body;

    // ❌ Missing userId?
    if (!userId) {
      return res.status(200).json({
        success: false,
        message: 'User ID is required',
        data: null
      });
    }

    // ❌ Missing referral code?
    if (!referralCode) {
      return res.status(200).json({
        success: false,
        message: 'Referral code is required to activate Short Video',
        data: null
      });
    }

    // ✅ Find the target user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(200).json({
        success: false,
        message: 'User not found',
        data: null
      });
    }

    // ❌ Already activated?
    if (user.applications.includes('shortVideo')) {
      return res.status(200).json({
        success: false,
        message: 'User is already activated for Short Video',
        data: null
      });
    }

    // ✅ Validate referral code (must belong to user who already activated Short Video and has a package)
    const referrer = await User.findOne({ referralCode });

    if (!referrer || !referrer.applications.includes('shortVideo') || !referrer.package) {
      return res.status(200).json({
        success: false,
        message: 'Invalid referral code | Not an active referrer!',
        data: null
      });
    }

    // ✅ Activate short video for the user
    user.applications.push('shortVideo');
    user.referredBy = referralCode;

    await user.save();

    return res.status(200).json({
      success: true,
      message: 'Short Video activated successfully for user',
      data: {
        userId: user._id,
        applications: user.applications
      }
    });

  } catch (err) {
    console.error('Admin Short Video Activation Error:', err);
    return res.status(500).json({
      success: false,
      message: 'Internal Server Error',
      data: null
    });
  }
};