'use strict';

describe('rewardPayoutConfig', () => {
  const originalEnv = process.env.REWARD_PAYOUT_SKIP_ELIGIBILITY_CHECK;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.REWARD_PAYOUT_SKIP_ELIGIBILITY_CHECK;
    } else {
      process.env.REWARD_PAYOUT_SKIP_ELIGIBILITY_CHECK = originalEnv;
    }
    jest.resetModules();
  });

  it('getMinNewUsers returns weekly thresholds for levels 1-3', () => {
    const { getMinNewUsers } = require('../rewardPayoutConfig');
    expect(getMinNewUsers('weekly', 1)).toBe(1);
    expect(getMinNewUsers('weekly', 2)).toBe(3);
    expect(getMinNewUsers('weekly', 3)).toBe(5);
  });

  it('getMinNewUsers returns monthly thresholds for levels 1-3', () => {
    const { getMinNewUsers } = require('../rewardPayoutConfig');
    expect(getMinNewUsers('monthly', 1)).toBe(2);
    expect(getMinNewUsers('monthly', 2)).toBe(6);
    expect(getMinNewUsers('monthly', 3)).toBe(10);
  });

  it('getMinNewUsers returns null for level 4+', () => {
    const { getMinNewUsers } = require('../rewardPayoutConfig');
    expect(getMinNewUsers('weekly', 4)).toBeNull();
    expect(getMinNewUsers('monthly', 10)).toBeNull();
  });

  it('isEligibilityCheckSkipped is true only when env is "true"', () => {
    process.env.REWARD_PAYOUT_SKIP_ELIGIBILITY_CHECK = 'true';
    const { isEligibilityCheckSkipped } = require('../rewardPayoutConfig');
    expect(isEligibilityCheckSkipped()).toBe(true);

    jest.resetModules();
    process.env.REWARD_PAYOUT_SKIP_ELIGIBILITY_CHECK = 'false';
    const mod2 = require('../rewardPayoutConfig');
    expect(mod2.isEligibilityCheckSkipped()).toBe(false);
  });
});
