const {
  istMidnightToUtc,
  getIstMonthRange,
  getIstDayRange,
  parseIstDateRange,
  getIstTodayRange,
  getIstLastNDaysRange,
} = require('../istRange');

describe('istRange', () => {
  test('April 1 2026 00:00 IST is March 31 18:30 UTC', () => {
    const d = istMidnightToUtc(2026, 3, 1);
    expect(d.toISOString()).toBe('2026-03-31T18:30:00.000Z');
  });

  test('getIstMonthRange April 2026', () => {
    const { startUtc, endUtc } = getIstMonthRange(2026, 4);
    expect(startUtc.toISOString()).toBe('2026-03-31T18:30:00.000Z');
    expect(endUtc.toISOString()).toBe('2026-04-30T18:30:00.000Z');
  });

  test('getIstDayRange single day half-open', () => {
    const { startUtc, endUtc } = getIstDayRange('2026-04-15');
    expect(endUtc.getTime() - startUtc.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  test('parseIstDateRange inclusive', () => {
    const { startUtc, endUtc } = parseIstDateRange('2026-04-01', '2026-04-03');
    expect(startUtc.toISOString()).toBe('2026-03-31T18:30:00.000Z');
    expect(endUtc.toISOString()).toBe('2026-04-03T18:30:00.000Z');
  });

  test('parseIstDateRange rejects span > max', () => {
    expect(() =>
      parseIstDateRange('2025-01-01', '2026-06-01', 100)
    ).toThrow('at most 100 days');
  });

  test('getIstTodayRange returns 24h window', () => {
    const fixed = new Date('2026-04-15T12:00:00.000Z');
    const { startUtc, endUtc } = getIstTodayRange(fixed);
    expect(endUtc.getTime() - startUtc.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  test('getIstLastNDaysRange returns 30 labels', () => {
    const { labels } = getIstLastNDaysRange(30, new Date('2026-04-15T12:00:00.000Z'));
    expect(labels).toHaveLength(30);
  });
});
