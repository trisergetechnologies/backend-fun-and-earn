const User = require("../../../models/User");
const WalletTransaction = require("../../../models/WalletTransaction");

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


exports.getWalletTransactions = async (req, res) => {
  try {
    const userId = req.user._id;

    // Fetch transactions from DB directly, sorted by newest first
    const transactions = await WalletTransaction.find({ userId }).sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: transactions.length,
      data: transactions,
    });

  } catch (error) {
    console.error('Error fetching wallet transactions:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};