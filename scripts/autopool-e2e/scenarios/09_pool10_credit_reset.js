const { expect, expectEq } = require('../assert');
const { provision, userGet, adminPost, userPost } = require('../provision');
const { fillCycles } = require('./04_cycle_complete_fifo');
const { clearE2eTree, ensureRootOccupying } = require('./00_health_seed');

module.exports = {
  id: 'R3_R4_pool10',
  title: 'Pool 10 credit reset with/without other occupying pools',
  intent: 'Docs §15.3 credit reset on Pool10 15/15',
  async run(ctx) {
    // R3: only pool 10 occupying → reset to 0
    const solo = await provision(ctx, { tag: 'p10s', eCartBalance: 1000 });
    await clearE2eTree(ctx);
    await adminPost(ctx, '/e2e/bootstrap-pool', { email: solo.email, poolLevel: 10 });
    const j = await provision(ctx, { tag: 'p10c', eCartBalance: 5000 });
    await userPost(ctx, j.token, '/pools/1/join', {
      referrerSerialNumber: solo.serialNumber,
      idempotencyKey: `p10c-${j.userId}`,
    });
    let credits = await userGet(ctx, solo.token, '/credits');
    expect((credits.data?.data?.balance ?? 0) >= 1, 'solo has credits');

    await fillCycles(ctx, solo, 10, 15);
    credits = await userGet(ctx, solo.token, '/credits');
    expectEq(credits.data?.data?.balance, 0, 'R3 credits reset to 0');

    // R4: pool 10 done but still occupying pool 1 → no reset
    const multi = await provision(ctx, { tag: 'p10m', eCartBalance: 1000 });
    await clearE2eTree(ctx);
    await adminPost(ctx, '/e2e/bootstrap-pool', { email: multi.email, poolLevel: 1 });
    await adminPost(ctx, '/e2e/bootstrap-pool', { email: multi.email, poolLevel: 10 });
    const j2 = await provision(ctx, { tag: 'p10c2', eCartBalance: 5000 });
    // multi must be active referrer — already occupying P1+P10
    await userPost(ctx, j2.token, '/pools/1/join', {
      referrerSerialNumber: multi.serialNumber,
      idempotencyKey: `p10c2-${j2.userId}`,
    });
    const before = await userGet(ctx, multi.token, '/credits');
    const bal = before.data?.data?.balance ?? 0;
    expect(bal >= 1, 'multi has credits');

    await fillCycles(ctx, multi, 10, 15);
    const after = await userGet(ctx, multi.token, '/credits');
    expectEq(after.data?.data?.balance, bal, 'R4 credits unchanged');

    await ensureRootOccupying(ctx);
    return { notes: 'R3 reset; R4 no reset' };
  },
};
