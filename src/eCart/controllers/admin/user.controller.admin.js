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
      );

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