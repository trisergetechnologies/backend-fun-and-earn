/**
 * Pure gate helpers mirroring manual P2/P3 + WR cron skip rules.
 */

function manualJoinGates({
  enabled,
  poolLevel,
  targetOccupying,
  hasWaitingSeat,
  otherOccupyingCount,
  creditBalance,
  passesRequired,
}) {
  const reasons = [];
  if (!enabled) reasons.push('AUTOPOOL_DISABLED');
  if (poolLevel !== 2 && poolLevel !== 3) reasons.push('INVALID_POOL');
  if (targetOccupying) reasons.push('POOL_OCCUPYING');
  if (hasWaitingSeat) reasons.push('WAITING_ROOM_PENDING');
  if (otherOccupyingCount < 1) reasons.push('NO_OTHER_OCCUPYING');
  if (creditBalance < passesRequired) reasons.push('NO_UPGRADE_CREDIT');
  return { allowed: reasons.length === 0, reasons };
}

function cronSeatSkippable({ occupyingTarget, creditBalance, eligibilityAvailable }) {
  if (occupyingTarget) return 'TARGET_OCCUPYING';
  if (creditBalance < 1) return 'NO_UPGRADE_CREDIT';
  if (!eligibilityAvailable) return 'NO_ELIGIBILITY';
  return null;
}

describe('manual P2/P3 gates', () => {
  test('allows when other occupying + passes + no WR', () => {
    expect(
      manualJoinGates({
        enabled: true,
        poolLevel: 2,
        targetOccupying: false,
        hasWaitingSeat: false,
        otherOccupyingCount: 1,
        creditBalance: 2,
        passesRequired: 2,
      }).allowed
    ).toBe(true);
  });

  test('blocks when WR seat pending', () => {
    const r = manualJoinGates({
      enabled: true,
      poolLevel: 3,
      targetOccupying: false,
      hasWaitingSeat: true,
      otherOccupyingCount: 1,
      creditBalance: 4,
      passesRequired: 4,
    });
    expect(r.allowed).toBe(false);
    expect(r.reasons).toContain('WAITING_ROOM_PENDING');
  });

  test('blocks without other occupying', () => {
    const r = manualJoinGates({
      enabled: true,
      poolLevel: 2,
      targetOccupying: false,
      hasWaitingSeat: false,
      otherOccupyingCount: 0,
      creditBalance: 5,
      passesRequired: 2,
    });
    expect(r.reasons).toContain('NO_OTHER_OCCUPYING');
  });
});

describe('WR cron skip gates', () => {
  test('skips when target occupying', () => {
    expect(
      cronSeatSkippable({
        occupyingTarget: true,
        creditBalance: 2,
        eligibilityAvailable: true,
      })
    ).toBe('TARGET_OCCUPYING');
  });

  test('skips when no pass', () => {
    expect(
      cronSeatSkippable({
        occupyingTarget: false,
        creditBalance: 0,
        eligibilityAvailable: true,
      })
    ).toBe('NO_UPGRADE_CREDIT');
  });

  test('ready when free + pass + eligibility', () => {
    expect(
      cronSeatSkippable({
        occupyingTarget: false,
        creditBalance: 1,
        eligibilityAvailable: true,
      })
    ).toBeNull();
  });
});

describe('join-next soft-close', () => {
  test('AUTO_JOIN_ENABLED response shape', () => {
    const body = {
      success: false,
      code: 'AUTO_JOIN_ENABLED',
      message:
        'Pool upgrades are automatic now. You will be upgraded when your turn comes in the waiting room and you have a referral pass.',
    };
    expect(body.success).toBe(false);
    expect(body.code).toBe('AUTO_JOIN_ENABLED');
    expect(body.message.length).toBeGreaterThan(10);
  });
});
