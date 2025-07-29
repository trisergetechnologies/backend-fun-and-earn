const Otp = require("../models/Otp");
const User = require("../models/User");
const { hashPassword } = require("../utils/bcrypt");
const nodemailer = require('nodemailer');

// Setup transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER || 'ampdreammart@gmail.com',
    pass: process.env.EMAIL_PASS || 'rvymbfbctghhdlct'
  }
});


exports.sendOtpForReset = async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(200).json({
      success: false,
      message: 'Email is required',
      data: null
    });
  }

  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(200).json({
        success: false,
        message: 'No user found with this email',
        data: null
      });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit

    const mailOptions = {
      from: process.env.EMAIL_USER_TO_SHOW || 'no-reply@mpdreams.in',
      to: email,
      subject: 'Password Reset OTP - Aarush MP',
      text: `Your OTP for password reset is: ${otp}. It will expire in 5 minutes.`
    };

    // Clear any previous OTPs
    await Otp.deleteMany({ email });

    // Save new OTP
    await new Otp({ email, otp }).save();

    // Send email
    await transporter.sendMail(mailOptions);

    return res.status(200).json({
      success: true,
      message: 'OTP sent to your email',
      data: null
    });

  } catch (error) {
    console.error('Error sending reset OTP:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to send OTP',
      data: null
    });
  }
};


exports.resetPassword = async (req, res) => {
  const { email, otp, newPassword } = req.body;

  if (!email || !otp || !newPassword) {
    return res.status(200).json({
      success: false,
      message: 'Email, OTP, and new password are required',
      data: null
    });
  }

  try {
    const validOtp = await Otp.findOne({ email, otp });

    if (!validOtp) {
      return res.status(200).json({
        success: false,
        message: 'Invalid or expired OTP',
        data: null
      });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(200).json({
        success: false,
        message: 'User not found',
        data: null
      });
    }

    // Hash new password
    const hashedPassword = await hashPassword(newPassword);
    user.password = hashedPassword;
    await user.save();

    // Clean up OTPs
    await Otp.deleteMany({ email });

    return res.status(200).json({
      success: true,
      message: 'Password reset successful. You can now login.',
      data: null
    });

  } catch (error) {
    console.error('Password Reset Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to reset password',
      data: null
    });
  }
};
