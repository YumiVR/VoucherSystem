import { ADMIN_SESSION_MS } from '../../shared/constants/index';
import type { Installation } from './installation';

export class AdminError extends Error {
  constructor(
    public readonly code: 'ADMIN_REQUIRED' | 'BAD_PASSWORD' | 'LOCKED_OUT',
    message: string,
  ) {
    super(message);
    this.name = 'AdminError';
  }
}

const MAX_FAILURES = 5;
const LOCKOUT_MS = 30_000;

/** Short-lived, in-memory administrator session with brute-force throttling. */
export class AdminSession {
  private unlockedUntil = 0;
  private failures = 0;
  private lockedUntil = 0;

  constructor(
    private readonly inst: Installation,
    private readonly now: () => number = () => Date.now(),
  ) {}

  isUnlocked(): boolean {
    return this.now() < this.unlockedUntil;
  }

  /** Throws unless an administrator session is active; activity extends it. */
  require(): void {
    if (!this.isUnlocked()) throw new AdminError('ADMIN_REQUIRED', 'Administrator sign-in is required.');
    this.unlockedUntil = this.now() + ADMIN_SESSION_MS;
  }

  lock(): void {
    this.unlockedUntil = 0;
  }

  /** Verifies the password (rate limited) without changing the session. */
  async verify(password: string): Promise<void> {
    if (this.now() < this.lockedUntil) {
      throw new AdminError('LOCKED_OUT', 'Too many incorrect attempts. Wait a moment and try again.');
    }
    const ok = await this.inst.verifyAdminPassword(password);
    if (!ok) {
      this.failures++;
      this.inst.audit.record('ADMIN_LOGIN_FAILED', `attempt=${this.failures}`);
      if (this.failures >= MAX_FAILURES) {
        this.failures = 0;
        this.lockedUntil = this.now() + LOCKOUT_MS;
      }
      throw new AdminError('BAD_PASSWORD', 'Incorrect administrator password.');
    }
    this.failures = 0;
  }

  async unlock(password: string): Promise<void> {
    await this.verify(password);
    this.unlockedUntil = this.now() + ADMIN_SESSION_MS;
    this.inst.audit.record('ADMIN_LOGIN', '');
  }
}
