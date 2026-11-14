const CRON_NAME = 'AUTOPOOL_WR_CRON';
console.log(`🔥 [${CRON_NAME}] file loaded at ${new Date().toISOString()}`);

const cron = require('node-cron');
const { AutopoolWaitingRoom } = require('../autopool/models');
const { isAutopoolEnabled } = require('../autopool/services/config.service');
const { executeNextPoolJoin } = require('../autopool/services/joinNext.service');
const { getBalance } = require('../autopool/services/referralCredit.service');
const { findOccupyingParticipation } = require('../autopool/services/entry.service');

const SKIPPABLE = new Set([
  'TARGET_OCCUPYING',
  'NO_UPGRADE_CREDIT',
  'NO_ELIGIBILITY',
  'WR_SEAT_GONE',
  'AUTOPOOL_DISABLED',
]);

async function processWaitingRoomBatch({ limit = 50 } = {}) {
  if (!(await isAutopoolEnabled())) {
    return { processed: 0, joined: 0, skipped: 0, reason: 'disabled' };
  }

  const seats = await AutopoolWaitingRoom.find({ status: 'WAITING' })
    .sort({ targetPoolLevel: 1, enqueuedAt: 1 })
    .limit(limit)
    .lean();

  let joined = 0;
  let skipped = 0;

  for (const seat of seats) {
    try {
      const occupying = await findOccupyingParticipation(
        seat.userId,
        seat.targetPoolLevel
      );
      if (occupying) {
        skipped += 1;
        continue;
      }

      const balance = await getBalance(seat.userId);
      if (balance < 1) {
        skipped += 1;
        continue;
      }

      await executeNextPoolJoin({
        userId: seat.userId,
        targetPoolLevel: seat.targetPoolLevel,
        idempotencyKey: `wr-auto:${seat._id}`,
        waitingRoomSeatId: seat._id,
        eligibilityId: seat.eligibilityId,
      });
      joined += 1;
    } catch (err) {
      if (SKIPPABLE.has(err.code)) {
        skipped += 1;
      } else {
        console.error(`[${CRON_NAME}] seat ${seat._id} error:`, err.code || err.message);
        skipped += 1;
      }
    }
  }

  return { processed: seats.length, joined, skipped };
}

cron.schedule('*/2 * * * *', async () => {
  const runId = `${CRON_NAME}_${Date.now()}`;
  const startedAt = Date.now();
  console.log(`\n⏰ [${CRON_NAME}] RUN START`, {
    runId,
    time: new Date().toISOString(),
  });

  try {
    const result = await processWaitingRoomBatch();
    console.log(`✅ [${CRON_NAME}] RUN DONE`, {
      runId,
      ms: Date.now() - startedAt,
      ...result,
    });
  } catch (err) {
    console.error(`❌ [${CRON_NAME}] RUN FAIL`, {
      runId,
      message: err.message,
    });
  }
});

module.exports = { processWaitingRoomBatch };
