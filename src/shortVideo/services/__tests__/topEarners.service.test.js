'use strict';

const { MIN_TOP_EARNER_SERIAL } = require('../topEarners.service');
const { MIN_PUBLIC_REWARD_SERIAL } = require('../../helpers/rewardListConfig');

describe('topEarners.service', () => {
  it('excludes serial numbers 1 through 22', () => {
    expect(MIN_TOP_EARNER_SERIAL).toBe(23);
    expect(MIN_TOP_EARNER_SERIAL).toBe(MIN_PUBLIC_REWARD_SERIAL);
  });
});
