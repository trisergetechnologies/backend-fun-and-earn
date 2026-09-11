const { expect, expectEq } = require('../assert');
const { userGet, adminGet, provision, adminPost } = require('../provision');
const { fillCycles } = require('./04_cycle_complete_fifo');
const { clearE2eTree, ensureRootOccupying } = require('./00_health_seed');

module.exports = {
  id: 'C6_C15',
  title: 'Cycle 6 Feature redirect + Cycle 15 termination',
  intent: 'Docs §6 cycles 6–15; §11 cycle 15; no cycle 16',
  async run(ctx) {
    const subject = await provision(ctx, { tag: 'c15', eCartBalance: 50000 });
    await clearE2eTree(ctx);
    await adminPost(ctx, '/e2e/bootstrap-pool', { email: subject.email, poolLevel: 1 });

    await fillCycles(ctx, subject, 1, 6);
    const cycles = await adminGet(ctx, `/cycles?userId=${subject.userId}`);
    const c6 = (cycles.data?.data || []).find((c) => c.cycleNumber === 6);
    expect(c6, 'cycle 6 exists');
    expectEq(c6.nextPoolAmount, 0, 'cycle6 nextPoolAmount 0');
    expect(c6.featureAmount >= 250, 'cycle6 feature includes redirected 20%');

    const elig = await adminGet(ctx, '/eligibilities');
    const count = (elig.data?.data || []).filter(
      (e) => String(e.userId) === String(subject.userId)
    ).length;
    expectEq(count, 1, 'still only one eligibility after cycle 6');

    await fillCycles(ctx, subject, 1, 15);
    const p = await userGet(ctx, subject.token, '/pools/1');
    expectEq(p.data?.data?.participation?.cycleCount, 15, 'at 15');
    expectEq(p.data?.data?.participation?.status, 'COMPLETED', 'COMPLETED');

    const cycles15 = await adminGet(ctx, `/cycles?userId=${subject.userId}`);
    const c15 = (cycles15.data?.data || []).find((c) => c.cycleNumber === 15);
    expect(c15, 'cycle 15');
    expectEq(c15.samePoolAmount, 0, 'cycle15 samePool 0');
    const c16 = (cycles15.data?.data || []).find((c) => c.cycleNumber === 16);
    expect(!c16, 'no cycle 16');

    await ensureRootOccupying(ctx);
    return { notes: 'C6 feature redirect; C15 complete; no C16' };
  },
};
