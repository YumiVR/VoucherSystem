import { allRollingDateKeys } from '../../shared/utilities/dates';
import { secureShuffle } from '../crypto/random';
import { ROLLING_WORDS } from './wordlist';

export type RollingDateCodes = Record<string, string>;

/** Assigns a distinct word to each of the 366 DD-MM keys (including 29-02) using secure shuffling. */
export function generateRollingDateCodes(): RollingDateCodes {
  const keys = allRollingDateKeys();
  const words = secureShuffle([...new Set(ROLLING_WORDS)]);
  if (words.length < keys.length) throw new Error('Word list is too small');
  const codes: RollingDateCodes = {};
  keys.forEach((k, i) => {
    codes[k] = words[i]!;
  });
  return codes;
}
