const User = require("../../../models/User");

// Helper function to build the referral tree
async function buildReferralTree(userId) {
  // Find all users who were referred by this user
  const referredUsers = await User.find({ referredBy: userId });

  // Base case: If no referred users, return an empty array
  if (referredUsers.length === 0) {
    return [];
  }

  // Create an array to store the tree for the current user and their referrals
  const tree = [];

  // For each referred user, build their referral tree recursively
  for (const user of referredUsers) {
    const childTree = await buildReferralTree(user._id);  // Recursively find the next level of referrals
    tree.push({
      user: {
        name: user.name,  // You can include more user fields here if needed
        email: user.email,
        phone: user.phone,
      },
      referrals: childTree  // Recursively add the referrals of this user
    });
  }

  return tree;
}



// Controller function to get the referral tree of a given user
exports.getTeam = async (req, res) => {
  try {
    const userId = req.user._id;

    // Fetch the root user by ID to start the tree-building process
    const rootUser = await User.findById(userId);
    
    if (!rootUser) {
      return res.status(200).json({
        success: false,
        message: 'User not found',
        data: null
      });
    }

    // Build the referral tree starting from this user
    const referralTree = await buildReferralTree(userId);

    // Send the tree back as the response
    return res.status(200).json({
      success: true,
      message: 'Referral tree fetched successfully',
      data: referralTree
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while fetching the referral tree',
      data: null
    });
  }
};
