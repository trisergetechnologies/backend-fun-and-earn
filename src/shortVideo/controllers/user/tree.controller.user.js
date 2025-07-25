const User = require("../../../models/User");

async function buildReferralTree(referralCode) {
  // Find all users who were referred using this referral code
  const referredUsers = await User.find({ referredBy: referralCode });

  if (referredUsers.length === 0) {
    return [];
  }

  const tree = [];

  for (const user of referredUsers) {
    const childTree = await buildReferralTree(user.referralCode); // recurse using their code
    tree.push({
      user: {
        name: user.name,
        email: user.email,
        phone: user.phone,
        referralCode: user.referralCode,
        referredBy: user.referredBy
      },
      referrals: childTree
    });
  }

  return tree;
}




exports.getTeam = async (req, res) => {
  try {
    const userId = req.user._id;

    const rootUser = await User.findById(userId);

    if (!rootUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
        data: null
      });
    }

    const referralTree = await buildReferralTree(rootUser.referralCode);

    return res.status(200).json({
      success: true,
      message: 'Referral tree fetched successfully',
      data: {
        user: {
          name: rootUser.name,
          email: rootUser.email,
          phone: rootUser.phone,
          referralCode: rootUser.referralCode,
          referredBy: rootUser.referredBy
        },
        referrals: referralTree
      }
    });
  } catch (error) {
    console.error('Error in getTeam:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while fetching the referral tree',
      data: null
    });
  }
};

