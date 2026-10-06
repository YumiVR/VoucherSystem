import { randomBytes, randomInt, randomUUID } from 'node:crypto';

const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** UUID version 4 from the OS CSPRNG. */
export function newUuidV4(): string {
  return randomUUID();
}

export function secureBytes(length: number): Buffer {
  return randomBytes(length);
}

/** Uniformly random upper-case letters (rejection-sampled by crypto.randomInt). */
export function randomUpperLetters(count: number): string {
  let out = '';
  for (let i = 0; i < count; i++) out += UPPER[randomInt(0, UPPER.length)]!;
  return out;
}

/** In-place Fisher-Yates shuffle using secure randomness. */
export function secureShuffle<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
  return items;
}
