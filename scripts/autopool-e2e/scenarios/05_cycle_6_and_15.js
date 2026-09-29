const { expect, expectEq } = require('../assert');
const { userGet, adminGet, provision, adminPost } = require('../provision');
const { fillCycles } = require('./04_cycle_complete_fifo');
const { clearE2eTree, ensureRootOccupying } = require('./00_health_seed');

module.exports = {
  id: 'C5',
  title: 'Cycle 5 termination keeps next-pool funding',
  intent: 'Cycle 5 is final: same-pool to Feature, next-pool amount kept, no cycle 6',
  async run(ctx) {
    const subject = await provision(ctx, { tag: 'c5', eCartBalance: 50000 });
    await clearE2eTree(ctx);
    await adminPost(ctx, '/e2e/bootstrap-pool', { email: subject.email, poolLevel: 1 });

    await fillCycles(ctx, subject, 1, 5);
    const cycles = await adminGet(ctx, `/cycles?userId=${subject.userId}`);
    const c5 = (cycles.data?.data || []).find((c) => c.cycleNumber === 5);
    expect(c5, 'cycle 5');
    expect(c5.nextPoolAmount > 0, 'cycle5 next-pool still funded');
    expectEq(c5.samePoolAmount, 0, 'cycle5 samePool 0');
    const c6 = (cycles.data?.data || []).find((c) => c.cycleNumber === 6);
    expect(!c6, 'no cycle 6');

    const elig = await adminGet(ctx, '/eligibilities');
    const count = (elig.data?.data || []).filter(
      (e) => String(e.userId) === String(subject.userId)
    ).length;
    expectEq(count, 1, 'eligibility created at cycle 5');

    const p = await userGet(ctx, subject.token, '/pools/1');
    expectEq(p.data?.data?.participation?.cycleCount, 5, 'at 5');
    expectEq(p.data?.data?.participation?.status, 'COMPLETED', 'COMPLETED');

    await ensureRootOccupying(ctx);
    return { notes: 'C5 final; next-pool kept; no C6' };
  },
};
