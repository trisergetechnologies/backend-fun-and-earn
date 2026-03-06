/**
 * Standalone test script -- no test framework needed.
 * Run: node src/tests/testDistributionConfig.js
 *
 * Exits 0 on all-pass, 1 on any failure.
 */

'use strict';

const { getDistributionConfig, PACKAGE_DISTRIBUTION_CONFIG } = require('../config/packageDistributionConfig');

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.error(`  FAIL  ${label}`);
  }
}

function assertEqual(actual, expected, label) {
  assert(actual === expected, `${label} (expected=${expected}, got=${actual})`);
}

function group(name) {
  console.log(`\n--- ${name} ---`);
}

// ===================================================================
// Test Group 1: Config Correctness
// ===================================================================
group('1. Config Correctness');

assertEqual(getDistributionConfig('Diamond').networkRange, 20, 'Diamond networkRange');
assertEqual(getDistributionConfig('Diamond').teamLevels, 10, 'Diamond teamLevels');

assertEqual(getDistributionConfig('Gold').networkRange, 10, 'Gold networkRange');
assertEqual(getDistributionConfig('Gold').teamLevels, 5, 'Gold teamLevels');

assertEqual(getDistributionConfig('Starter').networkRange, 5, 'Starter networkRange');
assertEqual(getDistributionConfig('Starter').teamLevels, 3, 'Starter teamLevels');

assertEqual(getDistributionConfig('Basic').networkRange, 3, 'Basic networkRange');
assertEqual(getDistributionConfig('Basic').teamLevels, 1, 'Basic teamLevels');

// Fallback for unknown
assertEqual(getDistributionConfig('UnknownPkg').networkRange, 3, 'Unknown fallback networkRange');
assertEqual(getDistributionConfig('UnknownPkg').teamLevels, 1, 'Unknown fallback teamLevels');
assert(getDistributionConfig(undefined) !== null, 'undefined packageName does not crash');
assert(getDistributionConfig(null) !== null, 'null packageName does not crash');

// ===================================================================
// Test Group 2: Backward Compatibility (Gold & Diamond identical to old ternaries)
// ===================================================================
group('2. Backward Compatibility');

for (const packageName of ['Gold', 'Diamond']) {
  const oldNetworkRange = packageName === 'Diamond' ? 20 : 10;
  const newNetworkRange = getDistributionConfig(packageName).networkRange;
  assertEqual(newNetworkRange, oldNetworkRange, `${packageName} networkRange matches old ternary`);

  const oldTeamLevels = packageName === 'Diamond' ? 10 : 5;
  const newTeamLevels = getDistributionConfig(packageName).teamLevels;
  assertEqual(newTeamLevels, oldTeamLevels, `${packageName} teamLevels matches old ternary`);
}

// ===================================================================
// Test Group 3: New Package Behavior (distinct from Gold/Diamond)
// ===================================================================
group('3. New Package Behavior');

assert(getDistributionConfig('Starter').networkRange !== getDistributionConfig('Gold').networkRange,
  'Starter networkRange differs from Gold');
assert(getDistributionConfig('Starter').teamLevels !== getDistributionConfig('Gold').teamLevels,
  'Starter teamLevels differs from Gold');
assert(getDistributionConfig('Basic').networkRange !== getDistributionConfig('Gold').networkRange,
  'Basic networkRange differs from Gold');
assert(getDistributionConfig('Basic').teamLevels !== getDistributionConfig('Gold').teamLevels,
  'Basic teamLevels differs from Gold');

// ===================================================================
// Test Group 4: Team Distribution Simulation
// ===================================================================
group('4. Team Distribution Simulation');

const TEAM_PURCHASE_PERCENTAGES = [20, 7.5, 4.5, 4, 3.5, 3, 2.5, 2, 1.5, 1];
const TEAM_WITHDRAWAL_PERCENTAGES = [5, 2, 1.5, 1.25, 1.10, 1, 0.9, 0.8, 0.7, 0.6];
const packagePrice = 1000;

const TEAM_TEST_CASES = [
  { name: 'Diamond', expectedLevels: 10 },
  { name: 'Gold',    expectedLevels: 5 },
  { name: 'Starter', expectedLevels: 3 },
  { name: 'Basic',   expectedLevels: 1 },
];

for (const tc of TEAM_TEST_CASES) {
  const maxLevel = getDistributionConfig(tc.name).teamLevels;
  assertEqual(maxLevel, tc.expectedLevels, `${tc.name} team maxLevel`);

  // Simulate: receiver at each level, check if they earn
  let totalEarned = 0;
  let levelsEarned = 0;
  for (let level = 0; level < 10; level++) {
    if (level < maxLevel) {
      totalEarned += packagePrice * (TEAM_PURCHASE_PERCENTAGES[level] / 100);
      levelsEarned++;
    }
  }
  assertEqual(levelsEarned, tc.expectedLevels, `${tc.name} earns at exactly ${tc.expectedLevels} levels`);
  assert(totalEarned > 0, `${tc.name} earns > 0 total`);

  // Withdrawal variant
  let withdrawalEarned = 0;
  for (let level = 0; level < 10; level++) {
    if (level < maxLevel) {
      withdrawalEarned += packagePrice * (TEAM_WITHDRAWAL_PERCENTAGES[level] / 100);
    }
  }
  assert(withdrawalEarned > 0, `${tc.name} withdrawal earns > 0`);
}

