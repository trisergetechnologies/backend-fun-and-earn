/**
 * Local: enable shortVideo on user@local.test (+ packages + wallet).
 *
 * Usage (from backend-fun-and-earn):
 *   npm run db:seed:shortvideo
 *   node scripts/seed-shortvideo-user.js
 *
 * Does NOT drop the DB.
 */
const path = require('path');
const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env'), override: true });

const User = require('../src/models/User');
const Package = require('../src/models/Package');

const TARGET_EMAIL = process.env.SEED_SV_EMAIL || 'user@local.test';
const ROOT_EMAIL = 'svroot@local.test';
const PASSWORD_NOTE =
  'Existing password unchanged (seed uses Test@1234 for user@local.test)';

const PACKAGE_DEFS = [
  {
    name: 'Basic',
    price: 500,
    membersUpto: 2,
    levelUpto: 1,
    color: '#94a3b8',
    icon: 'star',
  },
  {
    name: 'Starter',
    price: 1500,
    membersUpto: 5,
    levelUpto: 3,
    color: '#38bdf8',
    icon: 'flash',
  },
  {
    name: 'Gold',
    price: 5000,
    membersUpto: 10,
    levelUpto: 5,
    color: '#f59e0b',
    icon: 'trophy',
  },
  {
    name: 'Diamond',
    price: 10000,
    membersUpto: 20,
    levelUpto: 10,
    color: '#a78bfa',
    icon: 'diamond',
  },
];

async function ensurePackages() {
  const out = {};
  for (const def of PACKAGE_DEFS) {
    const pkg = await Package.findOneAndUpdate(
      { name: def.name },
      {
        $set: {
          ...def,
          isActive: true,
          description: `${def.name} package (local seed)`,
        },
      },
      { upsert: true, new: true }
    );
    out[def.name] = pkg;
  }
  return out;
}

async function ensureRoot(packages) {
  let root = await User.findOne({ email: ROOT_EMAIL });
  if (!root) {
    const donor = await User.findOne({ email: TARGET_EMAIL }).select('password');
    root = await User.create({
      name: 'SV Root Sponsor',
      email: ROOT_EMAIL,
      phone: '919911110099',
      password:
        donor?.password ||
        '$2a$10$invalidplaceholderhashforlocalonlyxx',
      gender: 'other',
      role: 'user',
      applications: ['shortVideo', 'eCart'],
      referralCode: 'svroot01',
      referredBy: null,
      package: packages.Diamond._id,
      serialNumber: 1,
      isActive: true,
      wallets: { shortVideoWallet: 100000, eCartWallet: 0, rewardWallet: [] },
      shortVideoProfile: { watchTime: 0, videoUploads: [] },
      eCartProfile: { addresses: [], orders: [], bankDetails: null },
    });
  } else {
    root.applications = Array.from(
      new Set([...(root.applications || []), 'shortVideo', 'eCart'])
    );
    root.package = packages.Diamond._id;
    if (!root.serialNumber) root.serialNumber = 1;
    if (!root.referralCode) root.referralCode = 'svroot01';
    await root.save();
  }
  return root;
}

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI missing in .env');
  if (
    process.env.NODE_ENV !== 'development' &&
    process.env.SEED_ALLOW_DROP !== 'true'
  ) {
    throw new Error('Set NODE_ENV=development to run this local script');
  }

  await mongoose.connect(uri);
  const packages = await ensurePackages();
  const root = await ensureRoot(packages);

  const user = await User.findOne({ email: TARGET_EMAIL });
  if (!user) {
    throw new Error(
      `User ${TARGET_EMAIL} not found. Run npm run db:seed:local first.`
    );
  }

  user.applications = Array.from(
    new Set([...(user.applications || []), 'shortVideo', 'eCart'])
  );
  user.referredBy = root.referralCode;
  user.package = packages.Starter._id;
  if (!user.serialNumber) {
    const last = await User.findOne({ serialNumber: { $ne: null } })
      .sort({ serialNumber: -1 })
      .select('serialNumber');
    user.serialNumber = (last?.serialNumber || 1) + 1;
  }
  user.wallets = user.wallets || {};
  user.wallets.shortVideoWallet = Math.max(
    Number(user.wallets.shortVideoWallet) || 0,
    10000
  );
  user.isActive = true;
  if (!user.shortVideoProfile) {
    user.shortVideoProfile = { watchTime: 0, videoUploads: [] };
  }
  await user.save();

  console.log('\n=== Short Video user updated ===\n');
  console.log('Login (Fun & Enjoy):', TARGET_EMAIL);
  console.log(PASSWORD_NOTE);
  console.log('applications:', user.applications);
  console.log('package:     Starter');
  console.log('referredBy:  ', root.referralCode, `(${ROOT_EMAIL})`);
  console.log('serialNumber:', user.serialNumber);
  console.log('F&E Points:  ', user.wallets.shortVideoWallet);
  console.log('Sponsor code for new registers:', root.referralCode);
}

main()
  .then(() => mongoose.disconnect())
  .then(() => process.exit(0))
  .catch(async (e) => {
    console.error(e);
    try {
      await mongoose.disconnect();
    } catch {
      /* ignore */
    }
    process.exit(1);
  });
