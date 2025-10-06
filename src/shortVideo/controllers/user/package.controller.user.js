const mongoose = require('mongoose');
const User = require('../../../models/User');
const Package = require('../../../models/Package');
const { distributeTeamPurchaseEarnings } = require('../../helpers/distributeTeamPurchaseEarnings');
const { distributeNetworkPurchaseEarnings } = require('../../helpers/distributeNetworkPurchaseEarnings');
// const WalletTransaction = require('../../../models/WalletTransaction');
const { checkAndAssignAchievements } = require('../../helpers/checkAndAssignAchievements');

const Achievement = require('../../../models/Achievement');
const { captureLeftovers } = require('../../helpers/captureLeftovers');
const PackageOrder = require('../../../models/PackageOrder');
const { checkAndAssignMonthlyAchievements } = require('../../helpers/checkAndAssignMonthlyAchievements');

exports.purchasePackage = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const userId = req.user._id;
    const { packageId } = req.body;

    const user = await User.findById(userId)
    .session(session)
    .populate('package');
    if (!user) throw new Error('User not found');

    if (!user.wallets.shortVideoWallet || user.wallets.shortVideoWallet <= 0) {
      throw new Error('Insufficient balance');
    }

    // If same package already purchased
    if (user.package && String(user.package._id) === packageId) {
      await session.abortTransaction();
      return res.status(200).json({
        success: false,
        message: 'Package already purchased'
      });
    }

    const selectedPackage = await Package.findById(packageId).session(session);
    if (!selectedPackage || !selectedPackage.isActive) {
      await session.abortTransaction();
      return res.status(200).json({ success: false, message: 'Invalid or inactive package' });
    }

    if (user.wallets.shortVideoWallet < selectedPackage.price) {
      await session.abortTransaction();
      return res.status(200).json({ success: false, message: 'Insufficient wallet balance' });
    }

    // Assign serial number only if first-time purchase
    let assignedSerial = user.serialNumber;
    if (!assignedSerial) {
      const lastUserWithSerial = await User.findOne({ serialNumber: { $ne: null } })
        .sort({ serialNumber: -1 })
        .select('serialNumber')
        .session(session);

      assignedSerial = lastUserWithSerial ? lastUserWithSerial.serialNumber + 1 : 1;
      user.serialNumber = assignedSerial;
    }

    // Deduct amount
    user.wallets.shortVideoWallet -= selectedPackage.price;

    // Assign package and serial
    user.package = selectedPackage._id;
    
    user.isActive = true;
    // Save user
    await user.save({ session });

    await new PackageOrder({
      buyerId: user._id,
      packageId: selectedPackage._id,

      packageSnapshot: {
        name: selectedPackage.name,
        price: selectedPackage.price,
        membersUpto: selectedPackage.membersUpto,
        description: selectedPackage.description || '',
        color: selectedPackage.color || '',
        icon: selectedPackage.icon || ''
      },

      source: 'user',               // because user initiated purchase
      fromWallet: 'shortVideoWallet', // matches the wallet deducted from
      amount: selectedPackage.price,
      status: 'success',            // since transaction succeeded here
      triggeredBy: 'user',
      notes: `Purchased ${selectedPackage.name} package`
    }).save({ session });


    // Trigger earnings (non-blocking after commit)
    await session.commitTransaction();
    session.endSession();



    const result1 = await distributeTeamPurchaseEarnings(user._id, selectedPackage.price);
    await captureLeftovers(result1);

    const result2 = await distributeNetworkPurchaseEarnings(user);
    await captureLeftovers(result2);

    await checkAndAssignAchievements(user);
    await checkAndAssignMonthlyAchievements(user);



    return res.status(200).json({
      success: true,
      message: `${selectedPackage.name} package purchased successfully`,
      data: {
        serialNumber: user.serialNumber,
        package: selectedPackage.name,
        balance: user.wallets.shortVideoWallet
      }
    });

  } catch (err) {
    console.error('Purchase Package Error:', err);
    await session.abortTransaction();
    session.endSession();

    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to purchase package'
    });
  }
};