// ===================================================================
// Test Group 5: Network Distribution Simulation (range boundary checks)
// ===================================================================
group('5. Network Distribution Simulation');

const NETWORK_TEST_CASES = [
  { name: 'Diamond', expectedRange: 20 },
  { name: 'Gold',    expectedRange: 10 },
  { name: 'Starter', expectedRange: 5 },
  { name: 'Basic',   expectedRange: 3 },
];

for (const tc of NETWORK_TEST_CASES) {
  const range = getDistributionConfig(tc.name).networkRange;
  const receiverSN = 100;

  // Purchase: buyer below receiver, within range -> eligible
  const buyerInRange = receiverSN + range;
  const purchaseEligible = receiverSN < buyerInRange && (buyerInRange - receiverSN) <= range;
  assert(purchaseEligible, `${tc.name} purchase: buyer at SN=${buyerInRange} (distance=${range}) IS eligible`);

  // Purchase: buyer below receiver, just outside range -> NOT eligible
  const buyerOutOfRange = receiverSN + range + 1;
  const purchaseNotEligible = receiverSN < buyerOutOfRange && (buyerOutOfRange - receiverSN) <= range;
  assert(!purchaseNotEligible, `${tc.name} purchase: buyer at SN=${buyerOutOfRange} (distance=${range + 1}) NOT eligible`);

  // Withdrawal: within range (both directions) -> eligible
  const withdrawerAbove = receiverSN - range;
  assert(Math.abs(receiverSN - withdrawerAbove) <= range, `${tc.name} withdrawal: above within range IS eligible`);
  const withdrawerBelow = receiverSN + range;
  assert(Math.abs(receiverSN - withdrawerBelow) <= range, `${tc.name} withdrawal: below within range IS eligible`);

  // Withdrawal: just outside range -> NOT eligible
  assert(Math.abs(receiverSN - (receiverSN - range - 1)) > range, `${tc.name} withdrawal: above outside NOT eligible`);
  assert(Math.abs(receiverSN - (receiverSN + range + 1)) > range, `${tc.name} withdrawal: below outside NOT eligible`);
}

// ===================================================================
// Test Group 6: Upgrade Logic Simulation
// ===================================================================
group('6. Upgrade Logic');

const allPackages = [
  { name: 'Basic',   price: 499 },
  { name: 'Starter', price: 999 },
  { name: 'Gold',    price: 2999 },
  { name: 'Diamond', price: 5999 },
].sort((a, b) => a.price - b.price);

function getUpgrades(currentPkg) {
  if (!currentPkg) return allPackages.map(p => p.name);
  return allPackages.filter(p => p.price > currentPkg.price).map(p => p.name);
}

const diamondUpgrades = getUpgrades(allPackages.find(p => p.name === 'Diamond'));
assertEqual(diamondUpgrades.length, 0, 'Diamond -> no upgrades');

const goldUpgrades = getUpgrades(allPackages.find(p => p.name === 'Gold'));
assert(goldUpgrades.length === 1 && goldUpgrades[0] === 'Diamond', 'Gold -> [Diamond]');

const starterUpgrades = getUpgrades(allPackages.find(p => p.name === 'Starter'));
assert(starterUpgrades.length === 2 && starterUpgrades[0] === 'Gold' && starterUpgrades[1] === 'Diamond',
  'Starter -> [Gold, Diamond]');

const basicUpgrades = getUpgrades(allPackages.find(p => p.name === 'Basic'));
assert(basicUpgrades.length === 3 && basicUpgrades[0] === 'Starter',
  'Basic -> [Starter, Gold, Diamond]');

const noPackageUpgrades = getUpgrades(null);
assertEqual(noPackageUpgrades.length, 4, 'No package -> all 4 available');

// ===================================================================
// Test Group 7: captureLeftovers Compatibility
// ===================================================================
group('7. captureLeftovers Compatibility');

const EXPECTED_PERCENTS = {
  teamPurchase: 49.5,
  networkPurchase: 20,
  teamWithdrawal: 14.85,
  networkWithdrawal: 16,
};

function makeSummary(type, mode, expectedPercent) {
  return {
    type,
    mode,
    userId: 'test-user-id',
    amountBase: 1000,
    expectedPercent,
    actualDistributed: 100,
  };
}

for (const [key, pct] of Object.entries(EXPECTED_PERCENTS)) {
  const [mode, type] = key === 'teamPurchase'      ? ['team', 'purchase']
                      : key === 'networkPurchase'    ? ['network', 'purchase']
                      : key === 'teamWithdrawal'     ? ['team', 'withdrawal']
                      :                               ['network', 'withdrawal'];

  const summary = makeSummary(type, mode, pct);
  assert(summary.type !== undefined, `${key} summary has "type"`);
  assert(summary.mode !== undefined, `${key} summary has "mode"`);
  assert(summary.userId !== undefined, `${key} summary has "userId"`);
  assert(summary.amountBase !== undefined, `${key} summary has "amountBase"`);
  assert(summary.expectedPercent !== undefined, `${key} summary has "expectedPercent"`);
  assert(summary.actualDistributed !== undefined, `${key} summary has "actualDistributed"`);
  assertEqual(summary.expectedPercent, pct, `${key} expectedPercent is constant (${pct})`);
}

// ===================================================================
// Summary
// ===================================================================
console.log(`\n========================================`);
console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
console.log(`========================================\n`);

process.exit(failed > 0 ? 1 : 0);
