const Achievement = require("../../models/Achievement");
const User = require("../../models/User");

const ACHIEVEMENTS = {
  1: { title: "Star Achiever", threshold: 5 },
  2: { title: "Star Winner", threshold: 25 },
  3: { title: "Team Leader", threshold: 109 },
  4: { title: "Senior Team Leader", threshold: 409 },
  5: { title: "Team Manager", threshold: 1509 },
  6: { title: "Senior Team Manager", threshold: 5009 },
  7: { title: "Team Executive Officer", threshold: 20009 },
  8: { title: "Senior Team Executive Officer", threshold: 75009 },
  9: { title: "State Executive Director", threshold: 250009 },
  10: { title: "National Executive Director", threshold: 9999999 }
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
      if (currentLevelUsers.length === 0) break;

      nextLevelUsers = await User.find({
        referredBy: { $in: currentLevelUsers.map(u => u.referralCode).filter(Boolean) },
        package: { $ne: null } // only active
      }).select("_id referralCode package");

      currentLevelUsers = nextLevelUsers;
    }

    return currentLevelUsers.length;
  } catch (err) {
    console.error("Error in countActiveMembersAtDepth:", err);
    return 0;
  }
}

/**
 * Check and assign achievements for all uplines of a new buyer
 */
async function checkAndAssignAchievements(newBuyer) {
  try {
    if (!newBuyer || !newBuyer.referredBy) return;

    let currentReferral = newBuyer.referredBy;
    let levelUp = 0;
    const visited = new Set(); // prevent circular referrals

    while (currentReferral && levelUp < 10) {
      if (visited.has(currentReferral)) {
        console.warn(`⚠️ Circular referral detected at ${currentReferral}, stopping.`);
        break;
      }
      visited.add(currentReferral);

      const upline = await User.findOne({ referralCode: currentReferral })
        .select("_id referralCode package referredBy")
        .lean();

      if (!upline) {
        console.warn(`⚠️ Upline not found for referralCode=${currentReferral}`);
        break;
      }

      if (!upline.package) {
        // Skip inactive uplines, but still move further up
        currentReferral = upline.referredBy;
        levelUp++;
        continue;
      }

      // Check each achievement level for this upline
      for (const [achLevel, { title, threshold }] of Object.entries(ACHIEVEMENTS)) {
        try {
          const count = await countActiveMembersAtDepth(upline, Number(achLevel));

          if (count >= threshold) {
            // Check existing achievement
            const achievement = await Achievement.findOne({ userId: upline._id });

            if (!achievement || achievement.level < achLevel) {
                await Achievement.findOneAndUpdate(
                    { userId: upline._id },
                    {
                        $max: { level: achLevel },
                        $setOnInsert: { title, achievedAt: new Date() }
                    },
                    { upsert: true, new: true }
                );

              console.log(`🎉 User ${upline._id} unlocked achievement: ${title}`);
            }
          }
        } catch (err) {
          console.error(`Error checking achievement level ${achLevel} for user ${upline._id}:`, err);
        }
      }

      // Move up referral chain
      currentReferral = upline.referredBy;
      levelUp++;
    }
  } catch (err) {
    console.error("Error in checkAndAssignAchievements:", err);
  }
}

module.exports = { checkAndAssignAchievements };
