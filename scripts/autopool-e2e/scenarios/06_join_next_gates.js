const { expect, expectEq, expectStatus, expectCode } = require('../assert');
const { provision, userPost, userGet, adminPost } = require('../provision');
const { fillCycles } = require('./04_cycle_complete_fifo');
const { clearE2eTree, ensureRootOccupying } = require('./00_health_seed');

async function earnCredit(ctx, beneficiary) {
  const joiner = await provision(ctx, { tag: 'cred', eCartBalance: 5000 });
  const res = await userPost(ctx, joiner.token, '/pools/1/join', {
    referrerSerialNumber: beneficiary.serialNumber,
    idempotencyKey: `cred-${joiner.userId}`,
  });
  if (![200, 201].includes(res.status)) {
    await adminPost(ctx, '/e2e/bootstrap-pool', {
      email: beneficiary.email,
      poolLevel: 1,
    });
    const res2 = await userPost(ctx, joiner.token, '/pools/1/join', {
      referrerSerialNumber: beneficiary.serialNumber,
      idempotencyKey: `cred2-${joiner.userId}`,
    });
    expect([200, 201].includes(res2.status), `earn credit join ${JSON.stringify(res2.data)}`);
  }
}

module.exports = {
  id: 'J_gates',
  title: 'Join-next gates + happy join pool 2',
  intent: 'Docs §15 credits; §7 join next; §10 hold when occupying',
  async run(ctx) {
    // J1: eligibility, zero credits
    const zero = await provision(ctx, { tag: 'jzero', eCartBalance: 20000 });
    await clearE2eTree(ctx);
    await adminPost(ctx, '/e2e/bootstrap-pool', { email: zero.email, poolLevel: 1 });
    await fillCycles(ctx, zero, 1, 5);

    const j1 = await userPost(ctx, zero.token, '/pools/2/join-next', {
      idempotencyKey: `j1-${zero.userId}`,
    });
    expectStatus(j1, 400);
    expectCode(j1, 'NO_UPGRADE_CREDIT');

    // J2: credit but no eligibility
    const credOnly = await provision(ctx, { tag: 'j2', eCartBalance: 5000 });
    await clearE2eTree(ctx);
    await adminPost(ctx, '/e2e/bootstrap-pool', { email: credOnly.email, poolLevel: 1 });
    await earnCredit(ctx, credOnly);
    const j2 = await userPost(ctx, credOnly.token, '/pools/2/join-next', {
      idempotencyKey: `j2-${credOnly.userId}`,
    });
    expectStatus(j2, 400);
    expectCode(j2, 'NO_ELIGIBILITY');

    // J3: eligibility + credit → join pool 2
    const subject = await provision(ctx, { tag: 'j3', eCartBalance: 20000 });
    await clearE2eTree(ctx);
    await adminPost(ctx, '/e2e/bootstrap-pool', { email: subject.email, poolLevel: 1 });
    await fillCycles(ctx, subject, 1, 5);
    await earnCredit(ctx, subject);

    const before = await userGet(ctx, subject.token, '/credits');
    const balBefore = before.data?.data?.balance ?? 0;
    expect(balBefore >= 1, 'has credit');

    const j3 = await userPost(ctx, subject.token, '/pools/2/join-next', {
      idempotencyKey: `j3-${subject.userId}`,
    });
    expect([200, 201].includes(j3.status), `join2 ${j3.status} ${JSON.stringify(j3.data)}`);
    const after = await userGet(ctx, subject.token, '/credits');
    expectEq(after.data?.data?.balance, balBefore - 1, 'credit -1');

    const ov = await userGet(ctx, subject.token, '/overview');
    const pool2 = (ov.data?.data?.pools || []).find((p) => p.poolLevel === 2);
    expect(pool2?.occupying, 'occupying pool 2');

    const p1 = await userGet(ctx, subject.token, '/pools/1');
    expect(p1.data?.data?.participation?.upgradeUsedAt, 'upgradeUsedAt set');

    await ensureRootOccupying(ctx);
    ctx.shared.joinedP2Subject = subject;
    return { notes: 'J1 no credit; J2 no elig; J3 join P2 ok' };
  },
};
