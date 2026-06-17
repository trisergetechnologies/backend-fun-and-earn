/**
 * Smoke test for CCAvenue helper encrypt/decrypt roundtrip.
 * Run: node scripts/test-ccavenue-helper.js
 */
const {
  encrypt,
  decrypt,
  buildOrderParams,
  buildPaymentPageUrl,
  getCallbackUrls,
  isCcavenueEnabled,
  PAYMENT_GATEWAY
} = require('../src/eCart/helpers/ccavenue.helper');

process.env.CCAVENUE_WORKING_KEY = process.env.CCAVENUE_WORKING_KEY || '0123456789ABCDEF0123456789ABCDEF';
process.env.CCAVENUE_MERCHANT_ID = process.env.CCAVENUE_MERCHANT_ID || '123456';
process.env.CCAVENUE_ACCESS_CODE = process.env.CCAVENUE_ACCESS_CODE || 'TESTACCESS';
process.env.BACKEND_URL = process.env.BACKEND_URL || 'https://example.ngrok-free.app/api/v1';

const workingKey = process.env.CCAVENUE_WORKING_KEY;
const plain = 'merchant_id=123456&order_id=999001&amount=10.00&currency=INR';

const encrypted = encrypt(plain, workingKey);
const decrypted = decrypt(encrypted, workingKey);

if (decrypted !== plain) {
  console.error('FAIL: encrypt/decrypt roundtrip mismatch');
  console.error('plain:', plain);
  console.error('decrypted:', decrypted);
  process.exit(1);
}

const urls = getCallbackUrls();
if (!urls.redirectUrl.includes('/public/ccavenue/callback')) {
  console.error('FAIL: unexpected callback URL', urls);
  process.exit(1);
}

const params = buildOrderParams({
  orderId: '999001',
  amount: 10,
  billing: { name: 'Test', email: 't@test.com', phone: '9999999999' },
  merchantParam1: 'order123',
  merchantParam2: 'intent456'
});

const pageUrl = buildPaymentPageUrl(params);
if (!pageUrl.includes('test.ccavenue.com') && process.env.CCAVENUE_ENV !== 'live') {
  if (!pageUrl.includes('ccavenue.com')) {
    console.error('FAIL: unexpected payment page URL', pageUrl);
    process.exit(1);
  }
}

console.log('PASS: CCAvenue helper smoke test');
console.log('  PAYMENT_GATEWAY:', PAYMENT_GATEWAY);
console.log('  isCcavenueEnabled:', isCcavenueEnabled());
console.log('  redirectUrl:', urls.redirectUrl);
console.log('  paymentPageUrl prefix:', pageUrl.slice(0, 80) + '...');