exports.getPackages = async (req, res) => {
  try {
    const userId = req.user?._id; // Assuming you have authentication middleware
    const allPackages = await Package.find({ isActive: true }).sort({ price: 1 });

    let currentPackage = null;
    let availablePackages = [];

    if (userId) {
      const user = await User.findById(userId).populate('package');
      currentPackage = user?.package || null;

      if (!currentPackage) {
        // User hasn't purchased any package
        availablePackages = allPackages;
      } else if (currentPackage.name === 'Gold') {
        // User has Gold, only allow Diamond
        availablePackages = allPackages.filter(pkg => pkg.name === 'Diamond');
      } else if (currentPackage.name === 'Diamond') {
        // User has Diamond, no further upgrade
        availablePackages = [];
      }
    } else {
      // If not logged in, show all active packages (optional)
      availablePackages = allPackages;
    }

    res.status(200).json({
      success: true,
      data: {
        currentPackage,
        availablePackages
      }
    });
  } catch (error) {
    console.error('Error fetching packages:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch packages'
    });
  }
};



const ACHIEVEMENTS = [
  { position: "Star Achiever", threshold: 5 },
  { position: "Star Winner", threshold: 25 },
  { position: "Team Leader", threshold: 109 },
  { position: "Senior Team", threshold: 409 },
  { position: "Team Manager", threshold: 1509 },
  { position: "Senior Team Manager", threshold: 5009 },
  { position: "Team Executive Officer", threshold: 20009 },
  { position: "State Executive Director", threshold: 75009 },
  { position: "National Executive Director", threshold: 9999999 },
];

/**
 * Count active members (users with package) at a given depth for a user
 */
async function countActiveMembersAtDepth(user, depth) {
  if (depth <= 0) return 0;

  let currentLevelUsers = [user];
  let nextLevelUsers = [];

  for (let i = 0; i < depth; i++) {
    nextLevelUsers = await User.find({
      referredBy: { $in: currentLevelUsers.map((u) => u.referralCode) },
      package: { $ne: null }, // only active
    }).select("_id referralCode package");

    currentLevelUsers = nextLevelUsers;
  }

  return currentLevelUsers.length;
}

exports.getMyAchievement = async (req, res) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
        data: null,
      });
    }

    const achievementDoc = await Achievement.findOne({ userId: user._id });

    // Build levels info
    const levels = [];
    let currentPosition = null;
    let unlockedCount = 0;

    for (let i = 0; i < ACHIEVEMENTS.length; i++) {
      const { position, threshold } = ACHIEVEMENTS[i];

      const userCount = await countActiveMembersAtDepth(user, i + 1);
      const achieved = userCount >= threshold;

      if (achieved) {
        unlockedCount++;
        currentPosition = position; // highest achieved becomes current
      }

      levels.push({
        position,
        threshold,
        userCount,
        status: achieved ? "Achieved" : "Locked",
        isCurrent: currentPosition === position,
      });
    }

    const totalActiveMembers = levels.reduce(
      (sum, lvl) => sum + lvl.userCount,
      0
    );

    // Next Level
    const nextLevel = ACHIEVEMENTS.find(
      (lvl) => !levels.find((l) => l.position === lvl.position && l.status === "Achieved")
    );
    let nextLevelData = null;

    if (nextLevel) {
      const match = levels.find((l) => l.position === nextLevel.position);
      const progressPercentage = match
        ? Math.min((match.userCount / nextLevel.threshold) * 100, 100)
        : 0;

      nextLevelData = {
        position: nextLevel.position,
        threshold: nextLevel.threshold,
        userCount: match ? match.userCount : 0,
        progressPercentage: Math.round(progressPercentage),
        needed: nextLevel.threshold - (match ? match.userCount : 0),
      };
    }

    return res.status(200).json({
      success: true,
      message: "Achievements fetched successfully",
      data: {
        achievements: {
          levels,
          currentPosition,
          totalActiveMembers,
          nextLevel: nextLevelData,
          unlockedCount,
          totalLevels: ACHIEVEMENTS.length,
        },
      },
    });
  } catch (err) {
    console.error("GetAchievement Error:", err);
    return res
      .status(500)
      .json({ success: false, message: "Internal Server Error", data: null });
  }
};


