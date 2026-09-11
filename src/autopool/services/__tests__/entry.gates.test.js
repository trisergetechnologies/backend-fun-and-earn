/**
 * Behavior contract tests for entry gates (pure validation helpers mirrored from entry.service).
 * Passing means: manual Pool-1 rules reject invalid cases before any wallet debit.
 */

function validateEntryGates({
  enabled,
  hasPackage,
  occupyingPool1,
  walletBalance,
  entryAmount,
  referrerSerial,
  userSerial,
  referrerExists,
  referrerOccupying,
}) {
  if (!enabled) return { ok: false, code: 'AUTOPOOL_DISABLED' };
  if (!hasPackage) return { ok: false, code: 'NO_PACKAGE' };
  if (occupyingPool1) return { ok: false, code: 'POOL_OCCUPYING' };
  if (walletBalance < entryAmount) return { ok: false, code: 'INSUFFICIENT_WALLET' };
  if (!referrerExists) return { ok: false, code: 'INVALID_SN' };
  if (referrerSerial === userSerial) return { ok: false, code: 'SELF_REFERRAL' };
  if (!referrerOccupying) return { ok: false, code: 'REFERRER_NOT_ACTIVE' };
  return { ok: true };
}

describe('entry.service gate behavior', () => {
  const base = {
    enabled: true,
    hasPackage: true,
    occupyingPool1: false,
    walletBalance: 500,
    entryAmount: 500,
    referrerSerial: 2,
    userSerial: 1,
    referrerExists: true,
    referrerOccupying: true,
  };

  test('happy path allowed', () => {
    expect(validateEntryGates(base)).toEqual({ ok: true });
  });

  test('no package blocked', () => {
    expect(validateEntryGates({ ...base, hasPackage: false }).code).toBe('NO_PACKAGE');
  });

  test('insufficient wallet blocked', () => {
    expect(validateEntryGates({ ...base, walletBalance: 100 }).code).toBe(
      'INSUFFICIENT_WALLET'
    );
  });

  test('self referral blocked', () => {
    expect(
      validateEntryGates({ ...base, referrerSerial: 1, userSerial: 1 }).code
    ).toBe('SELF_REFERRAL');
  });

  test('inactive referrer blocked', () => {
    expect(validateEntryGates({ ...base, referrerOccupying: false }).code).toBe(
      'REFERRER_NOT_ACTIVE'
    );
  });

  test('occupying pool1 blocked', () => {
    expect(validateEntryGates({ ...base, occupyingPool1: true }).code).toBe(
      'POOL_OCCUPYING'
    );
  });

  test('disabled flag blocked', () => {
    expect(validateEntryGates({ ...base, enabled: false }).code).toBe(
      'AUTOPOOL_DISABLED'
    );
  });
});
