export type WedgeTerminator = 'enter' | 'tab' | 'none';

export interface WedgeConfig {
  prefix: string;
  suffix: string;
  terminator: WedgeTerminator;
}

export const DEFAULT_WEDGE_CONFIG: WedgeConfig = { prefix: '', suffix: '', terminator: 'enter' };

export type WedgeRejection = 'incomplete' | 'prefix' | 'suffix' | 'empty' | 'duplicate';

export type WedgeEvent =
  | { kind: 'scan'; text: string; raw: string }
  | { kind: 'rejected'; reason: WedgeRejection; raw: string };

export interface WedgeTiming {
  /** Largest gap between keystrokes that still counts as one scan. */
  maxGapMs: number;
  /** Shortest buffer treated as scanner data rather than typing. */
  minLength: number;
  /** Quiet time after which an unterminated buffer is closed or discarded. */
  idleMs: number;
  /** Identical scans inside this window are ignored. */
  dedupeMs: number;
}

const DEFAULT_TIMING: WedgeTiming = { maxGapMs: 60, minLength: 8, idleMs: 150, dedupeMs: 2000 };

/**
 * Separates keyboard-wedge scanner input from human typing by keystroke speed and buffers it
 * until a terminator arrives. Pure logic with an injected clock so it can be tested without a DOM.
 */
export class WedgeParser {
  private buffer = '';
  private lastKeyAt = 0;
  private lastText = '';
  private lastScanAt = -Infinity;

  constructor(
    private config: WedgeConfig = DEFAULT_WEDGE_CONFIG,
    private readonly timing: WedgeTiming = DEFAULT_TIMING,
  ) {}

  setConfig(config: WedgeConfig): void {
    this.config = config;
    this.reset();
  }

  reset(): void {
    this.buffer = '';
  }

  /** `consumed` tells the caller to preventDefault so scanner keys never reach focused controls. */
  pushKey(key: string, now: number): { consumed: boolean; event?: WedgeEvent } {
    const isEnter = key === 'Enter' || key === '\r' || key === '\n';
    const isTab = key === 'Tab';
    if (isEnter || isTab) {
      const terminates = (isEnter && this.config.terminator === 'enter') || (isTab && this.config.terminator === 'tab');
      if (this.buffer === '' || !terminates) return { consumed: false };
      if (now - this.lastKeyAt > this.timing.maxGapMs) {
        const stale = this.buffer;
        this.buffer = '';
        return { consumed: false, ...(stale.length >= this.timing.minLength ? { event: { kind: 'rejected' as const, reason: 'incomplete' as const, raw: stale } } : {}) };
      }
      const event = this.finish(now);
      return { consumed: true, ...(event ? { event } : {}) };
    }
    if (key.length !== 1) return { consumed: false };

    let event: WedgeEvent | undefined;
    if (this.buffer !== '' && now - this.lastKeyAt > this.timing.maxGapMs) {
      if (this.buffer.length >= this.timing.minLength) event = { kind: 'rejected', reason: 'incomplete', raw: this.buffer };
      this.buffer = '';
    }
    this.buffer += key;
    this.lastKeyAt = now;
    return { consumed: this.buffer.length >= 2, ...(event ? { event } : {}) };
  }

  /** Call periodically; closes or discards a buffer that has gone quiet. */
  tick(now: number): WedgeEvent | undefined {
    if (this.buffer === '' || now - this.lastKeyAt < this.timing.idleMs) return undefined;
    if (this.config.terminator === 'none') return this.finish(now);
    const stale = this.buffer;
    this.buffer = '';
    return stale.length >= this.timing.minLength ? { kind: 'rejected', reason: 'incomplete', raw: stale } : undefined;
  }

  private finish(now: number): WedgeEvent | undefined {
    const raw = this.buffer;
    this.buffer = '';
    if (raw.length < this.timing.minLength) return undefined;
    let text = raw;
    const { prefix, suffix } = this.config;
    if (prefix) {
      if (!text.startsWith(prefix)) return { kind: 'rejected', reason: 'prefix', raw };
      text = text.slice(prefix.length);
    }
    if (suffix) {
      if (!text.endsWith(suffix)) return { kind: 'rejected', reason: 'suffix', raw };
      text = text.slice(0, text.length - suffix.length);
    }
    if (text === '') return { kind: 'rejected', reason: 'empty', raw };
    if (text === this.lastText && now - this.lastScanAt < this.timing.dedupeMs) return { kind: 'rejected', reason: 'duplicate', raw };
    this.lastText = text;
    this.lastScanAt = now;
    return { kind: 'scan', text, raw };
  }
}
