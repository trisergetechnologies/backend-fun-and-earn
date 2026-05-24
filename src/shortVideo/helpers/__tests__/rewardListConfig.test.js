'use strict';

const {
  MIN_PUBLIC_REWARD_SERIAL,
  isPublicRewardListSerial,
} = require('../rewardListConfig');

describe('rewardListConfig', () => {
  it('MIN_PUBLIC_REWARD_SERIAL is 23', () => {
    expect(MIN_PUBLIC_REWARD_SERIAL).toBe(23);
  });

  it('isPublicRewardListSerial accepts serial >= 23', () => {
    expect(isPublicRewardListSerial(23)).toBe(true);
    expect(isPublicRewardListSerial(100)).toBe(true);
  });

  it('isPublicRewardListSerial rejects serial 1-22 and invalid', () => {
    expect(isPublicRewardListSerial(22)).toBe(false);
    expect(isPublicRewardListSerial(1)).toBe(false);
    expect(isPublicRewardListSerial(null)).toBe(false);
    expect(isPublicRewardListSerial(undefined)).toBe(false);
  });
});
