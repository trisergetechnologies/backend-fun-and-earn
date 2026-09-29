/**
 * Cycle distribution math from participation configSnapshot.
 * Amounts are integers that sum to collectionAmount.
 */
function computeCycleDistribution({ participation, cycleNumber }) {
  const snap = participation.configSnapshot;
  const entry = snap.entryAmount;
  const mult = snap.collectionMultiplier ?? 2;
  const collectionAmount = entry * mult;
  const maxCycles = snap.maxCycles ?? 5;
  const poolLevel = participation.poolLevel;

  const pct = (p) => Math.floor((collectionAmount * p) / 100);

  let samePoolAmount = pct(snap.samePoolPercent ?? 50);
  let walletAmount = pct(snap.walletPercent ?? 20);
  let nextPoolAmount = pct(snap.nextPoolPercent ?? 20);
  let adminAmount = pct(snap.adminPercent ?? 5);
  let featureAmount = pct(snap.featurePercent ?? 5);

  const sum0 =
    samePoolAmount + walletAmount + nextPoolAmount + adminAmount + featureAmount;
  if (sum0 !== collectionAmount) {
    featureAmount += collectionAmount - sum0;
  }

  const isFinalCycle = cycleNumber >= maxCycles;
  const isLastPool = poolLevel === 11;
  const nextPoolWindowClosed = cycleNumber > 5; // unused while maxCycles is 5

  // Redirect next-pool share to Feature on the last pool, or after the 5-cycle funding window
  if (isLastPool || nextPoolWindowClosed) {
    featureAmount += nextPoolAmount;
    nextPoolAmount = 0;
  }

  // Final cycle: same-pool continuation → Feature
  if (isFinalCycle) {
    featureAmount += samePoolAmount;
    samePoolAmount = 0;
  }

  return {
    collectionAmount,
    samePoolAmount,
    walletAmount,
    nextPoolAmount,
    adminAmount,
    featureAmount,
    isFinalCycle,
    createsEligibility: !isLastPool && cycleNumber === 5,
  };
}

module.exports = { computeCycleDistribution };
