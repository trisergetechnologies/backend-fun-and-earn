const { expect, expectEq, expectStatus } = require('../assert');
const { provision, userPost, userGet, adminGet } = require('../provision');
const { getWallet } = require('./00_health_seed');

module.exports = {
  id: 'H1_H2',
  title: 'Happy Join P1 + idempotent retry',
  intent: 'Docs §3.1 manual entry; tech idempotency; referrer +1 credit',
  async run(ctx) {
    const subject = await provision(ctx, { tag: 'h1', eCartBalance: 5000 });
    const beforeWallet = await getWallet(ctx, subject);
    const beforeCredits = await userGet(ctx, ctx.root.token, '/credits');
    const rootCreditsBefore = beforeCredits.data?.data?.balance ?? 0;

    const key = `e2e-h1-${subject.userId}`;
    const join1 = await userPost(ctx, subject.token, '/pools/1/join', {
      referrerSerialNumber: ctx.root.serialNumber,
      idempotencyKey: key,
    });
    expect([200, 201].includes(join1.status), `join1 ${join1.status} ${JSON.stringify(join1.data)}`);
    expect(join1.data?.success, 'join success');

    const afterWallet = await getWallet(ctx, subject);
    expectEq(afterWallet, beforeWallet - 500, 'eCart debit 500');

    const join2 = await userPost(ctx, subject.token, '/pools/1/join', {
      referrerSerialNumber: ctx.root.serialNumber,
      idempotencyKey: key,
    });
    expect(join2.data?.success, 'idempotent success');
    expect(join2.data?.data?.alreadyProcessed === true, 'alreadyProcessed');
    const afterWallet2 = await getWallet(ctx, subject);
    expectEq(afterWallet2, afterWallet, 'no second debit');

    const rootCreditsAfter = await userGet(ctx, ctx.root.token, '/credits');
    expectEq(
      rootCreditsAfter.data?.data?.balance,
      rootCreditsBefore + 1,
      'root +1 credit'
    );

    const refs = await adminGet(ctx, '/referrals');
    const hit = (refs.data?.data || []).some(
      (r) => String(r.referredUserId?._id || r.referredUserId) === String(subject.userId)
    );
    expect(hit, 'referral event exists');

    const overview = await userGet(ctx, subject.token, '/overview');
    const p1 = (overview.data?.data?.pools || []).find((p) => p.poolLevel === 1);
    expect(p1?.occupying, 'subject occupying P1');

    ctx.shared.happySubject = subject;
    return { notes: `subject SN ${subject.serialNumber}; debit ok; idempotent ok` };
  },
};
