/**
 * Repair stuck Autopool stays:
 * 1) Stamp releasedAt when cycleCount >= maxCycles but releasedAt is null
 * 2) Enqueue Waiting Room seats for AVAILABLE next-pool eligibility missing WAITING
 *
 *   node scripts/repair-autopool-release-wr.js --dry-run
 *   node scripts/repair-autopool-release-wr.js
 */
const path = require('path');
const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env'), override: true });

const {
  AutopoolParticipation,
  AutopoolNextPoolEligibility,
  AutopoolWaitingRoom,
} = require('../src/autopool/models');
const { computeReleasedAt, isPoolReleased } = require('../src/autopool/services/release.rules');
const { enqueueFromEligibility } = require('../src/autopool/services/waitingRoom.service');

const dryRun = process.argv.includes('--dry-run');

async function stampMissingReleases() {
  const candidates = await AutopoolParticipation.find({ releasedAt: null }).lean();
  let stamped = 0;
  for (const p of candidates) {
    if (!isPoolReleased(p)) continue;
    const releasedAt = computeReleasedAt(p) || p.completedAt || new Date();
    stamped += 1;
    console.log(
      `release ${p._id} pool=${p.poolLevel} cycles=${p.cycleCount}/${p.configSnapshot?.maxCycles ?? 5} → ${releasedAt.toISOString?.() || releasedAt}`
    );
    if (!dryRun) {
      await AutopoolParticipation.updateOne(
        { _id: p._id, releasedAt: null },
        { $set: { releasedAt } }
      );
    }
  }
  return stamped;
}

async function backfillWaitingRoom() {
  const available = await AutopoolNextPoolEligibility.find({ status: 'AVAILABLE' }).lean();
  let enqueued = 0;
  let already = 0;
  for (const elig of available) {
    const existing = await AutopoolWaitingRoom.findOne({
      sourceParticipationId: elig.sourceParticipationId,
      status: 'WAITING',
    }).lean();
    if (existing) {
      already += 1;
      continue;
    }
    console.log(
      `WR enqueue elig=${elig._id} user=${elig.userId} → pool ${elig.targetPoolLevel}`
    );
    if (!dryRun) {
      const res = await enqueueFromEligibility(elig);
      if (res.enqueued) enqueued += 1;
      else if (res.already) already += 1;
    } else {
      enqueued += 1;
    }
  }
  return { enqueued, already, available: available.length };
}

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI required');

  await mongoose.connect(uri);
  console.log('Connected', uri.replace(/\/\/.*@/, '//***@'));
  console.log(dryRun ? 'DRY RUN — no writes' : 'LIVE — will update');

  const stamped = await stampMissingReleases();
  console.log(`Stamped releasedAt: ${stamped}`);

  const wr = await backfillWaitingRoom();
  console.log(
    `WR backfill: available=${wr.available} enqueued=${wr.enqueued} already=${wr.already}`
  );

  await mongoose.disconnect();
  console.log('Done');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
