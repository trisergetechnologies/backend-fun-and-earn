const { expect, expectEq, expectStatus, expectCode } = require('../assert');
const { provision, userPost, userGet, adminPost } = require('../provision');
const { fillCycles } = require('./04_cycle_complete_fifo');
const { getWallet, clearE2eTree, ensureRootOccupying } = require('./00_health_seed');

async function earnCredit(ctx, beneficiary, times = 1) {
  for (let i = 0; i < times; i += 1) {
    const joiner = await provision(ctx, { tag: `cred${i}`, eCartBalance: 5000 });
    const res = await userPost(ctx, joiner.token, '/pools/1/join', {
      referrerSerialNumber: beneficiary.serialNumber,
      idempotencyKey: `rcred-${i}-${joiner.userId}`,
    });
    expect([200, 201].includes(res.status), `earn credit ${JSON.stringify(res.data)}`);
  }
}

module.exports = {
  id: 'R_release',
  title: 'Release gate — re-entry blocked until upgrade used + 10/10',
  intent: 'Docs §8.1 release; edge case 2 vs not-released',
  async run(ctx) {
    // Path A: complete 10 without upgrade → blocked re-entry
    const a = await provision(ctx, { tag: 'r2', eCartBalance: 50000 });
    await clearE2eTree(ctx);
    await adminPost(ctx, '/e2e/bootstrap-pool', { email: a.email, poolLevel: 1 });
    await fillCycles(ctx, a, 1, 10);
    const pA = await userGet(ctx, a.token, '/pools/1');
    expectEq(pA.data?.data?.participation?.cycleCount, 10, 'A at 10');
    expect(!pA.data?.data?.participation?.upgradeUsedAt, 'upgrade unused');
    expect(!pA.data?.data?.participation?.releasedAt, 'not released');

    await ensureRootOccupying(ctx);
    const walletBefore = await getWallet(ctx, a);
    const reA = await userPost(ctx, a.token, '/pools/1/join', {
      referrerSerialNumber: ctx.root.serialNumber,
      idempotencyKey: `reA-${a.userId}`,
    });
    expectStatus(reA, 409);
    expectCode(reA, 'POOL_OCCUPYING');
    expectEq(await getWallet(ctx, a), walletBefore, 'no debit when blocked');

    // Path B: upgrade used then finish 15 → released → re-enter ok
    const b = await provision(ctx, { tag: 'r1', eCartBalance: 50000 });
    await clearE2eTree(ctx);
    await adminPost(ctx, '/e2e/bootstrap-pool', { email: b.email, poolLevel: 1 });
    await fillCycles(ctx, b, 1, 5);
    await earnCredit(ctx, b, 2);
    const join2 = await userPost(ctx, b.token, '/pools/2/join-next', {
      idempotencyKey: `r1j2-${b.userId}`,
    });
    expect([200, 201].includes(join2.status), `join P2 ${JSON.stringify(join2.data)}`);

    const partB = await fillCycles(ctx, b, 1, 10);
    expect(partB.upgradeUsedAt, 'B upgrade used');
    expect(partB.releasedAt, 'B released after 10+upgrade');
    expectEq(partB.cycleCount, 10, 'B at 10');

    await ensureRootOccupying(ctx);
    const reB = await userPost(ctx, b.token, '/pools/1/join', {
      referrerSerialNumber: ctx.root.serialNumber,
      idempotencyKey: `reB-${b.userId}`,
    });
    expect([200, 201].includes(reB.status), `re-entry ${reB.status} ${JSON.stringify(reB.data)}`);

    return { notes: 'R2 block ok; R1 re-entry after release ok' };
  },
};
