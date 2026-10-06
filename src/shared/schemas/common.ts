import { z } from 'zod';
import { LIMITS } from '../constants/index';
import { isBase64Url } from '../utilities/base64';
import { isRollingDateKey, isValidIsoDate, isValidTime } from '../utilities/dates';

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ISO_TS_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})\.\d{3}(Z|[+-]\d{2}:\d{2})$/;
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

export const uuidV4 = z.string().regex(UUID_V4_RE, 'Invalid UUID v4');

export const base64Url = (maxChars: number = LIMITS.base64Url) =>
  z.string().max(maxChars).refine(isBase64Url, 'Invalid base64url');

export const isoDate = z.string().refine(isValidIsoDate, 'Invalid calendar date');
export const isoTime = z.string().refine(isValidTime, 'Invalid time');

export const isoTimestamp = z
  .string()
  .max(40)
  .refine((v) => {
    const m = ISO_TS_RE.exec(v);
    if (!m) return false;
    return isValidIsoDate(m[1]!) && isValidTime(m[2]!) && !Number.isNaN(Date.parse(v));
  }, 'Invalid ISO 8601 timestamp');

export const installationIdentifier = z.string().regex(/^[A-Z]{3}$/, 'Invalid installation identifier');

export const rollingWord = z.string().regex(/^[a-z]{3,12}$/, 'Invalid rolling word');

export const rollingDateKey = z.string().refine(isRollingDateKey, 'Invalid DD-MM key');

export function hasControlCharacters(value: string): boolean {
  return CONTROL_RE.test(value);
}

export const safeText = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine((v) => !hasControlCharacters(v), 'Control characters are not allowed');
