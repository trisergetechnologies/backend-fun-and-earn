'use strict';

const WEEKLY_MIN_NEW_USERS = { 1: 1, 2: 3, 3: 5 };
const MONTHLY_MIN_NEW_USERS = { 1: 2, 2: 6, 3: 10 };

function isEligibilityCheckSkipped() {
  return process.env.REWARD_PAYOUT_SKIP_ELIGIBILITY_CHECK === 'true';
}

function getMinNewUsers(poolType, achievementLevel) {
  const map =
    poolType === 'monthly' ? MONTHLY_MIN_NEW_USERS : WEEKLY_MIN_NEW_USERS;
  return map[achievementLevel] ?? null;
}

module.exports = {
  WEEKLY_MIN_NEW_USERS,
  MONTHLY_MIN_NEW_USERS,
  isEligibilityCheckSkipped,
  getMinNewUsers,
};
