import { safeStorage } from 'electron';
import type { SecretProtector } from '../crypto/protector';

/** Operating-system protected storage: DPAPI on Windows, Keychain on macOS, libsecret/kwallet on Linux. */
export class ElectronSecretProtector implements SecretProtector {
  isAvailable(): boolean {
    if (!safeStorage.isEncryptionAvailable()) return false;
    // On Linux the "basic_text" backend stores a hard-coded key and is not real protection.
    const backend = (safeStorage as unknown as { getSelectedStorageBackend?: () => string }).getSelectedStorageBackend?.();
    return backend !== 'basic_text';
  }

  protect(plain: Uint8Array): Buffer {
    return safeStorage.encryptString(Buffer.from(plain).toString('base64'));
  }

  unprotect(protectedBytes: Uint8Array): Buffer {
    return Buffer.from(safeStorage.decryptString(Buffer.from(protectedBytes)), 'base64');
  }
}
