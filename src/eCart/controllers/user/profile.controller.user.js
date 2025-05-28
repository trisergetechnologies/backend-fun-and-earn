const User = require('../../../models/User');

exports.getUserProfile = async (req, res) => {
  try {
    const user = req.user;

    // You can populate anything here if needed later (like orders, wallets)
    const userProfile = await User.findById(user._id)
      .select('-password -__v -token');

    return res.status(200).json({
      success: true,
      message: 'User profile fetched successfully',
      data: userProfile
    });

  } catch (err) {
    console.error('Profile View Error:', err);
    return res.status(500).json({
      success: false,
      message: 'Internal Server Error',
      data: null
    });
  }
};
