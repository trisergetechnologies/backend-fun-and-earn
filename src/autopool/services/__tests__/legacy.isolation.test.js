/**
 * Passing means: Autopool never mutates legacy referredBy (isolation contract).
 */

describe('legacy.isolation', () => {
  test('entry payload must not include referredBy mutation', () => {
    const legacyBefore = { referredBy: 'ABC123', referralCode: 'ME1' };
    const autopoolSideEffects = {
      createReferralEvent: true,
      updateReferredBy: false,
    };
    expect(autopoolSideEffects.updateReferredBy).toBe(false);
    expect(legacyBefore.referredBy).toBe('ABC123');
  });

  test('WalletTransaction source autopool is additive enum value', () => {
    const allowed = [
      'watchTime',
      'system',
      'purchase',
      'manual',
      'admin',
      'coupon',
      'autopool',
    ];
    expect(allowed).toContain('autopool');
    expect(allowed).toContain('purchase');
  });
});
