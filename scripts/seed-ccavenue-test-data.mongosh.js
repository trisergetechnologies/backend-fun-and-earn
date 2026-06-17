/**
 * Seed Dream Mart eCart data for local CCAvenue payment testing.
 *
 * Usage:
 *   mongosh "mongodb://127.0.0.1:27017/fun_n_earn_db" --file scripts/seed-ccavenue-test-data.mongosh.js
 *
 * Login after seed:
 *   email:    ccavenue.buyer@dreammart.local
 *   password: Test@1234
 */

const DB_NAME = 'fun_n_earn_db';
const BUYER_EMAIL = 'buyer@dream.local';
const ADMIN_EMAIL = 'admin@dream.local';
// bcrypt hash for "Test@1234" (10 rounds)
const PASSWORD_HASH = '$2b$10$b6ThXHG323TI//XQMpdQQuWT7762Bm16ggU83Q6soi8QEvRMprziK';
const now = new Date();

db = db.getSiblingDB(DB_NAME);

function upsertUser(filter, doc) {
  const existing = db.users.findOne(filter);
  if (existing) {
    db.users.updateOne({ _id: existing._id }, { $set: { ...doc, updatedAt: now } });
    return existing._id;
  }
  const _id = new ObjectId();
  db.users.insertOne({ _id, ...doc, createdAt: now, updatedAt: now });
  return _id;
}

function upsertCategory(filter, doc) {
  const existing = db.categories.findOne(filter);
  if (existing) {
    db.categories.updateOne({ _id: existing._id }, { $set: { ...doc, updatedAt: now } });
    return existing._id;
  }
  const _id = new ObjectId();
  db.categories.insertOne({ _id, ...doc, createdAt: now, updatedAt: now });
  return _id;
}

function upsertProduct(filter, doc) {
  const existing = db.products.findOne(filter);
  if (existing) {
    db.products.updateOne({ _id: existing._id }, { $set: { ...doc, updatedAt: now } });
    return existing._id;
  }
  const _id = new ObjectId();
  db.products.insertOne({ _id, ...doc, createdAt: now, updatedAt: now });
  return _id;
}

function upsertPackage(filter, doc) {
  const existing = db.packages.findOne(filter);
  if (existing) {
    db.packages.updateOne({ _id: existing._id }, { $set: { ...doc, updatedAt: now } });
    return existing._id;
  }
  const _id = new ObjectId();
  db.packages.insertOne({ _id, ...doc, createdAt: now, updatedAt: now });
  return _id;
}

print('=== Dream Mart CCAvenue test seed ===');
print('Database: ' + DB_NAME);

// --- Admin / seller (product owner) ---
const adminId = upsertUser(
  { email: ADMIN_EMAIL },
  {
    name: 'CCAvenue Admin',
    email: ADMIN_EMAIL,
    phone: '919900000001',
    password: PASSWORD_HASH,
    gender: 'other',
    role: 'admin',
    applications: ['eCart'],
    state_address: 'Maharashtra',
    referralCode: 'ccad9001',
    wallets: { shortVideoWallet: 0, eCartWallet: 0, rewardWallet: [] },
    isActive: true,
    token: 'jwt_token',
    eCartProfile: { addresses: [], orders: [] },
    shortVideoProfile: { watchTime: 0, videoUploads: [] }
  }
);

// --- Buyer (use this account in the app) ---
const buyerId = upsertUser(
  { email: BUYER_EMAIL },
  {
    name: 'CCAvenue Test Buyer',
    email: BUYER_EMAIL,
    phone: '919900000002',
    password: PASSWORD_HASH,
    gender: 'male',
    role: 'user',
    applications: ['eCart'],
    state_address: 'Maharashtra',
    referralCode: 'ccby9002',
    wallets: { shortVideoWallet: 0, eCartWallet: 100, rewardWallet: [] },
    isActive: true,
    token: 'jwt_token',
    eCartProfile: {
      addresses: [
        {
          addressName: 'Home',
          slugName: 'home-default',
          fullName: 'CCAvenue Test Buyer',
          street: '12 Test Lane, Andheri East',
          city: 'Mumbai',
          state: 'Maharashtra',
          pincode: '400069',
          phone: '919900000002',
          isDefault: true
        }
      ],
      orders: []
    },
    shortVideoProfile: { watchTime: 0, videoUploads: [] }
  }
);

