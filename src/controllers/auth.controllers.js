const Category = require("../eCart/models/Category");
const User = require("../models/User");
const { hashPassword, verifyPassword } = require("../utils/bcrypt");
const { generateToken } = require("../utils/jwt");

// Only user and seller can self-register
const ALLOWED_ROLES = ['user', 'seller'];

exports.register = async (req, res) => {
  try {
    const {
      name,
      email,
      phone,
      password,
      role = 'user',
      referralCode,
      loginApp = 'eCart', // 'eCart' or 'shortVideo'
      state_address // for eCart
    } = req.body;

    if (!ALLOWED_ROLES.includes(role)) {
      return res.status(200).json({ success: false, message: 'Invalid role for registration', data: null });
    }

    // Required field check based on application
    if (!name || !password || !email) {
      return res.status(200).json({ success: false, message: 'Name, email, and password are required', data: null });
    }

    if (loginApp === 'shortVideo' && !referralCode) {
      return res.status(200).json({ success: false, message: 'Referral code is required for Short Video app', data: null });
    }

    if (loginApp === 'eCart' && !state_address) {
      return res.status(200).json({ success: false, message: 'State is required for eCart registration', data: null });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email });

    if (existingUser) {
      if (existingUser.applications.includes(loginApp)) {
        return res.status(200).json({ success: false, message: 'User already registered for this application', data: null });
      } else {
        return res.status(200).json({
          success: false,
          message: `You are already registered with another app. Please activate your account for ${loginApp}`,
          data: null
        });
      }
    }

    // Hash password
    const hashedPassword = await hashPassword(password);
    const generatedReferralCode = await generateReferralCode(name);

    // Create user
    const newUser = new User({
      name,
      email,
      phone,
      password: hashedPassword,
      role,
      applications: [loginApp],
      referredBy: referralCode,
      referralCode: generatedReferralCode,
    });

    if (loginApp === 'eCart' && state_address) {
      newUser.state_address = state_address;
    }

    await newUser.save();

    const token = generateToken({ userId: newUser._id, role: newUser.role });
    newUser.token = token;
    await newUser.save();

    return res.status(200).json({
      success: true,
      message: 'Registration successful',
      data: {
        token,
        user: {
          id: newUser._id,
          name: newUser.name,
          role: newUser.role,
          applications: newUser.applications
        }
      }
    });

  } catch (err) {
    console.error('Register Error:', err);
    return res.status(500).json({ success: false, message: 'Internal Server Error', data: null });
  }
};

// ✅ Referral code generator
async function generateReferralCode(name) {
  let code;
  let exists = true;

  while (exists) {
    const prefix = name.toLowerCase().replace(/\s/g, '').slice(0, 4);
    const random = Math.floor(1000 + Math.random() * 9000);
    code = `${prefix}${random}`;
    exists = await User.findOne({ referralCode: code });
  }

  return code;
}

exports.login = async (req, res) => {
  try {
    const {
      email,
      password,
      loginApp = 'eCart'
    } = req.body;

    if (!email || !password) {
      return res.status(200).json({ success: false, message: 'Email and password are required', data: null });
    }

    const user = await User.findOne({ email });

    if (!user) {
      return res.status(200).json({ success: false, message: 'User not found', data: null });
    }

    const isMatch = await verifyPassword(password, user.password);
    if (!isMatch) {
      return res.status(200).json({ success: false, message: 'Invalid credentials', data: null });
    }

    if(user.role !== 'user') {
      return res.status(200).json({ success: false, message: 'Invalid role for login', data: null });
    }

    if (!user.applications.includes(loginApp)) {
      return res.status(200).json({
        success: false,
        message: `You are registered with another app. Please activate your account for ${loginApp}`,
        data: null
      });
    }

    const token = generateToken({ userId: user._id, role: user.role });
    user.token = token;
    await user.save();

    return res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        token,
        user: {
          id: user._id,
          name: user.name,
          role: user.role,
          applications: user.applications
        }
      }
    });

  } catch (err) {
    console.error('Login Error:', err);
    return res.status(500).json({ success: false, message: 'Internal Server Error', data: null });
  }
};
