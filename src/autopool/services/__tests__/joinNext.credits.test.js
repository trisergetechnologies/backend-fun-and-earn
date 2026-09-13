/**
 * Passing means: join-next requires money eligibility + credit + free target;
 * one historical referral does not unlock unlimited upgrades (credit must be spent each time).
 * Join Next Pool consumes exactly 2 upgrade credits.
 */

function validateJoinNext({
  enabled,
  targetOccupying,
  hasEligibility,
  creditBalance,
}) {
  if (!enabled) return { ok: false, code: 'AUTOPOOL_DISABLED' };
  if (targetOccupying) return { ok: false, code: 'TARGET_OCCUPYING' };
  if (!hasEligibility) return { ok: false, code: 'NO_ELIGIBILITY' };
  if (creditBalance < 2) return { ok: false, code: 'NO_UPGRADE_CREDIT' };
  return { ok: true, consumeCredit: 2 };
}

describe('joinNext + credit behavior', () => {
  test('all gates pass consumes two credits', () => {
    expect(
      validateJoinNext({
        enabled: true,
        targetOccupying: false,
        hasEligibility: true,
        creditBalance: 2,
      })
    ).toEqual({ ok: true, consumeCredit: 2 });
  });

  test('one credit blocks even with eligibility', () => {
    expect(
      validateJoinNext({
        enabled: true,
        targetOccupying: false,
        hasEligibility: true,
        creditBalance: 1,
      }).code
    ).toBe('NO_UPGRADE_CREDIT');
  });

  test('zero credits blocks even with eligibility', () => {
    expect(
      validateJoinNext({
        enabled: true,
        targetOccupying: false,
        hasEligibility: true,
        creditBalance: 0,
      }).code
    ).toBe('NO_UPGRADE_CREDIT');
  });

  test('target occupying keeps eligibility (join blocked)', () => {
    expect(
      validateJoinNext({
        enabled: true,
        targetOccupying: true,
        hasEligibility: true,
        creditBalance: 5,
      }).code
    ).toBe('TARGET_OCCUPYING');
  });

  test('two upgrades need four credits', () => {
    let credits = 3;
    const first = validateJoinNext({
      enabled: true,
      targetOccupying: false,
      hasEligibility: true,
      creditBalance: credits,
    });
    expect(first.ok).toBe(true);
    credits -= first.consumeCredit;
    const second = validateJoinNext({
      enabled: true,
      targetOccupying: false,
      hasEligibility: true,
      creditBalance: credits,
    });
    expect(second.code).toBe('NO_UPGRADE_CREDIT');
  });
});

describe('Pool10 credit reset behavior', () => {
  function maybeReset({ pool10Done, otherOccupying, balance }) {
    if (!pool10Done) return { reset: false, balance };
    if (otherOccupying) return { reset: false, balance };
    return { reset: true, balance: 0 };
  }

  test('reset when pool10 done and alone', () => {
    expect(maybeReset({ pool10Done: true, otherOccupying: false, balance: 3 })).toEqual({
      reset: true,
      balance: 0,
    });
  });

  test('no reset when other pool occupying', () => {
    expect(maybeReset({ pool10Done: true, otherOccupying: true, balance: 3 })).toEqual({
      reset: false,
      balance: 3,
    });
  });
});
