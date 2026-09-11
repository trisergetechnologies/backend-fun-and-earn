const { expect, expectEq } = require('../assert');
const { provision, userPost, adminPost } = require('../provision');

module.exports = {
  id: 'L1_legacy',
  title: 'Legacy referredBy unchanged after Autopool join',
  intent: 'Docs §16 / edge 28 — Autopool referral is separate',
  async run(ctx) {
    const legacyCode = 'LEGACYE2E1';
    const u = await provision(ctx, {
      tag: 'leg',
      eCartBalance: 5000,
      referredBy: legacyCode,
    });
    expectEq(u.referredBy, legacyCode, 'pre referredBy');

    await userPost(ctx, u.token, '/pools/1/join', {
      referrerSerialNumber: ctx.root.serialNumber,
      idempotencyKey: `leg-${u.userId}`,
    });

    // Re-read via provision (does not clear referredBy)
    const again = await adminPost(ctx, '/e2e/provision', {
      email: u.email,
      password: u.password,
    });
    expectEq(again.data?.data?.referredBy, legacyCode, 'post referredBy unchanged');

    return { notes: `referredBy stayed ${legacyCode}` };
  },
};
