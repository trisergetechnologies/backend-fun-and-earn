/**
 * Validates Indian GSTIN (15 characters) with format + checksum.
 * Format: 2 digit state + 10 char PAN + entity + Z + checksum
 */
const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function gstinChecksumChar(gstin14) {
  let factor = 2;
  let sum = 0;
  const mod = CHARS.length;

  for (let i = gstin14.length - 1; i >= 0; i -= 1) {
    const codePoint = CHARS.indexOf(gstin14[i]);
    if (codePoint < 0) return null;
    let addend = factor * codePoint;
    factor = factor === 2 ? 1 : 2;
    addend = Math.floor(addend / mod) + (addend % mod);
    sum += addend;
  }

  const checksum = (mod - (sum % mod)) % mod;
  return CHARS[checksum];
}

function isValidGstin(value) {
  if (!value || typeof value !== 'string') return false;
  const gstin = value.trim().toUpperCase();
  if (!GSTIN_REGEX.test(gstin)) return false;

  const expected = gstinChecksumChar(gstin.slice(0, 14));
  return expected !== null && expected === gstin[14];
}

module.exports = { isValidGstin, GSTIN_REGEX };
