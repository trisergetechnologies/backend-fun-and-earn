'use strict';

const cron = require('node-cron');
const {
  runRetentionBatch,
  getRetentionBatchSize,
} = require('../shortVideo/services/videoRetention.service');

const CRON_NAME = 'VIDEO_RETENTION_CRON';

console.log(`[${CRON_NAME}] loaded at ${new Date().toISOString()}`);

cron.schedule(
  '0 2 * * *',
  async () => {
    const runId = `${CRON_NAME}_${Date.now()}`;
    console.log(`[${CRON_NAME}] scheduled run`, { runId });

    try {
      const batchSize = getRetentionBatchSize();
      await runRetentionBatch(batchSize);
    } catch (err) {
      console.error(`[${CRON_NAME}] run failed`, {
        runId,
        message: err.message,
      });
    }
  },
  { timezone: 'Asia/Kolkata' }
);
