const { expect, expectEq, expectStatus, expectCode } = require('../assert');
const { provision, userPost, adminPost } = require('../provision');
const { withAuth } = require('../client');
const { getWallet } = require('./00_health_seed');

module.exports = {
  id: 'P_gates',
  title: 'Pain paths — Pool-1 entry gates',
  intent: 'Docs §3 package/SN/self/active-referrer; edge cases 1b,18,20,21',
  async run(ctx) {
    const notes = [];

    try {
      // P1 disabled
      await ctx.http.put(
        '/autopool/admin/enabled',
        { enabled: false },
        { headers: withAuth(ctx.adminToken) }
      );
      const uDis = await provision(ctx, { tag: 'pdis', eCartBalance: 5000 });
      const rDis = await userPost(ctx, uDis.token, '/pools/1/join', {
        referrerSerialNumber: ctx.root.serialNumber,
      });
      expectStatus(rDis, 403);
      expectCode(rDis, 'AUTOPOOL_DISABLED');
      notes.push('P1 disabled');
    } finally {
      await ctx.http.put(
        '/autopool/admin/enabled',
        { enabled: true },
        { headers: withAuth(ctx.adminToken) }
      );
    }

    // P2 no package
    const uNoPkg = await provision(ctx, {
      tag: 'nopkg',
      eCartBalance: 5000,
      withPackage: false,
    });
    const rNoPkg = await userPost(ctx, uNoPkg.token, '/pools/1/join', {
      referrerSerialNumber: ctx.root.serialNumber,
    });
    expectStatus(rNoPkg, 400);
    expectCode(rNoPkg, 'NO_PACKAGE');
    notes.push('P2 no package');

    // P3 insufficient wallet
    const uPoor = await provision(ctx, { tag: 'poor', eCartBalance: 10 });
    const rPoor = await userPost(ctx, uPoor.token, '/pools/1/join', {
      referrerSerialNumber: ctx.root.serialNumber,
    });
    expectStatus(rPoor, 400);
    expectCode(rPoor, 'INSUFFICIENT_WALLET');
    notes.push('P3 insufficient');

    // P4 self referral
    const uSelf = await provision(ctx, { tag: 'self', eCartBalance: 5000 });
    // must occupy so own SN is "active" — still self-ref blocked first
    const rSelf = await userPost(ctx, uSelf.token, '/pools/1/join', {
      referrerSerialNumber: uSelf.serialNumber,
    });
    expectStatus(rSelf, 400);
    expectCode(rSelf, 'SELF_REFERRAL');
    notes.push('P4 self');

    // P5 invalid SN
    const uInv = await provision(ctx, { tag: 'inv', eCartBalance: 5000 });
    const rInv = await userPost(ctx, uInv.token, '/pools/1/join', {
      referrerSerialNumber: 999999991,
    });
    expectStatus(rInv, 400);
    expectCode(rInv, 'INVALID_SN');
    notes.push('P5 invalid SN');

    // P6 referrer not occupying — provision idle user (no bootstrap)
    const idle = await provision(ctx, { tag: 'idle', eCartBalance: 100 });
    const uRef = await provision(ctx, { tag: 'refbad', eCartBalance: 5000 });
    const rRef = await userPost(ctx, uRef.token, '/pools/1/join', {
      referrerSerialNumber: idle.serialNumber,
    });
    expectStatus(rRef, 400);
    expectCode(rRef, 'REFERRER_NOT_ACTIVE');
    notes.push('P6 inactive referrer');

    // P7 already occupying
    const uOcc = await provision(ctx, { tag: 'occ', eCartBalance: 5000 });
    const ok = await userPost(ctx, uOcc.token, '/pools/1/join', {
      referrerSerialNumber: ctx.root.serialNumber,
      idempotencyKey: `e2e-occ-${uOcc.userId}`,
    });
    expect([200, 201].includes(ok.status), `first join ${ok.status} ${JSON.stringify(ok.data)}`);
    const again = await userPost(ctx, uOcc.token, '/pools/1/join', {
      referrerSerialNumber: ctx.root.serialNumber,
      idempotencyKey: `e2e-occ2-${uOcc.userId}`,
    });
    expectStatus(again, 409);
    expectCode(again, 'POOL_OCCUPYING');
    notes.push('P7 occupying');

    ctx.shared.sampleJoiner = uOcc;
    return { notes: notes.join('; ') };
  },
};
