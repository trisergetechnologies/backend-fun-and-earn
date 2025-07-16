const Category = require("../eCart/models/Category");
const Otp = require("../models/Otp");
const User = require("../models/User");
const { hashPassword, verifyPassword } = require("../utils/bcrypt");
const { generateToken } = require("../utils/jwt");
const nodemailer = require('nodemailer');

// Only user and seller can self-register
const ALLOWED_ROLES = ['user', 'seller'];

exports.register = async (req, res) => {
  try {
    const {
      name,
      email,
      gender,
      phone,
      password,
      role = 'user',
      referralCode,
      otp,
      loginApp = 'eCart', // 'eCart' or 'shortVideo'
      state_address // for eCart
    } = req.body;

    if (!ALLOWED_ROLES.includes(role)) {
      return res.status(200).json({ success: false, message: 'Invalid role for registration', data: null });
    }

    // Required field check based on application
    if (!name || !password || !email || !gender) {
      return res.status(200).json({ success: false, message: 'Name, email, and password are required', data: null });
    }

    if (loginApp === 'shortVideo' && !referralCode) {
      return res.status(200).json({ success: false, message: 'Referral code is required for Short Video app', data: null });
    }

    if (loginApp === 'eCart' && !state_address) {
      return res.status(200).json({ success: false, message: 'State is required for eCart registration', data: null });
    }

    if (loginApp === 'eCart' && !otp) {
      return res.status(200).json({ success: false, message: 'OTP is required for eCart registration', data: null });
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

  // ✅ Verify OTP for eCart
  if (loginApp === 'eCart') {
    if(!otp){
      return res.status(200).json({ success: false, message: 'OTP is required for eCart registration', data: null });
    }
    const existingOtp = await Otp.findOne({ email, otp });
    
    if (!existingOtp) {
      return res.status(200).json({
        success: false,
        message: 'Invalid or expired OTP',
        data: null
      });
    }

    // Optionally delete OTP after successful validation
    await Otp.deleteMany({email});
    await Otp.deleteOne({ _id: existingOtp._id });
  }

    // Hash password
    const hashedPassword = await hashPassword(password);
    const generatedReferralCode = await generateReferralCode(name);

    // Create user
    const newUser = new User({
      name,
      email,
      gender,
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
          email: newUser.email,
          gender: newUser.gender,
          role: newUser.role,
          applications: newUser.applications,
          phone: newUser.phone,
          referralCode: newUser.referralCode,
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

    // if(user.role !== 'user') {
    //   return res.status(200).json({ success: false, message: 'Invalid role for login', data: null });
    // }

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
          email: user.email,
          gender: user.gender,
          role: user.role,
          applications: user.applications,
          phone: user.phone,
          referralCode: user.referralCode,
        }
      }
    });

  } catch (err) {
    console.error('Login Error:', err);
    return res.status(500).json({ success: false, message: 'Internal Server Error', data: null });
  }
};


// Setup transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER || 'sdwivedi856@gmail.com',
    pass: process.env.EMAIL_PASS || 'hjtygmlxiedgvmjt'
  }
});

// Controller function
exports.sendOtp = async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(200).json({
      success: false,
      message: 'Email is required',
      data: null
    });
  }

  const otp = Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit

  const mailOptions = {
    from: process.env.EMAIL_USER || 'sdwivedi856@gmail.com',
    to: email,
    subject: 'Your OTP Code',
    text: `Your OTP is: ${otp}. It will expire in 5 minutes.`
  };

  try {

    // Save new OTP
    const otpDoc = new Otp({ email, otp });
    await otpDoc.save();

    // Send email
    await transporter.sendMail(mailOptions);

    return res.status(200).json({
      success: true,
      message: 'OTP sent successfully',
      data: null
    });

  } catch (error) {
    console.error('Error sending OTP:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to send OTP',
      data: null
    });
  }
};