// --- eCart settings (free delivery for easier checkout totals) ---
db.settings.deleteMany({});
db.settings.insertOne({
  minWithdrawalAmount: 1000,
  autoSyncDays: 3,
  monthlyPayoutDay: 30,
  referralBonus: 0,
  deliveryMode: 'no_charge',
  deliveryChargeAmount: 0,
  freeDeliveryAbove: 500,
  adsDailyInterstitialLimit: 5,
  adsBannerEnabled: true,
  createdBy: adminId,
  updatedAt: now
});

// --- Category ---
const categoryId = upsertCategory(
  { slug: 'ccavenue-test' },
  {
    title: 'CCAvenue Test Catalog',
    slug: 'ccavenue-test',
    description: 'Products for local payment gateway testing',
    ownerId: adminId,
    ownerRole: 'admin',
    isActive: true
  }
);

// --- Optional package for special-product / package-buy flow ---
const starterPackageId = upsertPackage(
  { name: 'Starter' },
  {
    name: 'Starter',
    price: 199,
    membersUpto: 5,
    levelUpto: 3,
    description: 'Starter package for special product checkout tests',
    icon: 'rocket-outline',
    color: '#a78bfa',
    isActive: true
  }
);

// --- Products ---
const productIds = [];

productIds.push(upsertProduct(
  { title: 'DreamMart Cotton T-Shirt', sellerId: adminId },
  {
    sellerId: adminId,
    categoryId,
    title: 'DreamMart Cotton T-Shirt',
    description: 'Comfortable cotton tee for checkout smoke tests.',
    images: ['https://placehold.co/400x400/png?text=T-Shirt'],
    price: 10,
    discountPercent: 10,
    finalPrice: 1,
    gst: 0.05,
    stock: 50,
    isActive: true,
    isSpecial: false,
    createdByRole: 'admin',
    variations: [{ name: 'Size', options: ['S', 'M', 'L', 'XL'] }]
  }
));

productIds.push(upsertProduct(
  { title: 'Wireless Earbuds Pro', sellerId: adminId },
  {
    sellerId: adminId,
    categoryId,
    title: 'Wireless Earbuds Pro',
    description: 'Mid-range earbuds — good for ~₹1.3k payment tests.',
    images: ['https://placehold.co/400x400/png?text=Earbuds'],
    price: 1299,
    discountPercent: 0,
    finalPrice: 2,
    gst: 0.18,
    stock: 25,
    isActive: true,
    isSpecial: false,
    createdByRole: 'admin',
    variations: []
  }
));

productIds.push(upsertProduct(
  { title: 'Organic Green Tea (100g)', sellerId: adminId },
  {
    sellerId: adminId,
    categoryId,
    title: 'Organic Green Tea (100g)',
    description: 'Low-ticket item for quick payment retries.',
    images: ['https://placehold.co/400x400/png?text=Green+Tea'],
    price: 249,
    discountPercent: 5,
    finalPrice: 2,
    gst: 0.05,
    stock: 100,
    isActive: true,
    isSpecial: false,
    createdByRole: 'admin',
    variations: []
  }
));

productIds.push(upsertProduct(
  { title: 'Starter Package (Special)', sellerId: adminId },
  {
    sellerId: adminId,
    categoryId,
    title: 'Starter Package (Special)',
    description: 'Special product — triggers package-buy cron after paid order.',
    images: ['https://placehold.co/400x400/png?text=Starter+Pkg'],
    price: 199,
    discountPercent: 0,
    finalPrice: 199,
    gst: 0.05,
    stock: 999,
    isActive: true,
    isSpecial: true,
    package: starterPackageId,
    createdByRole: 'admin',
    variations: []
  }
));

// --- Pre-filled cart for buyer (2 items) ---
db.carts.deleteMany({ userId: buyerId });
db.carts.insertOne({
  userId: buyerId,
  items: [
    { productId: productIds[0], quantity: 1, selectedVariation: [{ name: 'Size', value: 'M' }] },
    { productId: productIds[2], quantity: 2, selectedVariation: [] }
  ],
  totalGstAmount: 0,
  deliveryCharge: 0,
  useWallet: false,
  createdAt: now,
  updatedAt: now
});

print('');
print('Seed complete.');
print('');
print('Buyer login (Dream Mart app, loginApp=eCart):');
print('  email:    ' + BUYER_EMAIL);
print('  password: Test@1234');
print('');
print('Default delivery address slug: home-default');
print('');
print('Product IDs:');
productIds.forEach((id, i) => print('  [' + i + '] ' + id));
print('');
print('Cart ready for POST /ecart/user/order/createorderintent with deliverySlug=home-default');
