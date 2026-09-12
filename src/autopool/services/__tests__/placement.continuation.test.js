/**
 * Contract tests for classic FIFO filler continuation
 * (same participation re-enters next open child seat — not a new WAITING parent).
 */

function continuationAfterCycle({ isFinalCycle, samePoolAmount }) {
  if (isFinalCycle || !(samePoolAmount > 0)) {
    return { reenterAsFiller: false, createWaitingParent: false };
  }
  return { reenterAsFiller: true, createWaitingParent: false };
}

/** Oldest open parent by queueSequence; seeker cannot sit under own seats. */
function pickFifoParent(openSeats, seekerParticipationId) {
  const eligible = openSeats
    .filter(
      (s) =>
        s.openSlots > 0 &&
        ['PLACED', 'WAITING'].includes(s.status) &&
        String(s.participationId) !== String(seekerParticipationId)
    )
    .sort((a, b) => a.queueSequence - b.queueSequence);
  return eligible[0] || null;
}

describe('filler continuation contract', () => {
  test('cycles 1–14 re-enter as filler, never WAITING parent', () => {
    expect(continuationAfterCycle({ isFinalCycle: false, samePoolAmount: 500 })).toEqual({
      reenterAsFiller: true,
      createWaitingParent: false,
    });
  });

  test('cycle 15 does not re-enter', () => {
    expect(continuationAfterCycle({ isFinalCycle: true, samePoolAmount: 0 })).toEqual({
      reenterAsFiller: false,
      createWaitingParent: false,
    });
  });

  test('Om re-enters under Rajesh (oldest open), not a new parent seat', () => {
    const omId = 'om';
    const rajeshId = 'rajesh';
    const chanakayId = 'chanakay';
    const openSeats = [
      {
        participationId: omId,
        queueSequence: 1,
        openSlots: 0,
        status: 'CYCLE_DONE',
      },
      {
        participationId: rajeshId,
        queueSequence: 2,
        openSlots: 2,
        status: 'PLACED',
      },
      {
        participationId: chanakayId,
        queueSequence: 3,
        openSlots: 2,
        status: 'PLACED',
      },
    ];
    const parent = pickFifoParent(openSeats, omId);
    expect(parent.participationId).toBe(rajeshId);
  });

  test('seeker cannot claim own open seat', () => {
    const omId = 'om';
    const openSeats = [
      {
        participationId: omId,
        queueSequence: 4,
        openSlots: 2,
        status: 'WAITING',
      },
    ];
    expect(pickFifoParent(openSeats, omId)).toBeNull();
  });

  test('alone in pool → no parent (root fallback)', () => {
    expect(pickFifoParent([], 'om')).toBeNull();
  });
});
