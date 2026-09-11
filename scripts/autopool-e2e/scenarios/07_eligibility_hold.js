const { expect, expectStatus, expectCode } = require('../assert');
const { provision, userPost, adminPost, adminGet } = require('../provision');
const { fillCycles } = require('./04_cycle_complete_fifo');
const { clearE2eTree, ensureRootOccupying } = require('./00_health_seed');

module.exports = {
  id: 'J4_hold',
  title: 'Eligibility held when target pool occupying',
  intent: 'Docs §10 — do not Feature-forfeit; hold AVAILABLE; join blocked',
  async run(ctx) {
    const subject = await provision(ctx, { tag: 'hold', eCartBalance: 30000 });
    await clearE2eTree(ctx);
    await adminPost(ctx, '/e2e/bootstrap-pool', { email: subject.email, poolLevel: 1 });
    await adminPost(ctx, '/e2e/bootstrap-pool', { email: subject.email, poolLevel: 2 });

    await fillCycles(ctx, subject, 1, 5);

    const elig = await adminGet(ctx, '/eligibilities');
    const mine = (elig.data?.data || []).find(
      (e) =>
        String(e.userId) === String(subject.userId) &&
        e.targetPoolLevel === 2 &&
        e.status === 'AVAILABLE'
    );
    expect(mine, 'AVAILABLE eligibility held while P2 occupying');

    const joiner = await provision(ctx, { tag: 'holdc', eCartBalance: 5000 });
    await userPost(ctx, joiner.token, '/pools/1/join', {
      referrerSerialNumber: subject.serialNumber,
      idempotencyKey: `holdc-${joiner.userId}`,
    });

    const join = await userPost(ctx, subject.token, '/pools/2/join-next', {
      idempotencyKey: `holdjoin-${subject.userId}`,
    });
    expectStatus(join, 409);
    expectCode(join, 'TARGET_OCCUPYING');

    const elig2 = await adminGet(ctx, '/eligibilities');
    const still = (elig2.data?.data || []).find(
      (e) => String(e._id) === String(mine._id) && e.status === 'AVAILABLE'
    );
    expect(still, 'eligibility still AVAILABLE (held)');

    // Keep joinedP2Subject alive for R_release if present — do not clear again
    await ensureRootOccupying(ctx);
    return { notes: 'eligibility held; join blocked TARGET_OCCUPYING' };
  },
};
