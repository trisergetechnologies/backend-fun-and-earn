/**
 * Local dev seed: drops DB, then creates admin + seller + user (+ sample catalog).
 *
 * Usage (from backend-fun-and-earn):
 *   npm run db:seed:local
 *
 * Requires MONGO_URI in .env (default: mongodb://127.0.0.1:27017/fun_n_earn_db).
 * Only runs when NODE_ENV=development or SEED_ALLOW_DROP=true.
 */

const path = require('path');
const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env'), override: true });

const { hashPassword } = require('../src/utils/bcrypt');
const User = require('../src/models/User');
const Category = require('../src/eCart/models/Category');
const Product = require('../src/eCart/models/Product');
const Settings = require('../src/models/Settings');

const PASSWORD_PLAIN = 'Test@1234';

const ACCOUNTS = {
  admin: {
    email: 'admin@local.test',
    phone: '919911110001',
    name: 'Local Admin',
    role: 'admin',
    gender: 'other',
    applications: ['eCart'],
    referralCode: 'locadm01',
  },
  seller: {
    email: 'seller@local.test',
    phone: '919911110002',
    name: 'Local Test Seller Co',
    role: 'seller',
    gender: 'male',
    applications: ['eCart'],
    referralCode: 'locsel01',
    sellerDetails: {
      gstin: '29ABBCA7044H1ZN',
      contactPersonName: 'Ravi Kumar',
      street: '42 MG Road',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560001',
    },
  },
  user: {
    email: 'user@local.test',
    phone: '919911110003',
    name: 'Local Test User',
    role: 'user',
    gender: 'male',
    applications: ['eCart'],
    state_address: 'Karnataka',
    referralCode: 'locusr01',
  },
};

async function assertSafeToDrop() {
  const uri = process.env.MONGO_URI || '';
  const allow = process.env.SEED_ALLOW_DROP === 'true';
  const isDev = process.env.NODE_ENV === 'development';

  if (!uri) {
    throw new Error('MONGO_URI is not set in .env');
  }

  if (!isDev && !allow) {
    throw new Error(
      'Refusing to drop database: set NODE_ENV=development or SEED_ALLOW_DROP=true'
    );
  }

  const blockedHosts = ['mongodb.net', 'atlas', 'prod', 'production'];
  const lower = uri.toLowerCase();
  if (blockedHosts.some((h) => lower.includes(h)) && !allow) {
    throw new Error(
      'Refusing to drop a remote-looking MongoDB URI. Set SEED_ALLOW_DROP=true only if you are sure.'
    );
  }
}

async function seed() {
  await assertSafeToDrop();

  const uri = process.env.MONGO_URI;
  console.log('Connecting to', uri);
  await mongoose.connect(uri);

  const dbName = mongoose.connection.name;
  console.log(`Dropping database: ${dbName}`);
  await mongoose.connection.dropDatabase();

  const passwordHash = await hashPassword(PASSWORD_PLAIN);

  const baseUser = {
    password: passwordHash,
    isActive: true,
    token: 'jwt_token',
    wallets: { shortVideoWallet: 0, eCartWallet: 0, rewardWallet: [] },
    eCartProfile: { addresses: [], orders: [], bankDetails: null },
    shortVideoProfile: { watchTime: 0, videoUploads: [] },
  };

  const admin = await User.create({ ...baseUser, ...ACCOUNTS.admin });
  const seller = await User.create({ ...baseUser, ...ACCOUNTS.seller });
  const user = await User.create({
    ...baseUser,
    ...ACCOUNTS.user,
    eCartProfile: {
      addresses: [
        {
          addressName: 'Home',
          slugName: 'home-default',
          fullName: ACCOUNTS.user.name,
          street: '12 Residency Road',
          city: 'Bengaluru',
          state: 'Karnataka',
          pincode: '560025',
          phone: ACCOUNTS.user.phone,
          isDefault: true,
        },
      ],
      orders: [],
      bankDetails: null,
    },
    wallets: { shortVideoWallet: 0, eCartWallet: 50, rewardWallet: [] },
  });

  await Settings.create({
    minWithdrawalAmount: 1000,
    autoSyncDays: 3,
    monthlyPayoutDay: 30,
    referralBonus: 0,
    deliveryMode: 'no_charge',
    deliveryChargeAmount: 0,
    freeDeliveryAbove: 500,
    adsDailyInterstitialLimit: 5,
    adsBannerEnabled: true,
    createdBy: admin._id,
  });

  const category = await Category.create({
    title: 'General',
    slug: 'general',
    description: 'Default local test category',
    ownerId: admin._id,
    ownerRole: 'admin',
    isActive: true,
  });

  await Product.create([
    {
      sellerId: seller._id,
      categoryId: category._id,
      title: 'Seller Sample Product',
      description: 'Seeded product owned by the local seller account.',
      images: [
        'https://placehold.co/400x400/png?text=Image+1',
        'https://placehold.co/400x400/png?text=Image+2',
      ],
      price: 499,
      discountPercent: 10,
      finalPrice: 449.1,
      gst: 0.05,
      stock: 25,
      isActive: true,
      isSpecial: false,
      createdByRole: 'seller',
      variations: [{ name: 'Size', options: ['S', 'M', 'L'] }],
    },
    {
      sellerId: admin._id,
      categoryId: category._id,
      title: 'Admin Sample Product',
      description: 'Seeded product for admin dashboard product list/filter tests.',
      images: ['https://placehold.co/400x400/png?text=Admin+Product'],
      price: 999,
      discountPercent: 0,
      finalPrice: 999,
      gst: 0.05,
      stock: 10,
      isActive: true,
      isSpecial: false,
      createdByRole: 'admin',
      variations: [],
    },
  ]);

  console.log('\n=== Local role seed complete ===\n');
  console.log('Dashboard: http://localhost:3000/signin');
  console.log('API:       http://localhost:5000/api/v1');
  console.log('Password for all accounts:', PASSWORD_PLAIN);
  console.log('');
  console.log('Admin  →', ACCOUNTS.admin.email, '(role: admin,  → /admin)');
  console.log('Seller →', ACCOUNTS.seller.email, '(role: seller, → /seller/product)');
  console.log('User   →', ACCOUNTS.user.email, '(role: user,   mobile app only — not web dashboard)');
  console.log('');
  console.log('IDs:');
  console.log('  admin:    ', admin._id.toString());
  console.log('  seller:   ', seller._id.toString());
  console.log('  user:     ', user._id.toString());
  console.log('  category: ', category._id.toString());
}

seed()
  .then(() => mongoose.disconnect())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Seed failed:', err);
    mongoose.disconnect().finally(() => process.exit(1));
  });