const MONTHLY_ACHIEVEMENTS = {
  1: { title: "Ruby Star", threshold: 10 },
  2: { title: "Pearl Star", threshold: 50 },
  3: { title: "Bronze Star", threshold: 250 },
  4: { title: "Silver Star", threshold: 750 },
  5: { title: "Gold Star", threshold: 2500 },
  6: { title: "Platinum Star", threshold: 12500 },
  7: { title: "Diamond Star", threshold: 49999 },
  8: { title: "Master's Star", threshold: 109999 },
  9: { title: "Grand Master's Star", threshold: 499999 },
  10: { title: "F&E Legend", threshold: 2399999 },
};


async function countActiveMembersAtDepthMonthly(user, depth) {
  if (!user || depth <= 0) return 0;

  let currentLevelUsers = [user];
  let nextLevelUsers = [];

  for (let i = 0; i < depth; i++) {
    const referralCodes = currentLevelUsers
      .map((u) => u.referralCode)
      .filter(Boolean);

    if (referralCodes.length === 0) return 0;

    nextLevelUsers = await User.find({
      referredBy: { $in: referralCodes },
      package: { $ne: null },
    }).select("_id referralCode package");

    currentLevelUsers = nextLevelUsers;
  }

  return currentLevelUsers.length;
}

/**
 * 🎖️ Controller: getMyMonthlyAchievement
 * Returns user’s full monthly achievement summary with all levels
 */
exports.getMyMonthlyAchievement = async (req, res) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
        data: null,
      });
    }

    // Fetch latest user with referral details
    const freshUser = await User.findById(user._id).lean();
    if (!freshUser) {
      return res.status(200).json({
        success: false,
        message: "User not found",
        data: null,
      });
    }

    const levels = [];
    let currentPosition = null;
    let unlockedCount = 0;

    // Loop through 1..10 achievement levels
    const keys = Object.keys(MONTHLY_ACHIEVEMENTS)
      .map((k) => Number(k))
      .sort((a, b) => a - b);

    for (const levelKey of keys) {
      const { title, threshold } = MONTHLY_ACHIEVEMENTS[levelKey];
      const userCount = await countActiveMembersAtDepthMonthly(freshUser, levelKey);

      const achieved = userCount >= threshold;

      let status = "Locked";
      if (achieved) {
        unlockedCount++;
        currentPosition = title;
        status = "Achieved";
      }

      levels.push({
        position: title,
        threshold,
        userCount,
        status,
        isCurrent: false, // will mark below
      });
    }

    // Mark the latest achieved as current
    if (currentPosition) {
      const idx = levels.findIndex((l) => l.position === currentPosition);
      if (idx !== -1) levels[idx].isCurrent = true;
      if (levels[idx]) levels[idx].status = "Current";
    }

    // Total active members = count of latest level (or sum)
    const totalActiveMembers = levels.reduce(
      (sum, lvl) => sum + (lvl.userCount || 0),
      0
    );

    // Find next locked level
    const nextLevel = levels.find((lvl) => lvl.status === "Locked");
    let nextLevelData = null;
    if (nextLevel) {
      nextLevelData = {
        position: nextLevel.position,
        threshold: nextLevel.threshold,
        userCount: nextLevel.userCount,
        needed: Math.max(nextLevel.threshold - nextLevel.userCount, 0),
      };
    }

    return res.status(200).json({
      success: true,
      message: "Monthly achievements fetched successfully",
      data: {
        achievements: {
          currentPosition: currentPosition || "No Achievements Yet",
          totalActiveMembers,
          unlockedCount,
          levels,
          nextLevel: nextLevelData,
        },
      },
    });
  } catch (err) {
    console.error("❌ Error in getMyMonthlyAchievement:", err);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      data: null,
    });
  }
};


exports.getPackageOrders = async (req, res) => {
  try {
    const userId = req.user._id; // assuming auth middleware sets req.user

    const orders = await PackageOrder.find({ buyerId: userId })
      .populate('packageId', 'name price') // populate package info only
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      message: '',
      data: orders
    });
  } catch (err) {
    console.error('Get User Package Orders Error:', err);
    return res.status(400).json({
      success: false,
      message: err.message || 'Failed to get package orders',
      data: null
    });
  }
};