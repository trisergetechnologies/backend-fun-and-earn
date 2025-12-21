// ================================================================
// FILE: helpers/orangePG.helper.js
// Orange PG Utility Functions
// ================================================================

const crypto = require('crypto');
const axios = require('axios');
require('dotenv').config();

const ORANGE_MERCHANT_ID = process.env.ORANGE_MERCHANT_ID; // T_03342
const ORANGE_MERCHANT_SECRET = process.env.ORANGE_MERCHANT_SECRET; // abc
const ORANGE_BASE_URL = process.env.ORANGE_BASE_URL || 'https://qa.phicommerce.com';

/**
 * Generate HMAC-SHA256 hash for Orange PG
 * @param {Object} params - Request parameters
 * @param {String} secretKey - Merchant secret key
 * @returns {String} Lowercase hex hash
 */
function generateOrangeHash(params, secretKey) {
  // Step 1: Sort keys alphabetically
  const sortedKeys = Object.keys(params).sort();
  
  // Step 2: Concatenate values (skip null/empty/undefined)
  const concatenated = sortedKeys
    .filter(key => {
      const value = params[key];
      return value !== null && value !== undefined && value !== '';
    })
    .map(key => params[key])
    .join('');

  // Step 3: HMAC-SHA256
  const hmac = crypto.createHmac('sha256', secretKey);
  hmac.update(concatenated, 'ascii');
  
  // Step 4: Convert to hex and lowercase
  return hmac.digest('hex').toLowerCase();
}

/**
 * Generate current txnDate in Orange PG format
 * @returns {String} YYYYMMDDHHmmssSSS
 */
function generateTxnDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  const ms = String(now.getMilliseconds()).padStart(3, '0');
  
  return `${year}${month}${day}${hours}${minutes}${seconds}${ms}`;
}

/**
 * Call Orange PG initiateSale API
 * @param {Object} saleData - Sale request parameters
 * @returns {Promise<Object>} Orange PG response
 */
async function callOrangeInitiateSale(saleData) {
  try {
    const response = await axios.post(
      `${ORANGE_BASE_URL}/pg/api/v2/initiateSale`,
      saleData,
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 30000 // 30 seconds
      }
    );
    
    return response.data;
  } catch (error) {
    console.error('[Orange PG] initiateSale error:', error.response?.data || error.message);
    throw new Error(error.response?.data?.responseDescription || 'Orange PG API call failed');
  }
}

/**
 * Call Orange PG status check API
 * @param {String} merchantTxnNo - Original transaction reference
 * @returns {Promise<Object>} Status response
 */
async function callOrangeStatusCheck(merchantTxnNo) {
  try {
    const statusParams = {
      merchantID: ORANGE_MERCHANT_ID,
      merchantTxnNo: merchantTxnNo,
      originalTxnNo: merchantTxnNo,
      transactionType: 'STATUS'
    };
    
    statusParams.secureHash = generateOrangeHash(statusParams, ORANGE_MERCHANT_SECRET);
    
    const response = await axios.post(
      `${ORANGE_BASE_URL}/pg/api/command`,
      new URLSearchParams(statusParams).toString(),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 30000
      }
    );
    
    return response.data;
  } catch (error) {
    console.error('[Orange PG] Status check error:', error.response?.data || error.message);
    throw new Error('Orange PG status check failed');
  }
}

/**
 * Verify Orange PG callback hash
 * @param {Object} params - Callback parameters
 * @param {String} receivedHash - Hash from Orange PG
 * @returns {Boolean} True if valid
 */
function verifyOrangeHash(params, receivedHash) {
  const paramsWithoutHash = { ...params };
  delete paramsWithoutHash.secureHash;
  
  const calculatedHash = generateOrangeHash(paramsWithoutHash, ORANGE_MERCHANT_SECRET);
  
  return calculatedHash === receivedHash;
}

module.exports = {
  ORANGE_MERCHANT_ID,
  ORANGE_MERCHANT_SECRET,
  ORANGE_BASE_URL,
  generateOrangeHash,
  generateTxnDate,
  callOrangeInitiateSale,
  callOrangeStatusCheck,
  verifyOrangeHash
};