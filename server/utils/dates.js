/**
 * Date helpers for CV work. Resume dates are free text ("Jan 2021", "2021",
 * "Present", "2021 - Present"), so every parser here is best-effort and returns
 * `null` rather than throwing on anything unrecognised.
 */

const MONTHS = {
  jan: 0, january: 0,
  feb: 1, february: 1,
  mar: 2, march: 2,
  apr: 3, april: 3,
  may: 4,
  jun: 5, june: 5,
  jul: 6, july: 6,
  aug: 7, august: 7,
  sep: 8, sept: 8, september: 8,
  oct: 9, october: 9,
  nov: 10, november: 10,
  dec: 11, december: 11,
};

const PRESENT_PATTERN = /present|current|now|today|ongoing|to date|至今/i;

export function isPresent(value) {
  return PRESENT_PATTERN.test(String(value ?? ""));
}

/**
 * Parses a resume date into `{ year, month }`, month being 0-11.
 * Returns `null` when nothing date-like is present.
 */
export function parseResumeDate(value) {
  const text = String(value ?? "").trim();

  if (!text || PRESENT_PATTERN.test(text)) return null;

  // "January 2021" / "Jan 2021" / "Jan. 2021"
  const named = text.match(/([a-z]+)\.?\s*(\d{4})/i);
  if (named) {
    const month = MONTHS[named[1].toLowerCase()];
    if (month !== undefined) {
      return { year: Number.parseInt(named[2], 10), month };
    }
  }

  // "2021-03" / "2021/03" / "2021"
  const numeric = text.match(/(\d{4})\D{0,2}(\d{1,2})?/);
  if (numeric) {
    const year = Number.parseInt(numeric[1], 10);
    const month = numeric[2] ? Math.min(11, Math.max(0, Number.parseInt(numeric[2], 10) - 1)) : 0;

    return { year, month };
  }

  return null;
}

function toMonthIndex({ year, month }) {
  return year * 12 + month;
}

function todayMonthIndex(now = new Date()) {
  return now.getFullYear() * 12 + now.getMonth();
}

/** Whole months between two month indices, never negative. */
export function monthsBetween(fromIndex, toIndex) {
  return Math.max(0, toIndex - fromIndex);
}

/**
 * Duration of one role in months. A current role runs up to today. If either
 * end is unparseable we fall back to `durationMonths` reported by the model.
 */
export function roleDurationMonths(role, now = new Date()) {
  const start = parseResumeDate(role?.startDate);
  if (!start) return Math.max(0, Math.round(Number(role?.durationMonths) || 0));

  const end = isPresent(role?.endDate) || role?.current
    ? todayMonthIndex(now)
    : (parseResumeDate(role?.endDate) ?? todayMonthIndex(now));

  // A single-month minimum stops 0-length roles from looking absent.
  return Math.max(1, monthsBetween(toMonthIndex(start), toMonthIndex(end)));
}

/**
 * Total professional experience, merging overlapping roles so a period spent in
 * two jobs at once is only counted once.
 */
export function totalExperienceMonths(roles = [], now = new Date()) {
  const ranges = [];

  for (const role of roles) {
    const start = parseResumeDate(role?.startDate);

    if (!start) {
      // No parsable start date: honour the model's own estimate if it gave one.
      ranges.push({ start: 0, end: Math.max(0, Math.round(Number(role?.durationMonths) || 0)) });
      continue;
    }

    const from = toMonthIndex(start);
    const to = isPresent(role?.endDate) || role?.current
      ? todayMonthIndex(now)
      : toMonthIndex(parseResumeDate(role?.endDate) ?? { year: now.getFullYear(), month: now.getMonth() });

    ranges.push({ start: from, end: Math.max(from, to) });
  }

  if (ranges.length === 0) return 0;

  ranges.sort((a, b) => a.start - b.start);

  let total = 0;
  let cursorStart = ranges[0].start;
  let cursorEnd = ranges[0].end;

  for (const range of ranges.slice(1)) {
    if (range.start <= cursorEnd) {
      cursorEnd = Math.max(cursorEnd, range.end);
    } else {
      total += cursorEnd - cursorStart;
      cursorStart = range.start;
      cursorEnd = range.end;
    }
  }

  total += cursorEnd - cursorStart;

  return Math.max(0, total);
}

export function totalExperienceYears(roles, now = new Date()) {
  return Math.round((totalExperienceMonths(roles, now) / 12) * 10) / 10;
}
