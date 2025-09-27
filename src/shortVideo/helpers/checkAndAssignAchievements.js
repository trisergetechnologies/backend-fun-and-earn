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
 * Keeps the same logic as before: depth 1 = direct referrals, depth 2 = referrals of direct referrals, etc.
 * Returns the number of active users (users with a package) exactly at that depth.
 *
 * NOTE: this performs repeated DB queries and can be expensive for high traffic; acceptable for now.
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
          package: { $ne: null } // only active users count
        }).select('_id referralCode package').lean();
      }

      currentLevelUsers = nextLevelUsers;
    }

    return Array.isArray(currentLevelUsers) ? currentLevelUsers.length : 0;
  } catch (err) {
    console.error('Error in countActiveMembersAtDepth:', err);
    return 0;
  }
}

/**
 * Check and assign achievements for all uplines of a new buyer.
 *
 * Behavior:
 * - Traverse up to 10 upline levels using referralCode stored in referredBy.
 * - For each upline that has a package, compute counts for each achievement depth (1..10).
 * - For every achievement level where the counted active members >= threshold, ensure a Achievement document exists.
 * - Uses upsert with $setOnInsert to create the Achievement only if missing.
 * - Handles duplicate-key (11000) gracefully (possible during concurrent runs).
 *
 * Input: newBuyer is expected to be a mongoose user doc (or a plain object with at least { referredBy })
 */
async function checkAndAssignAchievements(newBuyer) {
  try {
    if (!newBuyer || !newBuyer.referredBy) return;

    let currentReferral = newBuyer.referredBy;
    let levelUp = 0;
    const visited = new Set(); // avoid circular referrals

    // Walk up to 10 uplines
    while (currentReferral && levelUp < 10) {
      if (visited.has(currentReferral)) {
        console.warn(`⚠️ Circular referral detected for referralCode=${currentReferral}. Stopping traversal.`);
        break;
      }
      visited.add(currentReferral);

      // find upline (we need referralCode, referredBy and package presence)
      const upline = await User.findOne({ referralCode: currentReferral })
        .select('_id referralCode package referredBy')
        .lean();

      if (!upline) {
        // upline not found: stop traversing
        console.warn(`⚠️ Upline not found for referralCode=${currentReferral}`);
        break;
      }

      // Move pointer up for next iteration BEFORE possible continue/break so chain advances
      currentReferral = upline.referredBy;
      levelUp++;

      // If upline has no package (inactive), skip awarding achievements for them but continue up chain
      if (!upline.package) {
        continue;
      }

      // For each achievement level (1..10), compute count at that depth for this upline,
      // and create a Achievement if threshold is met and the doc doesn't exist yet.
      // Iterate levels in numeric order: low->high.
      const keys = Object.keys(ACHIEVEMENTS).map(k => Number(k)).sort((a, b) => a - b);

      for (const achLevel of keys) {
        const { title, threshold } = ACHIEVEMENTS[achLevel];

        try {
          const count = await countActiveMembersAtDepth(upline, achLevel);

          if (count >= threshold) {
            // Attempt to create the achievement only if it doesn't exist.
            // Use upsert with $setOnInsert to set title and achievedAt on insert only.
            // This avoids overwriting the original achievedAt if already present.
            await Achievement.findOneAndUpdate(
              { userId: upline._id, level: achLevel },
              {
                $setOnInsert: {
                  title,
                  achievedAt: new Date()
                }
              },
              { upsert: true, new: true }
            ).exec();

            console.log(`🎉 Achievement ensured: user=${String(upline._id)}, level=${achLevel}, title="${title}"`);
          }
        } catch (err) {
          // catch unique-constraint race (duplicate key) and ignore it; log others
          if (err && err.code === 11000) {
            // Duplicate key — another process inserted the same achievement concurrently. OK to ignore.
            console.warn(`🔁 Duplicate achievement insert race ignored for user=${String(upline._id)}, level=${achLevel}`);
          } else {
            console.error(`Error while awarding achievement level ${achLevel} to user ${String(upline._id)}:`, err);
          }
        }
      }
    }
  } catch (err) {
    console.error('Error in checkAndAssignAchievements:', err);
  }
}

module.exports = { checkAndAssignAchievements };