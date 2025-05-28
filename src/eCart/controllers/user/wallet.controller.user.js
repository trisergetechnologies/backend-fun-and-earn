const User = require('../../../models/User');
const WithdrawRequest = require('../../../models/WithdrawRequest');

exports.getWallet = async (req, res) => {
  const userId = req.user._id;

  try {
    const user = await User.findById(userId).select('wallets.eCartWallet');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const pendingRequests = await WithdrawRequest.find({
      userId,
      status: 'pending',
      walletType: 'eCartWallet'
    }).select('amount');

    const pendingAmount = pendingRequests.reduce((sum, r) => sum + r.amount, 0);

    return res.status(200).json({
      success: true,
      message: 'E-Cart wallet balance fetched',
      data: {
        eCartWallet: user.wallets.eCartWallet,
        pendingWithdrawals: pendingAmount
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
