const { login, withAuth } = require('./client');

const DEFAULT_PASSWORD = 'Test@1234';
let seq = 0;

function nextEmail(tag = 'u') {
  seq += 1;
  return `e2e.autopool.${tag}.${Date.now()}.${seq}@test.local`;
}

async function provision(ctx, opts = {}) {
  const email = opts.email || nextEmail(opts.tag || 'u');
  const password = opts.password || DEFAULT_PASSWORD;
  const res = await ctx.http.post(
    '/autopool/admin/e2e/provision',
    {
      email,
      password,
      eCartBalance: opts.eCartBalance ?? 50000,
      packageName: opts.packageName || 'Basic',
      withPackage: opts.withPackage !== false,
      referredBy: opts.referredBy ?? null,
      name: opts.name,
    },
    { headers: withAuth(ctx.adminToken) }
  );
  if (res.status >= 400 || !res.data?.success) {
    throw new Error(`provision failed: ${res.status} ${JSON.stringify(res.data)}`);
  }
  const loginRes = await login(ctx.http, email, password, 'eCart');
  return {
    ...res.data.data,
    password,
    token: loginRes.token,
  };
}

async function adminGet(ctx, path) {
  return ctx.http.get(`/autopool/admin${path}`, { headers: withAuth(ctx.adminToken) });
}

async function adminPost(ctx, path, body) {
  return ctx.http.post(`/autopool/admin${path}`, body, { headers: withAuth(ctx.adminToken) });
}

async function userGet(ctx, token, path) {
  return ctx.http.get(`/autopool/user${path}`, { headers: withAuth(token) });
}

async function userPost(ctx, token, path, body) {
  const payload = { ...(body || {}) };
  if (String(path).includes('/pools/1/join') && payload.legalNoticeAccepted === undefined) {
    payload.legalNoticeAccepted = true;
  }
  return ctx.http.post(`/autopool/user${path}`, payload, { headers: withAuth(token) });
}

async function snapshotUser(ctx, user) {
  const [overview, credits, pool1] = await Promise.all([
    userGet(ctx, user.token, '/overview'),
    userGet(ctx, user.token, '/credits'),
    userGet(ctx, user.token, '/pools/1'),
  ]);
  // refresh wallet via provision read — use overview only; wallet from re-provision get
  const me = await ctx.http.post(
    '/autopool/admin/e2e/provision',
    {
      email: user.email,
      password: user.password,
      eCartBalance: undefined,
      withPackage: true,
    },
    { headers: withAuth(ctx.adminToken) }
  ).catch(() => null);

  // Don't overwrite balance on snapshot — read User via admin participations / health
  // Instead fetch eCart by re-reading after a no-op: use credits + overview
  return {
    overview: overview.data?.data,
    creditBalance: credits.data?.data?.balance ?? 0,
    creditLedger: credits.data?.data?.ledger || [],
    pool1: pool1.data?.data,
    eCartWallet: user.eCartWallet, // updated by callers after joins
  };
}

module.exports = {
  DEFAULT_PASSWORD,
  nextEmail,
  provision,
  adminGet,
  adminPost,
  userGet,
  userPost,
  snapshotUser,
};
