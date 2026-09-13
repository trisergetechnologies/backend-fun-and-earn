/**
 * Local Autopool demo seed — one realistic user covering multiple concurrent situations.
 *
 * Story (how this portfolio happened):
 *   1. Priya bought a DreamMart package and was the first Autopool user (bootstrap → Pool 1).
 *   2. Friends joined Autopool using her SN → she earned upgrade credits (+1 each).
 *   3. Matrix filled under her → Pool 1 hit cycle 5 → Join Pool 2 became available.
 *   4. She spent 1 credit and joined Pool 2 (eligibility consumed; P1 upgrade marked used).
 *   5. Pool 1 kept cycling to 15/15 → released (upgrade already used) → Join Pool 1 open again.
 *   6. Pool 2 kept cycling to 5 → Join Pool 3 is Ready now (eligibility + remaining credits).
 *
 * Dashboard should show at once:
 *   - Pool 1 released / re-entry available (manual Join Pool 1 with Dream Points + SN)
 *   - Pool 2 active @ cycle 5, Join Pool 3 ready
 *   - Upgrade credits > 0, referral history, Dream Mart wallet with cycle rewards
 *
 * Usage:
 *   npm run db:seed:autopool
 *   (also invoked at the end of npm run db:seed:local)
 *
 * Default login: user@local.test / Test@1234
 */
const path = require('path');
const crypto = require('crypto');
const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env'), override: true });

const { hashPassword } = require('../src/utils/bcrypt');
const User = require('../src/models/User');
const Package = require('../src/models/Package');
const {
  AutopoolSettings,
  AutopoolParticipation,
  AutopoolPlacement,
  AutopoolCycle,
  AutopoolLedger,
  AutopoolReferralEvent,
  AutopoolNextPoolEligibility,
  AutopoolUpgradeCreditLedger,
  AutopoolUserCredit,
  AutopoolSystemBalances,
} = require('../src/autopool/models');
const {
  ensureSettings,
  seedPoolConfigs,
} = require('../src/autopool/services/config.service');
const { bootstrapRootUser, joinPool1Manual } = require('../src/autopool/services/entry.service');
const { joinNextPool } = require('../src/autopool/services/joinNext.service');
const { advanceCycles } = require('../src/autopool/services/e2e.service');

const GENESIS_EMAIL = process.env.AUTOPOOL_SEED_GENESIS_EMAIL || 'user@local.test';
const PASSWORD_PLAIN = 'Test@1234';
const GENESIS_SN = 1001;

/** Realistic supporting users who joined Autopool with Priya’s SN. */
const REFERRAL_JOINERS = [
  {
    tag: 'amit',
    name: 'Amit Verma',
    email: 'amit.verma@local.test',
    phone: '9876501001',
    city: 'Lucknow',
    state: 'Uttar Pradesh',
  },
  {
    tag: 'neha',
    name: 'Neha Kapoor',
    email: 'neha.kapoor@local.test',
    phone: '9876501002',
    city: 'Jaipur',
    state: 'Rajasthan',
  },
  {
    tag: 'rahul',
    name: 'Rahul Mehta',
    email: 'rahul.mehta@local.test',
    phone: '9876501003',
    city: 'Pune',
    state: 'Maharashtra',
  },
  {
    tag: 'sneha',
    name: 'Sneha Iyer',
    email: 'sneha.iyer@local.test',
    phone: '9876501004',
    city: 'Chennai',
    state: 'Tamil Nadu',
  },
];

async function clearAutopoolData() {
  await Promise.all([
    AutopoolParticipation.deleteMany({}),
    AutopoolPlacement.deleteMany({}),
    AutopoolCycle.deleteMany({}),
    AutopoolLedger.deleteMany({}),
    AutopoolReferralEvent.deleteMany({}),
    AutopoolNextPoolEligibility.deleteMany({}),
    AutopoolUpgradeCreditLedger.deleteMany({}),
    AutopoolUserCredit.deleteMany({}),
    AutopoolSystemBalances.deleteMany({}),
  ]);
  await AutopoolSettings.deleteMany({});
}

async function ensureBasicPackage() {
  return Package.findOneAndUpdate(
    { name: 'Basic' },
    {
      $setOnInsert: {
        name: 'Basic',
        price: 500,
        membersUpto: 2,
        levelUpto: 1,
        isActive: true,
        description: 'Basic package (local Autopool seed)',
      },
    },
    { upsert: true, new: true }
  );
}

async function nextFreeSerial(startFrom) {
  let sn = Number(startFrom) || 1001;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const taken = await User.findOne({ serialNumber: sn }).select('_id');
    if (!taken) return sn;
    sn += 1;
  }
}

