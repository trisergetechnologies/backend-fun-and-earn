#!/usr/bin/env node
/**
 * Autopool API-only E2E runner.
 *
 * Requires backend running (NODE_ENV=development) and admin user.
 *
 *   npm run test:autopool-e2e
 *   AUTOPOOL_E2E_BASE_URL=http://localhost:5000/api/v1 npm run test:autopool-e2e
 *   AUTOPOOL_E2E_ADMIN_EMAIL=admin@local.test AUTOPOOL_E2E_ADMIN_PASSWORD=Test@1234 npm run test:autopool-e2e
 *   node scripts/autopool-e2e/run.js --all
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '../../.env'), override: true });

const { BASE_URL, createClient, login, withAuth } = require('./client');
const { AssertError } = require('./assert');
const { adminPost } = require('./provision');

const scenarios = [
  require('./scenarios/00_health_seed'),
  require('./scenarios/01_pain_entry_gates'),
  require('./scenarios/02_happy_join_pool1'),
  require('./scenarios/04_cycle_complete_fifo'),
  require('./scenarios/05_cycle_6_and_15'),
  require('./scenarios/06_join_next_gates'),
  require('./scenarios/07_eligibility_hold'),
  require('./scenarios/08_release_and_reentry'),
  require('./scenarios/09_pool10_credit_reset'),
  require('./scenarios/10_legacy_isolation'),
];

const continueAll = process.argv.includes('--all');

function gitCommit() {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: path.join(__dirname, '../..'), encoding: 'utf8' }).trim();
  } catch {
    return 'n/a';
  }
}

function writeResults({ startedAt, rows, verdict, error }) {
  const lines = [];
  lines.push('# Autopool API E2E RESULTS');
  lines.push('');
  lines.push(`- **Started:** ${startedAt}`);
  lines.push(`- **Finished:** ${new Date().toISOString()}`);
  lines.push(`- **BASE_URL:** ${BASE_URL}`);
  lines.push(`- **Git:** ${gitCommit()}`);
  lines.push(`- **Verdict:** **${verdict}**`);
  if (error) lines.push(`- **Fatal:** ${error}`);
  lines.push('');
  lines.push('| ID | Title | Intent | Result | ms | Notes |');
  lines.push('|---|---|---|---|---:|---|');
  for (const r of rows) {
    lines.push(
      `| ${r.id} | ${r.title} | ${r.intent.replace(/\|/g, '/')} | ${r.result} | ${r.ms} | ${(r.notes || '').replace(/\|/g, '/')} |`
    );
  }
  lines.push('');
  lines.push('See [SCENARIO_CATALOG.md](./SCENARIO_CATALOG.md) for why each scenario exists.');
  lines.push('');
  if (rows.some((r) => r.result === 'FAIL')) {
    lines.push('## Failures');
    lines.push('');
    for (const r of rows.filter((x) => x.result === 'FAIL')) {
      lines.push(`### ${r.id}`);
      lines.push('```');
      lines.push(r.error || 'unknown');
      lines.push('```');
      lines.push('');
    }
  }
  fs.writeFileSync(path.join(__dirname, 'RESULTS.md'), lines.join('\n'), 'utf8');
}

async function main() {
  const startedAt = new Date().toISOString();
  const http = createClient();
  const rows = [];
  let verdict = 'PASS';

  const adminEmail = process.env.AUTOPOOL_E2E_ADMIN_EMAIL || 'admin@local.test';
  const adminPassword = process.env.AUTOPOOL_E2E_ADMIN_PASSWORD || 'Test@1234';

  console.log(`[autopool-e2e] BASE_URL=${BASE_URL}`);
  console.log(`[autopool-e2e] admin=${adminEmail}`);

  let admin;
  try {
    admin = await login(http, adminEmail, adminPassword, 'eCart');
  } catch (err) {
    // Admin may login without loginApp restriction
    try {
      admin = await login(http, adminEmail, adminPassword, 'shortVideo');
    } catch (e2) {
      writeResults({
        startedAt,
        rows: [],
        verdict: 'FAIL',
        error: `Admin login failed: ${err.message}. Seed with npm run db:seed:local`,
      });
      console.error(err.message);
      process.exit(1);
    }
  }

  const ctx = {
    http,
    adminToken: admin.token,
    shared: {},
  };

  // Soft reset of prior e2e users' autopool state
  try {
    await adminPost(ctx, '/e2e/reset', { deleteUsers: false });
  } catch (_) {
    /* ignore if first run */
  }

  for (const scenario of scenarios) {
    const t0 = Date.now();
    process.stdout.write(`[autopool-e2e] ${scenario.id} … `);
    try {
      const out = await scenario.run(ctx);
      const ms = Date.now() - t0;
      console.log(`PASS (${ms}ms)`);
      rows.push({
        id: scenario.id,
        title: scenario.title,
        intent: scenario.intent,
        result: 'PASS',
        ms,
        notes: out?.notes || '',
      });
    } catch (err) {
      const ms = Date.now() - t0;
      console.log(`FAIL (${ms}ms)`);
      console.error(err.message);
      if (err.meta) console.error(err.meta);
      rows.push({
        id: scenario.id,
        title: scenario.title,
        intent: scenario.intent,
        result: 'FAIL',
        ms,
        notes: '',
        error: err.stack || err.message,
      });
      verdict = 'FAIL';
      if (!continueAll) break;
    }
  }

  writeResults({ startedAt, rows, verdict });
  console.log(`[autopool-e2e] ${verdict} — wrote scripts/autopool-e2e/RESULTS.md`);
  process.exit(verdict === 'PASS' ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
