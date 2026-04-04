/**
 * IST (India Standard Time, UTC+5:30) calendar ranges as UTC Date instants for MongoDB queries.
 * All ranges are half-open: [startUtc, endUtc).
 */

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/**
 * @param {number} year
 * @param {number} month0 0-11
 * @param {number} day 1-31
 * @returns {Date} UTC instant of that IST calendar date at 00:00:00 IST
 */
function istMidnightToUtc(year, month0, day) {
  return new Date(Date.UTC(year, month0, day, 0, 0, 0, 0) - IST_OFFSET_MS);
}

/**
 * IST wall-clock calendar (y, month0, day) from a UTC Date.
 * @param {Date} utcDate
 */
function istWallFromUtc(utcDate) {
  const shifted = new Date(utcDate.getTime() + IST_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month0: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
  };
}

/**
 * @param {Date} [now]
 * @returns {{ startUtc: Date, endUtc: Date }}
 */
function getIstTodayRange(now = new Date()) {
  const { year, month0, day } = istWallFromUtc(now);
  const startUtc = istMidnightToUtc(year, month0, day);
  const endUtc = new Date(startUtc.getTime() + 24 * 60 * 60 * 1000);
  return { startUtc, endUtc };
}

/**
 * @param {number} year
 * @param {number} month1to12 1-12
 * @returns {{ startUtc: Date, endUtc: Date }}
 */
function getIstMonthRange(year, month1to12) {
  if (month1to12 < 1 || month1to12 > 12) {
    throw new Error('month must be 1-12');
  }
  const month0 = month1to12 - 1;
  const startUtc = istMidnightToUtc(year, month0, 1);
  const endUtc = istMidnightToUtc(year, month0 + 1, 1);
  return { startUtc, endUtc };
}

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * @param {string} yyyyMmDd
 * @returns {{ startUtc: Date, endUtc: Date }}
 */
function getIstDayRange(yyyyMmDd) {
  const m = String(yyyyMmDd).trim().match(YMD_RE);
  if (!m) throw new Error('expected YYYY-MM-DD');
  const year = parseInt(m[1], 10);
  const month0 = parseInt(m[2], 10) - 1;
  const day = parseInt(m[3], 10);
  if (month0 < 0 || month0 > 11 || day < 1 || day > 31) {
    throw new Error('invalid date');
  }
  const startUtc = istMidnightToUtc(year, month0, day);
  const probe = new Date(Date.UTC(year, month0, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month0 ||
    probe.getUTCDate() !== day
  ) {
    throw new Error('invalid calendar date');
  }
  const endUtc = new Date(startUtc.getTime() + 24 * 60 * 60 * 1000);
  return { startUtc, endUtc };
}

/**
 * Inclusive IST calendar from/to → half-open UTC range [start, end).
 * @param {string} fromStr YYYY-MM-DD
 * @param {string} toStr YYYY-MM-DD
 * @param {number} [maxSpanDays=366]
 * @returns {{ startUtc: Date, endUtc: Date }}
 */
function parseIstDateRange(fromStr, toStr, maxSpanDays = 366) {
  const from = String(fromStr).trim();
  const to = String(toStr).trim();
  const mf = from.match(YMD_RE);
  const mt = to.match(YMD_RE);
  if (!mf || !mt) throw new Error('from and to must be YYYY-MM-DD');
  const y1 = parseInt(mf[1], 10);
  const mo1 = parseInt(mf[2], 10) - 1;
  const d1 = parseInt(mf[3], 10);
  const y2 = parseInt(mt[1], 10);
  const mo2 = parseInt(mt[2], 10) - 1;
  const d2 = parseInt(mt[3], 10);
  const startUtc = istMidnightToUtc(y1, mo1, d1);
  const endExclusive = istMidnightToUtc(y2, mo2, d2 + 1);
  if (endExclusive.getTime() <= startUtc.getTime()) {
    throw new Error('to must be on or after from');
  }
  const spanMs = endExclusive.getTime() - startUtc.getTime();
  const spanDays = spanMs / (24 * 60 * 60 * 1000);
  if (spanDays > maxSpanDays) {
    throw new Error(`range must be at most ${maxSpanDays} days`);
  }
  return { startUtc, endUtc: endExclusive };
}

/**
 * Last N IST calendar days ending yesterday (excludes "today" partial) or including today — plan says "last 30 IST days".
 * We use: rolling window of 30 IST days ending at end of today IST (exclusive next day start) = today end,
 * start = today IST start minus (n-1) days in ms... Simpler: 30 buckets labeled by IST date for [today-29, today] inclusive = 30 days.

 * @param {number} numDays default 30
 * @param {Date} [now]
 * @returns {{ startUtc: Date, endUtc: Date, labels: string[] }} labels YYYY-MM-DD IST
 */
function getIstLastNDaysRange(numDays = 30, now = new Date()) {
  const n = Math.max(1, Math.min(366, numDays));
  const { startUtc: todayStart } = getIstTodayRange(now);
  const startUtc = new Date(todayStart.getTime() - (n - 1) * 24 * 60 * 60 * 1000);
  const endUtc = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
  const labels = [];
  for (let i = 0; i < n; i++) {
    const t = new Date(startUtc.getTime() + i * 24 * 60 * 60 * 1000);
    const { year, month0, day } = istWallFromUtc(t);
    labels.push(
      `${year}-${String(month0 + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    );
  }
  return { startUtc, endUtc, labels };
}

module.exports = {
  IST_OFFSET_MS,
  istMidnightToUtc,
  istWallFromUtc,
  getIstTodayRange,
  getIstMonthRange,
  getIstDayRange,
  parseIstDateRange,
  getIstLastNDaysRange,
};
