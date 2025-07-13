const Otp = require("../models/Otp");
const User = require("../models/User");

exports.eCartActivate = async (req, res) => {
    try {
        const user = req.user;
        const { state_address, otp } = req.body;

        // Check if user already activated eCart
        if (user.applications.includes('eCart')) {
            return res.status(200).json({
                success: false,
                message: 'You are already activated for E-Cart',
                data: null
            });
        }

        // Check for required state
        if (!state_address) {
            return res.status(200).json({
                success: false,
                message: 'State is required to activate E-Cart',
                data: null
            });
        }

        // ✅ Verify OTP for eCart
            if (!otp) {
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
            await Otp.deleteMany({ email });
            await Otp.deleteOne({ _id: existingOtp._id });

        user.applications.push('eCart');
        user.state_address = state_address;

        await user.save();

        return res.status(200).json({
            success: true,
            message: 'E-Cart activated successfully',
            data: {
                userId: user._id,
                applications: user.applications
            }
        });

    } catch (err) {
        console.error('E-Cart Activation Error:', err);
        return res.status(200).json({
            success: false,
            message: 'Internal Server Error',
            data: null
        });
    }
};



exports.shortVideoActivate = async (req, res) => {
  try {
    const user = req.user;
    const { referralCode } = req.body;

    // ❌ Already activated?
    if (user.applications.includes('shortVideo')) {
      return res.status(200).json({
        success: false,
        message: 'You are already activated for Short Video',
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

    // ✅ Validate referral code belongs to an active shortVideo user
    const referrer = await User.findOne({ referralCode });

    if (!referrer || !referrer.applications.includes('shortVideo')) {
      return res.status(200).json({
        success: false,
        message: 'Invalid referral code — must belong to a Short Video user',
        data: null
      });
    }

    // ✅ Activate short video for this user
    user.applications.push('shortVideo');
    user.referredBy = referralCode;

    await user.save();

    return res.status(200).json({
      success: true,
      message: 'Short Video activated successfully',
      data: {
        userId: user._id,
        applications: user.applications
      }
    });

  } catch (err) {
    console.error('Short Video Activation Error:', err);
    return res.status(200).json({
      success: false,
      message: 'Internal Server Error',
      data: null
    });
  }
};