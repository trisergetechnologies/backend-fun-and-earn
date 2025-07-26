const User = require("../../../models/User");
const Package = require("../../../models/Package");

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
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        referralCode: user.referralCode,
        referredBy: user.referredBy,
        package: user.package
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
          id: rootUser._id,
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



exports.getNetwork = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).populate('package');

    if (!user || !user.package || !user.serialNumber) {
      return res.status(200).json({
        success: false,
        message: "You haven't purchased a package yet",
        data: null,
      });
    }

    const currentSerial = user.serialNumber;
    const reach = user.package.name === 'Diamond' ? 20 : 10;

    const minSerial = currentSerial - reach;
    const maxSerial = currentSerial + reach;

    const nearbyUsers = await User.find({
      serialNumber: { $gte: minSerial, $lte: maxSerial },
      _id: { $ne: user._id },
    })
      .select('name email phone serialNumber referralCode referredBy package')
      .populate('package', 'name price');

    const formatted = nearbyUsers.map((u) => ({
      _id: u._id,
      name: u.name,
      email: u.email,
      phone: u.phone,
      serialNumber: u.serialNumber,
      referralCode: u.referralCode,
      referredBy: u.referredBy || null,
      hasPackage: !!u.package,
      package: u.package?.name || null,
      direction: u.serialNumber < currentSerial ? 'above' : 'below',
    }));

    return res.status(200).json({
      success: true,
      message: 'Network fetched successfully',
      data: {
        you: {
          _id: user._id,
          name: user.name,
          serialNumber: user.serialNumber,
          package: user.package.name,
        },
        network: formatted,
      },
    });
  } catch (err) {
    console.error('Get Network Error:', err);
    return res.status(200).json({
      success: false,
      message: 'Internal server error',
      data: null,
    });
  }
};
