const {
  isPoolReleased,
  shouldReleaseAfterUpgrade,
  shouldReleaseAfterCycle15,
} = require('../release.rules');

describe('release.rules', () => {
  test('pools 1-12 not released at 5/5 without upgradeUsedAt', () => {
    expect(
      isPoolReleased({
        poolLevel: 1,
        cycleCount: 5,
        upgradeUsedAt: null,
        releasedAt: null,
        configSnapshot: { maxCycles: 5 },
      })
    ).toBe(false);
  });

  test('pools 1-12 released at 5/5 with upgradeUsedAt', () => {
    expect(
      isPoolReleased({
        poolLevel: 1,
        cycleCount: 5,
        upgradeUsedAt: new Date(),
        releasedAt: null,
        configSnapshot: { maxCycles: 5 },
      })
    ).toBe(true);
  });

  test('Pool 13 released at 5/5 without upgrade', () => {
    expect(
      isPoolReleased({
        poolLevel: 13,
        cycleCount: 5,
        upgradeUsedAt: null,
        releasedAt: null,
        configSnapshot: { maxCycles: 5 },
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
        cycleCount: 3,
        upgradeUsedAt: new Date(),
        configSnapshot: { maxCycles: 5 },
      })
    ).toBeNull();

    expect(
      shouldReleaseAfterUpgrade({
        poolLevel: 2,
        cycleCount: 5,
        upgradeUsedAt: new Date(),
        configSnapshot: { maxCycles: 5 },
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
        poolLevel: 13,
        upgradeUsedAt: null,
      })
    ).toBeInstanceOf(Date);
  });
});
