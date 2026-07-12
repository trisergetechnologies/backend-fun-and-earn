const User = require("../../../models/User");
const Product = require("../../models/Product");
const mongoose = require('mongoose');
const { hashPassword } = require("../../../utils/bcrypt");
const { normalizeGstin } = require("../../../utils/gstin");
const { clearAuthTokensOnUser } = require("../../../utils/authTokens");

function parseSellerDetails(body) {
  const raw = body.sellerDetails;
  if (!raw) return body.gstin ? { gstin: body.gstin } : null;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return raw;
}

function validateSellerInput({ name, email, password, phone, sellerDetails }, isCreate) {
  if (!name || !email) {
    return 'Company name and email are required';
  }
  if (isCreate && !password) {
    return 'Password is required';
  }
  if (!phone) {
    return 'Phone is required';
  }
  const details = sellerDetails || {};
  const gstinResult = normalizeGstin(details.gstin);
  if (!gstinResult.ok) {
    return gstinResult.message;
  }
  return null;
}

exports.createSeller = async (req, res) => {
  try {
    const { name, email, phone, password } = req.body;
    const sellerDetails = parseSellerDetails(req.body);

    const validationError = validateSellerInput(
      { name, email, password, phone, sellerDetails },
      true
    );
    if (validationError) {
      return res.status(200).json({
        success: false,
        message: validationError,
        data: null,
      });
    }

    const existingUser = await User.findOne({
      $or: [{ email }, { phone }],
    });

    if (existingUser) {
      return res.status(200).json({
        success: false,
        message: 'User with this email or phone already exists',
        data: null,
      });
    }

    const hashedPassword = await hashPassword(password);
    const gstinResult = normalizeGstin(sellerDetails?.gstin);
    const newSeller = await User.create({
      name,
      email,
      phone,
      gender: 'male',
      password: hashedPassword,
      role: 'seller',
      applications: ['eCart'],
      isActive: true,
      sellerDetails: {
        gstin: gstinResult.ok ? gstinResult.value : '',
        contactPersonName: sellerDetails?.contactPersonName || '',
        street: sellerDetails?.street || '',
        city: sellerDetails?.city || '',
        state: sellerDetails?.state || '',
        pincode: sellerDetails?.pincode || '',
      },
    });

    const sellerData = newSeller.toObject();
    delete sellerData.password;
    delete sellerData.token;

    return res.status(200).json({
      success: true,
      message: 'Seller created successfully',
      data: sellerData,
    });
  } catch (err) {
    console.error('Create Seller Error:', err);
    return res.status(500).json({
      success: false,
      message: 'Internal Server Error',
      data: null,
      error: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  }
};

exports.getSellers = async (req, res) => {
  try {
    const { id } = req.params;
    const { page = 1, limit = 25, search, isActive, dropdown } = req.query;

    if (dropdown === 'true') {
      const sellers = await User.find(
        { role: 'seller', isActive: true },
        { password: 0, token: 0 }
      ).sort({ name: 1 });

      return res.status(200).json({
        success: true,
        message: 'Sellers fetched',
        data: sellers,
      });
    }

    if (id) {
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(200).json({
          success: false,
          message: 'Invalid seller ID',
          data: null,
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
          data: null,
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Seller details fetched',
        data: seller,
      });
    }

    const filter = { role: 'seller' };

    if (isActive === 'true') filter.isActive = true;
    else if (isActive === 'false') filter.isActive = false;

    if (search && typeof search === 'string' && search.trim()) {
      const term = search.trim();
      filter.$or = [
        { name: { $regex: term, $options: 'i' } },
        { email: { $regex: term, $options: 'i' } },
        { phone: { $regex: term, $options: 'i' } },
        { 'sellerDetails.gstin': { $regex: term, $options: 'i' } },
      ];
    }

    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
    const skipNum = (Math.max(1, parseInt(page, 10)) - 1) * limitNum;

    const [sellers, total] = await Promise.all([
      User.find(filter, { password: 0, token: 0 })
        .sort({ createdAt: -1 })
        .skip(skipNum)
        .limit(limitNum),
      User.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      message: 'Sellers fetched',
      data: {
        sellers,
        total,
        totalPages: Math.ceil(total / limitNum) || 1,
        page: Math.max(1, parseInt(page, 10)),
      },
    });
  } catch (err) {
    console.error('Get Sellers Error:', err);
    return res.status(500).json({
      success: false,
      message: 'Internal Server Error',
      data: null,
    });
  }
};

exports.updateSeller = async (req, res) => {
  try {
    const { id } = req.params;

    delete req.body.role;
    delete req.body.password;
    delete req.body.token;
    delete req.body.gender;

    const sellerDetails = parseSellerDetails(req.body);
    if (sellerDetails) {
      const gstinResult = normalizeGstin(sellerDetails.gstin);
      if (!gstinResult.ok) {
        return res.status(200).json({
          success: false,
          message: gstinResult.message,
          data: null,
        });
      }
      sellerDetails.gstin = gstinResult.value;
      req.body.sellerDetails = sellerDetails;
    }
    delete req.body.gstin;

    const updatedSeller = await User.findOneAndUpdate(
      { _id: id, role: 'seller' },
      req.body,
      { new: true, runValidators: true }
    ).select('-password -token');

    if (!updatedSeller) {
      return res.status(200).json({
        success: false,
        message: 'Seller not found',
        data: null,
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Seller updated successfully',
      data: updatedSeller,
    });
  } catch (err) {
    console.error('Update Seller Error:', err);
    return res.status(500).json({
      success: false,
      message: 'Internal Server Error',
      data: null,
    });
  }
};

exports.deleteSeller = async (req, res) => {
  try {
    const { id } = req.params;

    const deletedSeller = await User.findOneAndUpdate(
      { _id: id, role: 'seller' },
      { isActive: false, token: null },
      { new: true }
    ).select('-password -token');

    if (!deletedSeller) {
      return res.status(200).json({
        success: false,
        message: 'Seller not found',
        data: null,
      });
    }

    await Product.updateMany({ sellerId: id }, { isActive: false });

    return res.status(200).json({
      success: true,
      message: 'Seller deactivated successfully',
      data: deletedSeller,
    });
  } catch (err) {
    console.error('Delete Seller Error:', err);
    return res.status(500).json({
      success: false,
      message: 'Internal Server Error',
      data: null,
    });
  }
};

exports.resetSellerPassword = async (req, res) => {
  try {
    const { id } = req.params;
    const { password } = req.body;

    if (!password || password.length < 6) {
      return res.status(200).json({
        success: false,
        message: 'Password must be at least 6 characters',
        data: null,
      });
    }

    const seller = await User.findOne({ _id: id, role: 'seller' });
    if (!seller) {
      return res.status(200).json({
        success: false,
        message: 'Seller not found',
        data: null,
      });
    }

    seller.password = await hashPassword(password);
    clearAuthTokensOnUser(seller);
    await seller.save();

    return res.status(200).json({
      success: true,
      message: 'Seller password reset successfully',
      data: null,
    });
  } catch (err) {
    console.error('Reset Seller Password Error:', err);
    return res.status(500).json({
      success: false,
      message: 'Internal Server Error',
      data: null,
    });
  }
};
