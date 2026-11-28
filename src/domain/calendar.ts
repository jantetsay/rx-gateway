// Working-day arithmetic on plain YYYY-MM-DD strings, in UTC so a date never
// shifts with the server's time zone. Weekends are off; holidays are passed in.

export type ISODate = string;

const DAY = 86_400_000;

export function parse(d: ISODate): number {
  const [y, m, day] = d.slice(0, 10).split("-").map(Number);
  return Date.UTC(y, m - 1, day);
}

export function fmt(ms: number): ISODate {
  return new Date(ms).toISOString().slice(0, 10);
}

export function today(now: Date = new Date()): ISODate {
  return now.toISOString().slice(0, 10);
}

export function isWorkingDay(d: ISODate, holidays: ReadonlySet<ISODate> = EMPTY): boolean {
  const dow = new Date(parse(d)).getUTCDay();
  return dow !== 0 && dow !== 6 && !holidays.has(d);
}

const EMPTY: ReadonlySet<ISODate> = new Set();

/** Move n working days forward (n > 0) or back (n < 0). n = 0 rolls to the next working day. */
export function addWorkingDays(d: ISODate, n: number, holidays: ReadonlySet<ISODate> = EMPTY): ISODate {
  let ms = parse(d);
  if (n === 0) {
    while (!isWorkingDay(fmt(ms), holidays)) ms += DAY;
    return fmt(ms);
  }
  const step = n > 0 ? DAY : -DAY;
  let left = Math.abs(n);
  while (left > 0) {
    ms += step;
    if (isWorkingDay(fmt(ms), holidays)) left--;
  }
  return fmt(ms);
}

/**
 * Working days from a to b: positive when b is later. Counts the working days
 * after a up to and including b, so the same day is 0 and Fri to Mon is 1.
 */
export function workingDaysBetween(a: ISODate, b: ISODate, holidays: ReadonlySet<ISODate> = EMPTY): number {
  const start = parse(a);
  const end = parse(b);
  if (start === end) return 0;
  const sign = end > start ? 1 : -1;
  let count = 0;
  for (let ms = start + sign * DAY; sign > 0 ? ms <= end : ms >= end; ms += sign * DAY) {
    if (isWorkingDay(fmt(ms), holidays)) count++;
  }
  return sign * count;
}

export function calendarDaysBetween(a: ISODate, b: ISODate): number {
  return Math.round((parse(b) - parse(a)) / DAY);
}

export function addDays(d: ISODate, n: number): ISODate {
  return fmt(parse(d) + n * DAY);
}

export function maxDate(...ds: (ISODate | null | undefined)[]): ISODate | null {
  const xs = ds.filter((d): d is ISODate => !!d);
  return xs.length ? xs.reduce((a, b) => (a > b ? a : b)) : null;
}

/** The Monday on or after the day after d: when a weekly refresh lapses hand changes. */
export function nextMonday(d: ISODate): ISODate {
  let ms = parse(d) + DAY;
  while (new Date(ms).getUTCDay() !== 1) ms += DAY;
  return fmt(ms);
}
