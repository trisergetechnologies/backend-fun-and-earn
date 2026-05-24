'use strict';

/** Serial numbers 1–22 are excluded from public reward lists (top earners, payout-ready). */
const MIN_PUBLIC_REWARD_SERIAL = 23;

function isPublicRewardListSerial(serialNumber) {
  return (
    typeof serialNumber === 'number' &&
    Number.isFinite(serialNumber) &&
    serialNumber >= MIN_PUBLIC_REWARD_SERIAL
  );
}

module.exports = {
  MIN_PUBLIC_REWARD_SERIAL,
  isPublicRewardListSerial,
};
