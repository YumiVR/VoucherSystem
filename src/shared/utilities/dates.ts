const DAYS_IN_MONTH_LEAP = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

const pad2 = (n: number): string => String(n).padStart(2, '0');

export function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1) return false;
  const d = new Date(Date.UTC(2000, month - 1, day));
  d.setUTCFullYear(year);
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

export function isValidIsoDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  return isValidCalendarDate(Number(m[1]), Number(m[2]), Number(m[3]));
}

export function isValidTime(value: string): boolean {
  const m = /^(\d{2}):(\d{2}):(\d{2})$/.exec(value);
  if (!m) return false;
  return Number(m[1]) <= 23 && Number(m[2]) <= 59 && Number(m[3]) <= 59;
}

/** Every valid DD-MM key in calendar order, including 29-02 (366 entries). */
export function allRollingDateKeys(): string[] {
  const keys: string[] = [];
  for (let m = 1; m <= 12; m++) {
    for (let d = 1; d <= DAYS_IN_MONTH_LEAP[m - 1]!; d++) keys.push(`${pad2(d)}-${pad2(m)}`);
  }
  return keys;
}

const KEY_SET = new Set(allRollingDateKeys());

export function isRollingDateKey(key: string): boolean {
  return KEY_SET.has(key);
}

/** "2026-01-31" -> "31-01". */
export function rollingKeyFromIsoDate(isoDate: string): string {
  if (!isValidIsoDate(isoDate)) throw new Error('Invalid ISO date');
  return `${isoDate.slice(8, 10)}-${isoDate.slice(5, 7)}`;
}

/** "2026-01-31" -> "31/01/2026". */
export function formatUkDate(isoDate: string): string {
  if (!isValidIsoDate(isoDate)) throw new Error('Invalid ISO date');
  return `${isoDate.slice(8, 10)}/${isoDate.slice(5, 7)}/${isoDate.slice(0, 4)}`;
}

export interface LocalTimestamp {
  date: string;
  time: string;
  /** ISO 8601 with explicit offset, e.g. 2026-01-01T10:30:45.000+00:00 (Z when UTC). */
  iso: string;
  epochMs: number;
  offsetMinutes: number;
}

/** Builds wall-clock fields for an instant at a given UTC offset (minutes east of UTC). */
export function localTimestampFrom(epochMs: number, offsetMinutes: number): LocalTimestamp {
  const shifted = new Date(epochMs + offsetMinutes * 60_000);
  const date = `${String(shifted.getUTCFullYear()).padStart(4, '0')}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`;
  const time = `${pad2(shifted.getUTCHours())}:${pad2(shifted.getUTCMinutes())}:${pad2(shifted.getUTCSeconds())}`;
  const ms = String(shifted.getUTCMilliseconds()).padStart(3, '0');
  let off = 'Z';
  if (offsetMinutes !== 0) {
    const abs = Math.abs(offsetMinutes);
    off = `${offsetMinutes < 0 ? '-' : '+'}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
  }
  return { date, time, iso: `${date}T${time}.${ms}${off}`, epochMs, offsetMinutes };
}

/** Local timestamp for a JS Date using the host time zone. */
export function localTimestampNow(now: Date): LocalTimestamp {
  return localTimestampFrom(now.getTime(), -now.getTimezoneOffset());
}

export function offsetFromIso(iso: string): number | null {
  const m = /(Z|([+-])(\d{2}):(\d{2}))$/.exec(iso);
  if (!m) return null;
  if (m[1] === 'Z') return 0;
  const mins = Number(m[3]) * 60 + Number(m[4]);
  return m[2] === '-' ? -mins : mins;
}
