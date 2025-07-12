const User = require("../../../models/User");
const mongoose = require('mongoose');

exports.createSeller = async (req, res) => {
  try {
    const admin = req.user;

    const { name, email, phone, password } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({ 
      $or: [{ email }, { phone }] 
    });

    if (existingUser) {
      return res.status(200).json({
        success: false,
        message: 'User with this email or phone already exists',
        data: null
      });
    }

    // Create new seller
    const newSeller = await User.create({
      name,
      email,
      phone,
      password,
      role: 'seller',
      applications: ['eCart'],
      isActive: true
    });

    // Remove sensitive data before sending response
    const sellerData = newSeller.toObject();
    delete sellerData.password;
    delete sellerData.token;

    return res.status(200).json({
      success: true,
      message: 'Seller created successfully',
      data: sellerData
    });

  } catch (err) {
    console.error('Create Seller Error:', err);
    return res.status(500).json({
      success: false,
      message: 'Internal Server Error',
      data: null,
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};




exports.getSellers = async (req, res) => {
  try {
    const admin = req.user;
    const { id } = req.params;


    // Get single seller by ID
    if (id) {
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(200).json({
          success: false,
          message: 'Invalid seller ID',
          data: null
        });
      }

      const seller = await User.findOne(
        { _id: id, role: 'seller' },
        { password: 0, token: 0 }
      );

      if (!seller) {
        return res.status(200).json({
          success: false,
          message: 'Seller not found',
          data: null
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Seller details fetched',
        data: seller
      });
    }

    // Get all sellers
    const sellers = await User.find(
      { role: 'seller' },
      { password: 0, token: 0 }
    ).sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      message: 'All sellers fetched',
      data: sellers
    });

  } catch (err) {
    console.error('Get Sellers Error:', err);
    return res.status(500).json({
      success: false,
      message: 'Internal Server Error',
      data: null
    });
  }
};



exports.updateSeller = async (req, res) => {
  try {
    const admin = req.user;
    const { id } = req.params;


    // Prevent role and sensitive data updates
    if (req.body.role || req.body.password || req.body.token) {
      delete req.body.role;
      delete req.body.password;
      delete req.body.token;
    }

    const updatedSeller = await User.findOneAndUpdate(
      { _id: id, role: 'seller' },
      req.body,
      { new: true, runValidators: true }
    ).select('-password -token');

    if (!updatedSeller) {
      return res.status(200).json({
        success: false,
        message: 'Seller not found',
        data: null
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Seller updated successfully',
      data: updatedSeller
    });

  } catch (err) {
    console.error('Update Seller Error:', err);
    return res.status(500).json({
      success: false,
      message: 'Internal Server Error',
      data: null
    });
  }
};

exports.deleteSeller = async (req, res) => {
  try {
    const admin = req.user;
    const { id } = req.params;

    // Soft delete (set isActive to false)
    const deletedSeller = await User.findOneAndUpdate(
      { _id: id, role: 'seller' },
      { isActive: false },
      { new: true }
    ).select('-password -token');

    if (!deletedSeller) {
      return res.status(200).json({
        success: false,
        message: 'Seller not found',
        data: null
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Seller deactivated successfully',
      data: deletedSeller
    });

  } catch (err) {
    console.error('Delete Seller Error:', err);
    return res.status(500).json({
      success: false,
      message: 'Internal Server Error',
      data: null
    });
  }
};