/**
 * Pool release / occupying rules (locked business spec).
 */

function isPoolReleased(participation) {
  if (!participation) return true;
  if (participation.releasedAt) return true;

  const maxCycles = participation.configSnapshot?.maxCycles ?? 15;
  const cyclesDone = (participation.cycleCount || 0) >= maxCycles;

  if (participation.poolLevel === 10) {
    return cyclesDone;
  }

  // Pools 1–9: 15/15 AND upgrade used
  return cyclesDone && Boolean(participation.upgradeUsedAt);
}

function computeReleasedAt(participation, now = new Date()) {
  if (isPoolReleased({ ...participation, releasedAt: null })) {
    return participation.releasedAt || now;
  }
  return null;
}

function shouldReleaseAfterUpgrade(participation, now = new Date()) {
  const maxCycles = participation.configSnapshot?.maxCycles ?? 15;
  const cyclesDone = (participation.cycleCount || 0) >= maxCycles;
  if (participation.poolLevel === 10) {
    return cyclesDone ? now : null;
  }
  if (cyclesDone && participation.upgradeUsedAt) {
    return now;
  }
  return null;
}

function shouldReleaseAfterCycle15(participation, now = new Date()) {
  if (participation.poolLevel === 10) return now;
  if (participation.upgradeUsedAt) return now;
  return null;
}

module.exports = {
  isPoolReleased,
  computeReleasedAt,
  shouldReleaseAfterUpgrade,
  shouldReleaseAfterCycle15,
};
