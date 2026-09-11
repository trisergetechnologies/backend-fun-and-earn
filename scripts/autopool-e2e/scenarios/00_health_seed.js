const { expect, expectEq, expectStatus, expectCode } = require('../assert');
const { adminGet, adminPost, provision, userPost, userGet } = require('../provision');
const { withAuth } = require('../client');

async function getWallet(ctx, user) {
  // Omit eCartBalance so provision does not reset the wallet (read-only upsert).
  const res = await adminPost(ctx, '/e2e/provision', {
    email: user.email,
    password: user.password,
  });
  expect(res.data?.success, 'wallet read via provision');
  return res.data.data.eCartWallet;
}

/** Clear E2E Autopool tree so FIFO fillers hit the intended parent first. */
async function clearE2eTree(ctx) {
  await adminPost(ctx, '/e2e/reset', { deleteUsers: false });
}

/** Re-enable Autopool and ensure ctx.root is occupying (after a tree reset). */
async function ensureRootOccupying(ctx) {
  await ctx.http.put(
    '/autopool/admin/enabled',
    { enabled: true },
    { headers: withAuth(ctx.adminToken) }
  );
  if (!ctx.root) {
    throw new Error('ctx.root missing — run S0 first');
  }
  const boot = await adminPost(ctx, '/bootstrap', { serialNumber: ctx.root.serialNumber });
  expect(boot.data?.success, 're-bootstrap root', boot.data);
}

module.exports = {
  id: 'S0',
  title: 'Health, seed, enable, bootstrap root',
  intent: 'Setup Autopool so referrers can be active (docs §3 referrer-active)',
  async run(ctx) {
    const seed = await adminPost(ctx, '/seed', {});
    expect(seed.data?.success, 'seed ok');

    const en = await ctx.http.put(
      '/autopool/admin/enabled',
      { enabled: true },
      { headers: withAuth(ctx.adminToken) }
    );
    expect(en.data?.success, 'enable ok');

    const root = await provision(ctx, {
      tag: 'root',
      eCartBalance: 100000,
      name: 'E2E Root',
    });
    const boot = await adminPost(ctx, '/bootstrap', { serialNumber: root.serialNumber });
    expect(boot.data?.success, 'bootstrap ok', boot.data);

    const health = await adminGet(ctx, '/health');
    expectEq(health.data?.data?.enabled, true, 'enabled');
    expect(health.data?.data?.occupyingParticipations >= 1, 'root occupying');

    ctx.root = root;
    ctx.shared = ctx.shared || {};
    ctx.shared.rootSn = root.serialNumber;
    return { notes: `root SN ${root.serialNumber}` };
  },
};

module.exports.getWallet = getWallet;
module.exports.clearE2eTree = clearE2eTree;
module.exports.ensureRootOccupying = ensureRootOccupying;
