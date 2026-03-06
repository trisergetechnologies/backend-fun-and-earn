'use strict';

const PACKAGE_DISTRIBUTION_CONFIG = {
  Diamond: { networkRange: 20, teamLevels: 10 },
  Gold:    { networkRange: 10, teamLevels: 5 },
  Starter: { networkRange: 5,  teamLevels: 3 },
  Basic:   { networkRange: 3,  teamLevels: 1 },
};

const DEFAULT_CONFIG = { networkRange: 3, teamLevels: 1 };

function getDistributionConfig(packageName) {
  return PACKAGE_DISTRIBUTION_CONFIG[packageName] || DEFAULT_CONFIG;
}

module.exports = { getDistributionConfig, PACKAGE_DISTRIBUTION_CONFIG };
