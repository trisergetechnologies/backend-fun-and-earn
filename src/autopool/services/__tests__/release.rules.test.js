const {
  isPoolReleased,
  shouldReleaseAfterUpgrade,
  shouldReleaseAfterCycle15,
} = require('../release.rules');

describe('release.rules', () => {
  test('pools 1-9 not released at 15/15 without upgradeUsedAt', () => {
    expect(
      isPoolReleased({
        poolLevel: 1,
        cycleCount: 15,
        upgradeUsedAt: null,
        releasedAt: null,
        configSnapshot: { maxCycles: 15 },
      })
    ).toBe(false);
  });

  test('pools 1-9 released at 15/15 with upgradeUsedAt', () => {
    expect(
      isPoolReleased({
        poolLevel: 1,
        cycleCount: 15,
        upgradeUsedAt: new Date(),
        releasedAt: null,
        configSnapshot: { maxCycles: 15 },
      })
    ).toBe(true);
  });

  test('Pool 10 released at 15/15 without upgrade', () => {
    expect(
      isPoolReleased({
        poolLevel: 10,
        cycleCount: 15,
        upgradeUsedAt: null,
        releasedAt: null,
        configSnapshot: { maxCycles: 15 },
      })
    ).toBe(true);
  });

  test('already releasedAt short-circuits', () => {
    expect(
      isPoolReleased({
        poolLevel: 1,
        cycleCount: 3,
        upgradeUsedAt: null,
        releasedAt: new Date(),
      })
    ).toBe(true);
  });

  test('shouldReleaseAfterUpgrade only when cycles done', () => {
    expect(
      shouldReleaseAfterUpgrade({
        poolLevel: 2,
        cycleCount: 10,
        upgradeUsedAt: new Date(),
        configSnapshot: { maxCycles: 15 },
      })
    ).toBeNull();

    expect(
      shouldReleaseAfterUpgrade({
        poolLevel: 2,
        cycleCount: 15,
        upgradeUsedAt: new Date(),
        configSnapshot: { maxCycles: 15 },
      })
    ).toBeInstanceOf(Date);
  });

  test('shouldReleaseAfterCycle15 for pool1 requires upgradeUsedAt', () => {
    expect(
      shouldReleaseAfterCycle15({
        poolLevel: 1,
        upgradeUsedAt: null,
      })
    ).toBeNull();
    expect(
      shouldReleaseAfterCycle15({
        poolLevel: 1,
        upgradeUsedAt: new Date(),
      })
    ).toBeInstanceOf(Date);
    expect(
      shouldReleaseAfterCycle15({
        poolLevel: 10,
        upgradeUsedAt: null,
      })
    ).toBeInstanceOf(Date);
  });
});
