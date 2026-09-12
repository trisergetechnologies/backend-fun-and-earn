/**
 * One-shot migration: convert legacy WAITING-parent continuation seats into
 * classic FIFO filler re-entry (child slots).
 *
 * Run AFTER deploying filler-continuation placement code.
 * Uses DB directly (not public/prod HTTP APIs).
 *
 * Usage:
 *   node scripts/migrate-autopool-filler-continuation.js --dry-run
 *   node scripts/migrate-autopool-filler-continuation.js
 *
 * Optional: AUTOPOOL_MIGRATE_POOL_LEVEL=1 to limit to one pool.
 */
const path = require('path');
const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env'), override: true });

const {
  AutopoolPlacement,
  AutopoolParticipation,
} = require('../src/autopool/models');
const { reenterParticipationAsFiller } = require('../src/autopool/services/placement.service');

const dryRun = process.argv.includes('--dry-run');
const poolLevelFilter = process.env.AUTOPOOL_MIGRATE_POOL_LEVEL
  ? Number(process.env.AUTOPOOL_MIGRATE_POOL_LEVEL)
  : null;

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    throw new Error('MONGO_URI required');
  }

  await mongoose.connect(uri);
  console.log('Connected', uri.replace(/\/\/.*@/, '//***@'));
  console.log(dryRun ? 'DRY RUN — no writes' : 'LIVE — will migrate');

  const waitingFilter = {
    status: 'WAITING',
    parentParticipationId: null,
    openSlots: { $gt: 0 },
  };
  if (poolLevelFilter) waitingFilter.poolLevel = poolLevelFilter;

  const waitingRoots = await AutopoolPlacement.find(waitingFilter)
    .sort({ poolLevel: 1, queueSequence: 1 })
    .lean();

  const toMigrate = [];
  for (const w of waitingRoots) {
    const hasCycleDone = await AutopoolPlacement.exists({
      participationId: w.participationId,
      status: 'CYCLE_DONE',
    });
    if (!hasCycleDone) {
      console.log('Skip (no CYCLE_DONE yet — likely true root bootstrap):', String(w._id));
      continue;
    }
    toMigrate.push(w);
  }

  console.log(`Found ${toMigrate.length} WAITING continuation seat(s) to migrate`);

  for (const w of toMigrate) {
    const part = await AutopoolParticipation.findById(w.participationId)
      .select('userId poolLevel cycleCount status')
      .lean();
    console.log({
      waitingId: String(w._id),
      queueSequence: w.queueSequence,
      poolLevel: w.poolLevel,
      participationId: String(w.participationId),
      userId: part ? String(part.userId) : null,
      cycleCount: part?.cycleCount,
    });

    if (dryRun) continue;

    const result = await reenterParticipationAsFiller({
      participationId: w.participationId,
    });
    console.log('  → re-entered placement', String(result?.placement?._id), 'slot', result?.placement?.slot);
  }

  const remaining = await AutopoolPlacement.countDocuments(waitingFilter);
  console.log('Remaining WAITING root open seats:', remaining);
  await mongoose.disconnect();
  console.log('Done');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
