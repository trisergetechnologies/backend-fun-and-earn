/**
 * GSTIN is optional and stored as a plain string.
 * Only enforces a max character length when a value is provided.
 */
const GSTIN_MAX_LENGTH = 15;

/**
 * @param {unknown} value
 * @returns {{ ok: true, value: string } | { ok: false, message: string }}
 */
function normalizeGstin(value) {
  if (value == null || value === '') {
    return { ok: true, value: '' };
  }
  if (typeof value !== 'string') {
    return { ok: false, message: 'GSTIN must be a string' };
  }

  const gstin = value.trim();
  if (!gstin) {
    return { ok: true, value: '' };
  }

  if (gstin.length > GSTIN_MAX_LENGTH) {
    return {
      ok: false,
      message: `GSTIN must be at most ${GSTIN_MAX_LENGTH} characters`,
    };
  }

  return { ok: true, value: gstin };
}

module.exports = { normalizeGstin, GSTIN_MAX_LENGTH };
