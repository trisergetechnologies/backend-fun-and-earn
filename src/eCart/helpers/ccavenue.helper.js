const crypto = require('crypto');
require('dotenv').config();

const CCAVENUE_MERCHANT_ID = process.env.CCAVENUE_MERCHANT_ID;
const CCAVENUE_ACCESS_CODE = process.env.CCAVENUE_ACCESS_CODE;
const CCAVENUE_WORKING_KEY = process.env.CCAVENUE_WORKING_KEY;
const CCAVENUE_ENV = (process.env.CCAVENUE_ENV || 'live').toLowerCase();
const BACKEND_URL = (process.env.BACKEND_URL || 'https://amp-api.mpdreams.in/api/v1').replace(/\/$/, '');
const CCAVENUE_LIVE_URL = 'https://secure.ccavenue.com/transaction/transaction.do?command=initiateTransaction';
const CCAVENUE_TEST_URL = 'https://test.ccavenue.com/transaction/transaction.do?command=initiateTransaction';

const PAYMENT_GATEWAY = (process.env.PAYMENT_GATEWAY || 'razorpay').toLowerCase();

const INIT_VECTOR = Buffer.from([
  0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07,
  0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f
]);

function hextobin(hexString) {
  const length = hexString.length;
  let binString = '';
  for (let count = 0; count < length; count += 2) {
    const subString = hexString.substring(count, count + 2);
    binString += String.fromCharCode(parseInt(subString, 16));
  }
  return binString;
}

function pkcs5Pad(plainText, blockSize) {
  const pad = blockSize - (plainText.length % blockSize);
  return plainText + String.fromCharCode(pad).repeat(pad);
}

function pkcs5Unpad(plainText) {
  const pad = plainText.charCodeAt(plainText.length - 1);
  return plainText.slice(0, -pad);
}

function getSecretKey(workingKey) {
  return Buffer.from(hextobin(crypto.createHash('md5').update(workingKey).digest('hex')), 'binary');
}

function encrypt(plainText, workingKey) {
  const secretKey = getSecretKey(workingKey);
  const plainPad = pkcs5Pad(plainText, 16);
  const cipher = crypto.createCipheriv('aes-128-cbc', secretKey, INIT_VECTOR);
  let encrypted = cipher.update(plainPad, 'utf8', 'binary');
  encrypted += cipher.final('binary');
  return Buffer.from(encrypted, 'binary').toString('hex');
}

function decrypt(encryptedHex, workingKey) {
  const secretKey = getSecretKey(workingKey);
  const encryptedText = Buffer.from(hextobin(encryptedHex), 'binary');
  const decipher = crypto.createDecipheriv('aes-128-cbc', secretKey, INIT_VECTOR);
  let decrypted = decipher.update(encryptedText, undefined, 'utf8');
  decrypted += decipher.final('utf8');
  return pkcs5Unpad(decrypted);
}

function getTransactionBaseUrl() {
  return CCAVENUE_ENV === 'live' ? CCAVENUE_LIVE_URL : CCAVENUE_TEST_URL;
}

function getCallbackUrls() {
  return {
    redirectUrl: `${BACKEND_URL}/public/ccavenue/callback`,
    cancelUrl: `${BACKEND_URL}/public/ccavenue/cancel`
  };
}

function parseDecryptedResponse(decrypted) {
  const params = {};
  decrypted.split('&').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const key = pair.slice(0, idx);
    const value = decodeURIComponent(pair.slice(idx + 1).replace(/\+/g, ' '));
    params[key] = value;
  });
  return params;
}

function buildOrderParams({ orderId, amount, currency, billing, merchantParam1, merchantParam2 }) {
  const { redirectUrl, cancelUrl } = getCallbackUrls();

  const params = {
    merchant_id: CCAVENUE_MERCHANT_ID,
    order_id: String(orderId),
    amount: Number(amount).toFixed(2),
    currency: currency || 'INR',
    redirect_url: redirectUrl,
    cancel_url: cancelUrl,
    language: 'EN',
    billing_name: billing.name || 'Customer',
    billing_address: billing.address || 'NA',
    billing_city: billing.city || 'NA',
    billing_state: billing.state || 'NA',
    billing_zip: billing.zip || '000000',
    billing_country: billing.country || 'India',
    billing_tel: billing.phone || '9999999999',
    billing_email: billing.email || 'customer@dreammart.com',
    delivery_name: billing.name || 'Customer',
    delivery_address: billing.address || 'NA',
    delivery_city: billing.city || 'NA',
    delivery_state: billing.state || 'NA',
    delivery_zip: billing.zip || '000000',
    delivery_country: billing.country || 'India',
    delivery_tel: billing.phone || '9999999999',
    merchant_param1: merchantParam1 || '',
    merchant_param2: merchantParam2 || ''
  };

  return params;
}

function buildMerchantDataString(params) {
  return Object.entries(params)
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
}

function buildPaymentPageUrl(params) {
  const merchantData = buildMerchantDataString(params);
  const encRequest = encrypt(merchantData, CCAVENUE_WORKING_KEY);
  const baseUrl = getTransactionBaseUrl();
  const query = new URLSearchParams({
    encRequest,
    access_code: CCAVENUE_ACCESS_CODE
  });
  return `${baseUrl}&${query.toString()}`;
}

function generateCcavenueOrderId(paymentIntentId) {
  const suffix = paymentIntentId.toString().slice(-10).replace(/[^0-9]/g, '0');
  return `${Date.now().toString().slice(-6)}${suffix}`.slice(0, 20);
}

/** Client-requested gateway; defaults to razorpay when omitted (old app builds). */
function normalizePaymentGateway(gateway) {
  const value = String(gateway ?? 'razorpay').toLowerCase().trim();
  return value === 'ccavenue' ? 'ccavenue' : 'razorpay';
}

function isCcavenueGateway(gateway) {
  return normalizePaymentGateway(gateway) === 'ccavenue';
}

/** @deprecated Use isCcavenueGateway(paymentGateway) — env flag no longer drives checkout routing */
function isCcavenueEnabled() {
  return PAYMENT_GATEWAY === 'ccavenue';
}

function assertCcavenueConfig() {
  if (!CCAVENUE_MERCHANT_ID || !CCAVENUE_ACCESS_CODE || !CCAVENUE_WORKING_KEY) {
    throw new Error('CCAvenue credentials are not configured');
  }
}

module.exports = {
  CCAVENUE_MERCHANT_ID,
  CCAVENUE_ACCESS_CODE,
  CCAVENUE_WORKING_KEY,
  CCAVENUE_ENV,
  BACKEND_URL,
  CCAVENUE_LIVE_URL,
  CCAVENUE_TEST_URL,
  PAYMENT_GATEWAY,
  encrypt,
  decrypt,
  getTransactionBaseUrl,
  getCallbackUrls,
  parseDecryptedResponse,
  buildOrderParams,
  buildPaymentPageUrl,
  generateCcavenueOrderId,
  normalizePaymentGateway,
  isCcavenueGateway,
  isCcavenueEnabled,
  assertCcavenueConfig
};
