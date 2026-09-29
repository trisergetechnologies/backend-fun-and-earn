/**
 * One-shot: cap open participations at 5 cycles.
 * Run once after deploying the 5-cycle / 11-pool code.
 *
 *   node scripts/backfill-autopool-max-cycles.js --dry-run
 *   node scripts/backfill-autopool-max-cycles.js
 */
const path = require('path');
const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env'), override: true });

const { AutopoolParticipation } = require('../src/autopool/models');

const dryRun = process.argv.includes('--dry-run');
const filter = { cycleCount: { $lt: 5 }, 'configSnapshot.maxCycles': { $gt: 5 } };

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    throw new Error('MONGO_URI required');
  }

  await mongoose.connect(uri);
  console.log('Connected', uri.replace(/\/\/.*@/, '//***@'));
  console.log(dryRun ? 'DRY RUN — no writes' : 'LIVE — will update');

  const matched = await AutopoolParticipation.countDocuments(filter);
  console.log(`Matched ${matched} participation(s)`);

  if (!dryRun && matched > 0) {
    const result = await AutopoolParticipation.updateMany(filter, {
      $set: { 'configSnapshot.maxCycles': 5 },
    });
    console.log('Modified', result.modifiedCount);
  }

  await mongoose.disconnect();
  console.log('Done');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