async function ensureGenesisUser(pkg) {
  let user = await User.findOne({ email: GENESIS_EMAIL });
  if (!user) {
    throw new Error(
      `Genesis user ${GENESIS_EMAIL} not found. Run npm run db:seed:local first.`
    );
  }

  // Realistic profile for mobile / UI walkthrough
  user.name = 'Priya Sharma';
  user.gender = 'female';
  user.state_address = 'Karnataka';
  user.package = pkg._id;
  user.applications = Array.from(
    new Set([...(user.applications || []), 'eCart', 'shortVideo'])
  );
  user.wallets = user.wallets || {};
  // Enough for Pool 1 re-entry after release + leftover Dream Points
  user.wallets.eCartWallet = Math.max(Number(user.wallets.eCartWallet) || 0, 75000);
  user.eCartProfile = user.eCartProfile || {};
  user.eCartProfile.addresses = [
    {
      addressName: 'Home',
      slugName: 'home-priya',
      fullName: 'Priya Sharma',
      street: '14 Indiranagar 100 Feet Rd',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560038',
      phone: user.phone || '919911110003',
      isDefault: true,
    },
  ];
  user.eCartProfile.bankDetails = {
    accountHolderName: 'Priya Sharma',
    accountNumber: '50100234567890',
    ifscCode: 'HDFC0001234',
    upiId: 'priya.sharma@okhdfcbank',
    panNumber: 'ABCPS1234F',
  };
  if (!user.serialNumber) {
    user.serialNumber = await nextFreeSerial(GENESIS_SN);
  }
  await user.save();
  return user;
}

async function createReferralJoiner({ profile, pkg, passwordHash, serialNumber }) {
  let user = await User.findOne({ email: profile.email });
  if (!user) {
    user = await User.create({
      name: profile.name,
      email: profile.email,
      phone: profile.phone,
      password: passwordHash,
      gender: profile.tag === 'neha' || profile.tag === 'sneha' ? 'female' : 'male',
      role: 'user',
      applications: ['eCart', 'shortVideo'],
      state_address: profile.state,
      referralCode: `ap${profile.tag}${crypto.randomBytes(2).toString('hex')}`,
      serialNumber,
      package: pkg._id,
      isActive: true,
      wallets: {
        shortVideoWallet: 0,
        eCartWallet: 25000,
        rewardWallet: [],
      },
      eCartProfile: {
        addresses: [
          {
            addressName: 'Home',
            slugName: `home-${profile.tag}`,
            fullName: profile.name,
            street: 'Seed demo street',
            city: profile.city,
            state: profile.state,
            pincode: '560001',
            phone: profile.phone,
            isDefault: true,
          },
        ],
        orders: [],
        bankDetails: null,
      },
    });
  } else {
    user.name = profile.name;
    user.package = pkg._id;
    user.wallets = user.wallets || {};
    user.wallets.eCartWallet = Math.max(Number(user.wallets.eCartWallet) || 0, 25000);
    if (!user.serialNumber) user.serialNumber = serialNumber;
    await user.save();
  }
  return user;
}

async function summarizeUser(userId) {
  const user = await User.findById(userId);
  const parts = await AutopoolParticipation.find({ userId }).sort({ poolLevel: 1, createdAt: 1 });
  const eligs = await AutopoolNextPoolEligibility.find({ userId }).sort({ earnedAt: 1 });
  const credits = await AutopoolUserCredit.findOne({ userId });
  const referrals = await AutopoolReferralEvent.find({ referrerUserId: userId }).sort({
    createdAt: 1,
  });

  return { user, parts, eligs, credits, referrals };
}

