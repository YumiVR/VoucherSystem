import { MAX_AMOUNT_PENCE } from '../constants/index';

const AMOUNT_RE = /^(\d{1,7})(?:\.(\d{1,2}))?$/;

export type AmountParseResult = { ok: true; pence: number } | { ok: false; message: string };

/** Parses a user-entered GBP amount (e.g. "4", "4.5", "£4.00") into integer pence without floating-point arithmetic. */
export function parseGbpToPence(input: string): AmountParseResult {
  const cleaned = input.trim().replace(/^£\s*/, '');
  if (cleaned === '') return { ok: false, message: 'Enter an amount.' };
  if (/^-/.test(cleaned)) return { ok: false, message: 'The amount must be greater than £0.00.' };
  const m = AMOUNT_RE.exec(cleaned);
  if (!m) {
    return /\.\d{3,}/.test(cleaned)
      ? { ok: false, message: 'Use no more than two decimal places.' }
      : { ok: false, message: 'Enter a valid amount in pounds, for example 4.00.' };
  }
  const pounds = Number(m[1]);
  const pence = Number((m[2] ?? '').padEnd(2, '0'));
  const total = pounds * 100 + pence;
  if (total <= 0) return { ok: false, message: 'The amount must be greater than £0.00.' };
  if (total > MAX_AMOUNT_PENCE) return { ok: false, message: 'The amount is too large.' };
  return { ok: true, pence: total };
}

export function formatPence(pence: number): string {
  if (!Number.isInteger(pence) || pence < 0) throw new Error('Invalid pence value');
  const pounds = Math.floor(pence / 100);
  const rem = pence % 100;
  return `£${pounds.toLocaleString('en-GB')}.${String(rem).padStart(2, '0')}`;
}
