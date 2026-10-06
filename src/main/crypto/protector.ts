import { createCipheriv, createDecipheriv } from 'node:crypto';
import { secureBytes } from './random';

/** Abstraction over operating-system protected key material (Electron safeStorage in production). */
export interface SecretProtector {
  isAvailable(): boolean;
  protect(plain: Uint8Array): Buffer;
  unprotect(protectedBytes: Uint8Array): Buffer;
}

/**
 * Process-local protector with a random in-memory key. For automated tests only;
 * production code always receives the Electron safeStorage implementation.
 */
export class MemorySecretProtector implements SecretProtector {
  private readonly key = secureBytes(32);

  isAvailable(): boolean {
    return true;
  }

  protect(plain: Uint8Array): Buffer {
    const iv = secureBytes(12);
    const c = createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([c.update(plain), c.final()]);
    return Buffer.concat([iv, c.getAuthTag(), ct]);
  }

  unprotect(protectedBytes: Uint8Array): Buffer {
    const b = Buffer.from(protectedBytes);
    const d = createDecipheriv('aes-256-gcm', this.key, b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([d.update(b.subarray(28)), d.final()]);
  }
}