async function seedAutopoolLocal() {
  if (process.env.NODE_ENV !== 'development' && process.env.SEED_ALLOW_DROP !== 'true') {
    throw new Error('Autopool seed only in development (or SEED_ALLOW_DROP=true)');
  }

  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI not set');

  const alreadyConnected = mongoose.connection.readyState === 1;
  if (!alreadyConnected) {
    await mongoose.connect(uri);
  }

  console.log('[autopool-seed] Clearing prior Autopool data…');
  await clearAutopoolData();

  // Drop prior seed joiners + ephemeral matrix fillers (keep admin/seller/genesis)
  await User.deleteMany({
    email: {
      $in: [
        ...REFERRAL_JOINERS.map((j) => j.email),
        'autopool.seed.joiner1@local.test',
        'autopool.seed.joiner2@local.test',
      ],
    },
  });
  await User.deleteMany({ email: /^e2e\.autopool\./i });
  await User.deleteMany({ email: /^autopool\.seed\./i });

  const pkg = await ensureBasicPackage();
  await seedPoolConfigs();
  const settings = await ensureSettings();
  settings.enabled = true;
  await settings.save();

  const genesis = await ensureGenesisUser(pkg);
  console.log(
    `[autopool-seed] Hero user: ${genesis.name} <${genesis.email}> SN ${genesis.serialNumber}`
  );

  // 1) First Autopool user — bootstrap Pool 1 (no referrer SN)
  const boot = await bootstrapRootUser({
    userId: genesis._id,
    adminUserId: null,
  });
  console.log(
    `[autopool-seed] Pool 1 bootstrap: ${boot.alreadyProcessed ? 'already' : 'created'}`
  );

  const passwordHash = await hashPassword(PASSWORD_PLAIN);

  // 2) Friends join with her SN → upgrade credits
  let serialCursor = genesis.serialNumber;
  for (let i = 0; i < REFERRAL_JOINERS.length; i++) {
    const profile = REFERRAL_JOINERS[i];
    serialCursor = await nextFreeSerial(serialCursor + 1);
    const joiner = await createReferralJoiner({
      profile,
      pkg,
      passwordHash,
      serialNumber: serialCursor,
    });
    const res = await joinPool1Manual({
      userId: joiner._id,
      referrerSerialNumber: genesis.serialNumber,
      idempotencyKey: `local-seed-join-${profile.tag}`,
      legalNoticeAccepted: true,
    });
    console.log(
      `[autopool-seed] Referral ${joiner.name} SN ${joiner.serialNumber} → used Priya SN ${genesis.serialNumber}` +
        (res.alreadyProcessed ? ' (idempotent)' : '')
    );
  }

  // 3) Advance Pool 1 → cycle 5 (next-pool eligibility)
  console.log('[autopool-seed] Advancing Pool 1 → cycle 5…');
  await advanceCycles({ userId: genesis._id, poolLevel: 1, targetCycleCount: 5 });

  // 4) Join Pool 2 (spend 1 upgrade credit)
  console.log('[autopool-seed] Joining Pool 2…');
  await joinNextPool({
    userId: genesis._id,
    targetPoolLevel: 2,
    idempotencyKey: 'local-seed-join-pool-2',
  });

  // 5) Finish Pool 1 → 15/15 + upgrade used → released (re-entry available)
  console.log('[autopool-seed] Advancing Pool 1 → cycle 15 (release)…');
  await advanceCycles({ userId: genesis._id, poolLevel: 1, targetCycleCount: 15 });

  // 6) Advance Pool 2 → cycle 5 (Join Pool 3 ready)
  console.log('[autopool-seed] Advancing Pool 2 → cycle 5…');
  await advanceCycles({ userId: genesis._id, poolLevel: 2, targetCycleCount: 5 });

  // Refresh wallet display after cycle rewards
  const freshGenesis = await User.findById(genesis._id);
  const summary = await summarizeUser(genesis._id);

  const p1 = summary.parts.find((p) => p.poolLevel === 1);
  const p2 = summary.parts.find((p) => p.poolLevel === 2);
  const joinP3 = summary.eligs.find(
    (e) => e.targetPoolLevel === 3 && e.status === 'AVAILABLE'
  );

  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║           AUTOPOOL DEMO USER — READY TO LOGIN            ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');
  console.log('Login (mobile app)');
  console.log('  Email:    ', GENESIS_EMAIL);
  console.log('  Password: ', PASSWORD_PLAIN);
  console.log('  Name:     ', freshGenesis.name);
  console.log('  Phone:    ', freshGenesis.phone);
  console.log('  Serial #: ', freshGenesis.serialNumber, '(share this SN when others join Autopool)');
  console.log('  Package:  Basic (required for manual Pool 1 entry)');
  console.log('  Dream Mart (eCart) wallet:', Number(freshGenesis.wallets?.eCartWallet || 0).toFixed(2));
  console.log('');
  console.log('How she got here (logical timeline)');
  console.log('  • Bought DreamMart package → bootstrap as first Autopool user → Pool 1');
  console.log('  • 4 friends joined with her SN → +4 upgrade credits');
  console.log('  • Pool 1 hit cycle 5 → she joined Pool 2 (−1 credit)');
  console.log('  • Pool 1 finished 15/15 with upgrade used → Pool 1 RELEASED');
  console.log('  • Pool 2 hit cycle 5 → Join Pool 3 is available now');
  console.log('');
  console.log('Situations visible on her Autopool dashboard');
  console.log(
    '  Pool 1:',
    p1
      ? `${p1.status} cycles ${p1.cycleCount}/15 released=${Boolean(p1.releasedAt)} upgradeUsed=${Boolean(p1.upgradeUsedAt)}`
      : 'missing'
  );
  console.log(
    '  Pool 2:',
    p2
      ? `${p2.status} cycles ${p2.cycleCount}/15 released=${Boolean(p2.releasedAt)}`
      : 'missing'
  );
  console.log('  Join Pool 1 (re-entry): available (P1 released; needs Dream Points + active referrer SN)');
  console.log('  Join Pool 3:          ', joinP3 ? 'AVAILABLE / Ready now' : 'missing');
  console.log('  Upgrade credits:     ', summary.credits?.balance ?? 0, '(4 referrals − 1 join P2)');
  console.log('  Autopool referrals:  ', summary.referrals.length);
  console.log('');
  console.log('Supporting logins (same password), also in Autopool via Priya’s SN:');
  for (const j of REFERRAL_JOINERS) {
    console.log(`  ${j.email.padEnd(28)} ${j.name}`);
  }
  console.log('');

  return {
    genesis: freshGenesis,
    summary,
  };
}

module.exports = { seedAutopoolLocal, GENESIS_EMAIL, GENESIS_SN, PASSWORD_PLAIN };

if (require.main === module) {
  seedAutopoolLocal()
    .then(() => mongoose.disconnect())
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[autopool-seed] failed:', err);
      mongoose.disconnect().finally(() => process.exit(1));
    });
}
