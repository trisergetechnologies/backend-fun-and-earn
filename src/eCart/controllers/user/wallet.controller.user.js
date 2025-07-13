const User = require("../../../models/User");

exports.getWallet = async (req, res) => {
  const userId = req.user._id;

  try {
    const user = await User.findById(userId).select('wallets.eCartWallet');

    if (!user) {
      return res.status(200).json({
        success: false,
        message: 'User not found'
      });
    }

    return res.status(200).json({
      success: true,
      message: 'E-Cart wallet balance fetched',
      data: {
        eCartWallet: user.wallets.eCartWallet,
      }
    });

  } catch (err) {
    console.error('getWallet error:', err.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch wallet data'
    });
  }
};
