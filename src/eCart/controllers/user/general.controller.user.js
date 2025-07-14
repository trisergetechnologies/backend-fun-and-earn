const User = require("../../../models/User");
const {verifyPassword, hashPassword} = require('../../../utils/bcrypt')

exports.updateProfile = async (req, res) => {
  try {
    const user = req.user;
    const { name, phone } = req.body;

    if (!name && !phone) {
      return res.status(200).json({
        success: false,
        message: 'No update fields provided',
        data: null
      });
    }

    if (name) user.name = name;
    if (phone) user.phone = phone;

    await user.save();

    return res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      data: {
        name: user.name,
        phone: user.phone
      }
    });
  } catch (err) {
    console.error('Update Profile Error:', err);
    return res.status(200).json({ success: false, message: 'Internal Server Error', data: null });
  }
};

exports.addBankDetails = async (req, res) => {
  try {
    const user = req.user;
    const { accountHolderName, accountNumber, ifscCode, upiId } = req.body;

    if (!accountHolderName || !accountNumber || !ifscCode || !upiId) {
      return res.status(200).json({
        success: false,
        message: 'All bank details are required',
        data: null
      });
    }

    // Prevent overwriting if already exists
    if (user.eCartProfile.bankDetails && user.eCartProfile.bankDetails.accountNumber) {
      return res.status(200).json({
        success: false,
        message: 'Bank details already exist. Please update instead.',
        data: null
      });
    }

    user.eCartProfile.bankDetails = { accountHolderName, accountNumber, ifscCode, upiId };
    await user.save();

    return res.status(200).json({
      success: true,
      message: 'Bank details added successfully',
      data: user.eCartProfile.bankDetails
    });
  } catch (err) {
    console.error('Add Bank Error:', err);
    return res.status(200).json({ success: false, message: 'Internal Server Error', data: null });
  }
};


exports.updateBankDetails = async (req, res) => {
  try {
    const user = req.user;
    const { accountHolderName, accountNumber, ifscCode, upiId } = req.body;

    if (!accountHolderName && !accountNumber && !ifscCode && !upiId) {
      return res.status(200).json({
        success: false,
        message: 'No fields provided to update',
        data: null
      });
    }

    const bank = user.eCartProfile.bankDetails || {};

    if (accountHolderName) bank.accountHolderName = accountHolderName;
    if (accountNumber) bank.accountNumber = accountNumber;
    if (ifscCode) bank.ifscCode = ifscCode;
    if (upiId) bank.upiId = upiId;

    user.eCartProfile.bankDetails = bank;
    await user.save();

    return res.status(200).json({
      success: true,
      message: 'Bank details updated successfully',
      data: user.eCartProfile.bankDetails
    });
  } catch (err) {
    console.error('Update Bank Error:', err);
    return res.status(200).json({ success: false, message: 'Internal Server Error', data: null });
  }
};


exports.deleteBankDetails = async (req, res) => {
  try {
    const user = req.user;

    if (!user.eCartProfile.bankDetails || !user.eCartProfile.bankDetails.accountNumber) {
      return res.status(200).json({
        success: false,
        message: 'No bank details found to delete',
        data: null
      });
    }

    user.eCartProfile.bankDetails = {};
    await user.save();

    return res.status(200).json({
      success: true,
      message: 'Bank details deleted successfully',
      data: null
    });
  } catch (err) {
    console.error('Delete Bank Error:', err);
    return res.status(200).json({ success: false, message: 'Internal Server Error', data: null });
  }
};

exports.getRewards = async (req, res) => {
  try {
    const user = req.user;

    await user.populate({
      path: 'wallets.rewardWallet',
      model: 'Coupon',
      match: { isActive: true },
      select: 'code title description isRedeemed value createdAt'
    });

    return res.status(200).json({
      success: true,
      message: 'Reward coupons fetched successfully',
      data: user.wallets.rewardWallet
    });

  } catch (err) {
    console.error('Get Rewards Error:', err);
    return res.status(200).json({ success: false, message: 'Internal Server Error', data: null });
  }
};


exports.changePassword = async (req, res) => {
  try {
    const user = req.user;
    const { oldPassword, newPassword } = req.body;

    if (!oldPassword || !newPassword) {
      return res.status(200).json({
        success: false,
        message: 'Old and new passwords are required',
        data: null
      });
    }

    const isMatch = await verifyPassword(oldPassword, user.password);
    if (!isMatch) {
      return res.status(200).json({
        success: false,
        message: 'Old password is incorrect',
        data: null
      });
    }

    user.password = await hashPassword(newPassword);
    await user.save();

    return res.status(200).json({
      success: true,
      message: 'Password changed successfully',
      data: null
    });

  } catch (err) {
    console.error('Change Password Error:', err);
    return res.status(200).json({ success: false, message: 'Internal Server Error', data: null });
  }
};


exports.getUserProfile = async (req, res) => {
  try {
    const user = req.user;

    return res.status(200).json({
      success: true,
      message: 'User profile fetched successfully',
      data: {
        _id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        eCartProfile: user.eCartProfile,
        shortVideoProfile: user.shortVideoProfile,
        role: user.role,
        applications: user.applications,
        state_address: user.state_address,
        referralCode: user.referralCode,
        referredBy: user.referredBy,
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