const { computeCycleDistribution } = require('../cycleMath');

function baseParticipation(overrides = {}) {
  return {
    poolLevel: 1,
    configSnapshot: {
      entryAmount: 500,
      collectionMultiplier: 2,
      maxCycles: 10,
      samePoolPercent: 50,
      walletPercent: 20,
      nextPoolPercent: 20,
      adminPercent: 5,
      featurePercent: 5,
    },
    ...overrides,
  };
}

describe('cycleMath.computeCycleDistribution', () => {
  test('cycle 1 Pool1: 50/20/20/5/5 of 1000 and createsEligibility false until cycle 5', () => {
    const d = computeCycleDistribution({
      participation: baseParticipation(),
      cycleNumber: 1,
    });
    expect(d.collectionAmount).toBe(1000);
    expect(d.samePoolAmount).toBe(500);
    expect(d.walletAmount).toBe(200);
    expect(d.nextPoolAmount).toBe(200);
    expect(d.adminAmount).toBe(50);
    expect(d.featureAmount).toBe(50);
    expect(d.createsEligibility).toBe(false);
    expect(
      d.samePoolAmount + d.walletAmount + d.nextPoolAmount + d.adminAmount + d.featureAmount
    ).toBe(1000);
  });

  test('cycle 5 creates eligibility and keeps next-pool amount', () => {
    const d = computeCycleDistribution({
      participation: baseParticipation(),
      cycleNumber: 5,
    });
    expect(d.createsEligibility).toBe(true);
    expect(d.nextPoolAmount).toBe(200);
  });

  test('cycle 6 redirects next-pool 20% to Feature', () => {
    const d = computeCycleDistribution({
      participation: baseParticipation(),
      cycleNumber: 6,
    });
    expect(d.nextPoolAmount).toBe(0);
    expect(d.featureAmount).toBe(50 + 200);
    expect(d.samePoolAmount).toBe(500);
  });

  test('cycle 10 sends same-pool and next-pool to Feature', () => {
    const d = computeCycleDistribution({
      participation: baseParticipation(),
      cycleNumber: 10,
    });
    expect(d.isFinalCycle).toBe(true);
    expect(d.samePoolAmount).toBe(0);
    expect(d.nextPoolAmount).toBe(0);
    expect(d.walletAmount).toBe(200);
    expect(d.featureAmount).toBe(50 + 200 + 500);
  });

  test('Pool 10 always redirects next-pool to Feature; cycle 1 no eligibility', () => {
    const d = computeCycleDistribution({
      participation: baseParticipation({
        poolLevel: 10,
        configSnapshot: {
          entryAmount: 256000,
          collectionMultiplier: 2,
          maxCycles: 10,
          samePoolPercent: 50,
          walletPercent: 20,
          nextPoolPercent: 20,
          adminPercent: 5,
          featurePercent: 5,
        },
      }),
      cycleNumber: 1,
    });
    expect(d.createsEligibility).toBe(false);
    expect(d.nextPoolAmount).toBe(0);
    expect(d.collectionAmount).toBe(512000);
  });
});
