const User = require("../../models/User");
const MonthlyAchievement = require("../../models/MonthlyAchievement");


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
  10: { title: "F&E Legend", threshold: 2399999 }
};

/**
 * Count active members (users with package) at a given depth for a user
 */
async function countActiveMembersAtDepth(user, depth) {
  if (!user || depth <= 0) return 0;

  let currentLevelUsers = [user];
  let nextLevelUsers = [];

  try {
    for (let i = 0; i < depth; i++) {
      if (!currentLevelUsers || currentLevelUsers.length === 0) break;

      const referralCodes = currentLevelUsers
        .map(u => u.referralCode)
        .filter(Boolean);

      if (referralCodes.length === 0) {
        nextLevelUsers = [];
      } else {
        nextLevelUsers = await User.find({
          referredBy: { $in: referralCodes },
          package: { $ne: null }
        }).select('_id referralCode package').lean();
      }

      currentLevelUsers = nextLevelUsers;
    }

    return Array.isArray(currentLevelUsers) ? currentLevelUsers.length : 0;
  } catch (err) {
    console.error('❌ Error in countActiveMembersAtDepth (Monthly):', err);
    return 0;
  }
}

/**
 * Check and assign MONTHLY achievements
 * - Same logic as weekly
 * - Triggered when a new buyer joins (has referredBy)
 */
async function checkAndAssignMonthlyAchievements(newBuyer) {
  try {
    if (!newBuyer || !newBuyer.referredBy) return;

    let currentReferral = newBuyer.referredBy;
    let levelUp = 0;
    const visited = new Set();

    while (currentReferral && levelUp < 10) {
      if (visited.has(currentReferral)) {
        console.warn(`⚠️ Circular referral detected (monthly) for referralCode=${currentReferral}`);
        break;
      }
      visited.add(currentReferral);

      const upline = await User.findOne({ referralCode: currentReferral })
        .select('_id referralCode package referredBy')
        .lean();

      if (!upline) {
        console.warn(`⚠️ Upline not found (monthly) for referralCode=${currentReferral}`);
        break;
      }

      currentReferral = upline.referredBy;
      levelUp++;

      if (!upline.package) continue;

      const keys = Object.keys(MONTHLY_ACHIEVEMENTS).map(k => Number(k)).sort((a, b) => a - b);

      for (const achLevel of keys) {
        const { title, threshold } = MONTHLY_ACHIEVEMENTS[achLevel];

        try {
          const count = await countActiveMembersAtDepth(upline, achLevel);

          if (count >= threshold) {
            await MonthlyAchievement.findOneAndUpdate(
              { userId: upline._id, level: achLevel },
              {
                $setOnInsert: {
                  title,
                  achievedAt: new Date()
                }
              },
              { upsert: true, new: true }
            ).exec();

            console.log(`🏆 Monthly Achievement: user=${upline._id}, level=${achLevel}, title="${title}"`);
          }
        } catch (err) {
          if (err?.code === 11000) {
            console.warn(`🔁 Duplicate monthly achievement ignored for user=${upline._id}, level=${achLevel}`);
          } else {
            console.error(`❌ Error while awarding monthly achievement level ${achLevel} to user=${upline._id}:`, err);
          }
        }
      }
    }
  } catch (err) {
    console.error('❌ Error in checkAndAssignMonthlyAchievements:', err);
  }
}

module.exports = { checkAndAssignMonthlyAchievements };