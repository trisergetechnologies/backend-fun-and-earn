const { expect, expectEq } = require('../assert');
const { provision, userGet, adminGet, adminPost } = require('../provision');
const { getWallet, clearE2eTree, ensureRootOccupying } = require('./00_health_seed');

/**
 * Fill N cycles for subject at poolLevel.
 * Uses server-side advance-cycles (seals competing FIFO seats + leaf fillers).
 * Trusts the advance response — after release, GET /pools/:level returns null.
 */
async function fillCycles(ctx, subject, poolLevel, targetCycleCount) {
  const advanced = await adminPost(ctx, '/e2e/advance-cycles', {
    email: subject.email,
    poolLevel,
    targetCycleCount,
  });
  if (!advanced.data?.success) {
    throw new Error(
      `advance-cycles failed: ${JSON.stringify(advanced.data)} (status ${advanced.status})`
    );
  }
  const part = advanced.data?.data?.participation;
  const current = part?.cycleCount || 0;
  if (current < targetCycleCount) {
    throw new Error(
      `Could not reach cycle ${targetCycleCount} for subject (at ${current}).`
    );
  }
  return part;
}

module.exports = {
  id: 'C1_C5',
  title: 'FIFO cycles 1 and 5 — eligibility created',
  intent: 'Docs §5–6 cycle distribution; exactly one eligibility at cycle 5',
  fillCycles,
  async run(ctx) {
    // Isolate: subject alone as pool-1 root so 2 fillers complete their cycle immediately.
    const subject = await provision(ctx, { tag: 'cyc', eCartBalance: 10000 });
    await clearE2eTree(ctx);
    await adminPost(ctx, '/e2e/bootstrap-pool', {
      email: subject.email,
      poolLevel: 1,
    });

    const walletBefore = await getWallet(ctx, subject);
    await fillCycles(ctx, subject, 1, 1);

    const after1 = await userGet(ctx, subject.token, '/pools/1');
    expectEq(after1.data?.data?.participation?.cycleCount, 1, 'cycleCount=1');

    const walletAfter1 = await getWallet(ctx, subject);
    expectEq(walletAfter1, walletBefore + 200, 'cycle1 wallet +200');

    const cycles = await adminGet(ctx, `/cycles?userId=${subject.userId}`);
    const c1 = (cycles.data?.data || []).find((c) => c.cycleNumber === 1);
    expect(c1, 'cycle1 row');
    expectEq(c1.walletAmount, 200, 'walletAmount');
    expectEq(c1.nextPoolAmount, 200, 'nextPoolAmount');
    expectEq(c1.adminAmount, 50, 'adminAmount');
    expectEq(c1.featureAmount, 50, 'featureAmount');

    await fillCycles(ctx, subject, 1, 5);
    const elig = await adminGet(ctx, '/eligibilities');
    const mine = (elig.data?.data || []).find(
      (e) => String(e.userId) === String(subject.userId) && e.status === 'AVAILABLE'
    );
    // After more cycles, eligibility may still be AVAILABLE (not consumed)
    const mineAll = (elig.data?.data || []).filter(
      (e) => String(e.userId) === String(subject.userId) && e.status === 'AVAILABLE'
    );
    expectEq(mineAll.length, 1, 'exactly one AVAILABLE eligibility');
    expectEq(mineAll[0].targetPoolLevel, 2, 'target pool 2');
    expectEq(mineAll[0].entryAmount, 1000, 'entry amount 1000');

    // Restore active referrer for later scenes
    await ensureRootOccupying(ctx);

    ctx.shared.cycleSubject = subject;
    ctx.shared.cycleSubjectElig = mineAll[0];
    return { notes: `cycles 1+5 ok; eligibility id ${mineAll[0]._id}` };
  },
};
