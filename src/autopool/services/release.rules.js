/**
 * Pool release / occupying rules.
 * Pools 1–12: release at maxCycles (upgrade no longer blocks re-entry).
 * Unconsumed next-pool eligibility is held in Waiting Room.
 * Pool 13: release at maxCycles only (no next pool).
 */

function isPoolReleased(participation) {
  if (!participation) return true;
  if (participation.releasedAt) return true;

  const maxCycles = participation.configSnapshot?.maxCycles ?? 5;
  const cyclesDone = (participation.cycleCount || 0) >= maxCycles;

  // All pools (1–13): cycles complete → released
  return cyclesDone;
}

/**
 * True while the seat still blocks a new entry in that pool.
 * Matches WR-era rules: maxCycles done ⇒ not occupying even if releasedAt stamp missing.
 */
function shouldTreatAsOccupying(participation) {
  if (!participation) return false;
  return !isPoolReleased(participation);
}

function computeReleasedAt(participation, now = new Date()) {
  if (isPoolReleased({ ...participation, releasedAt: null })) {
    return participation.releasedAt || now;
  }
  return null;
}

function shouldReleaseAfterUpgrade(participation, now = new Date()) {
  const maxCycles = participation.configSnapshot?.maxCycles ?? 5;
  const cyclesDone = (participation.cycleCount || 0) >= maxCycles;
  if (cyclesDone) return now;
  return null;
}

/** After final cycle: always release (WR holds unconsumed upgrades). */
function shouldReleaseAfterCycle15(participation, now = new Date()) {
  return now;
}

module.exports = {
  isPoolReleased,
  shouldTreatAsOccupying,
  computeReleasedAt,
  shouldReleaseAfterUpgrade,
  shouldReleaseAfterCycle15,
};
