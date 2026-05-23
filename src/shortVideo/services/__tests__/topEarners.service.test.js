'use strict';

const { MIN_TOP_EARNER_SERIAL } = require('../topEarners.service');

describe('topEarners.service', () => {
  it('excludes serial numbers 1 through 22', () => {
    expect(MIN_TOP_EARNER_SERIAL).toBe(23);
  });
});
