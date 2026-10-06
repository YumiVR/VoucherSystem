import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  CryptoError,
  decodeEnvelope,
  decryptEnvelope,
  encodeEnvelope,
  encryptEnvelope,
  fromEnvelopeModel,
  toEnvelopeModel,
} from '../../src/main/crypto/envelope';
import { fingerprintOf, generateRsaKeyPair, keyIdOf, assertAcceptablePublicKey, publicKeyFromPrivate } from '../../src/main/crypto/keys';
import { MemorySecretProtector } from '../../src/main/crypto/protector';
import { hashPassword, verifyPassword } from '../../src/main/crypto/password';
import { randomUpperLetters, newUuidV4 } from '../../src/main/crypto/random';
import { signData, verifySignature } from '../../src/main/crypto/signature';

describe('RSA key generation', () => {
  it('creates RSA-3072 key pairs whose public key derives from the private key', async () => {
    const kp = await generateRsaKeyPair();
    expect(() => assertAcceptablePublicKey(kp.publicKeyDer)).not.toThrow();
    expect(publicKeyFromPrivate(kp.privateKeyDer).equals(kp.publicKeyDer)).toBe(true);
    expect(keyIdOf(kp.publicKeyDer)).toMatch(/^[0-9a-f]{16}$/);
    expect(fingerprintOf(kp.publicKeyDer)).toMatch(/^([0-9A-F]{4} ){7}[0-9A-F]{4}$/);
  });

  it('rejects public keys of the wrong type or size', async () => {
    const { generateKeyPairSync } = await import('node:crypto');
    const small = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ type: 'spki', format: 'der' });
    expect(() => assertAcceptablePublicKey(small)).toThrow();
    const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' }).publicKey.export({ type: 'spki', format: 'der' });
    expect(() => assertAcceptablePublicKey(ec)).toThrow();
  });
});

describe('hybrid encryption', () => {
  it('round-trips plaintext, with and without compression', async () => {
    const kp = await generateRsaKeyPair();
    for (const compress of [false, true]) {
      const plaintext = Buffer.from('hello '.repeat(200));
      const env = encryptEnvelope({ type: 'voucher', recipientPublicKeyDer: kp.publicKeyDer, plaintext, compress });
      const wire = decodeEnvelope(encodeEnvelope(env));
      expect(decryptEnvelope(wire, kp.privateKeyDer).equals(plaintext)).toBe(true);
    }
  });

  it('rejects modified ciphertext, tag, IV, wrapped key and header', async () => {
    const kp = await generateRsaKeyPair();
    const env = encryptEnvelope({ type: 'voucher', recipientPublicKeyDer: kp.publicKeyDer, plaintext: randomBytes(64), compress: false });
    const wire = encodeEnvelope(env);
    const flip = (offset: number): Buffer => {
      const copy = Buffer.from(wire);
      copy[offset] = copy[offset]! ^ 0x01;
      return copy;
    };
    const tagStart = 13 + 384 + 12;
    expect(() => decryptEnvelope(decodeEnvelope(flip(wire.length - 1)), kp.privateKeyDer)).toThrow(CryptoError);
    expect(() => decryptEnvelope(decodeEnvelope(flip(tagStart)), kp.privateKeyDer)).toThrow(CryptoError);
    expect(() => decryptEnvelope(decodeEnvelope(flip(13 + 384)), kp.privateKeyDer)).toThrow(CryptoError);
    expect(() => decryptEnvelope(decodeEnvelope(flip(13 + 10)), kp.privateKeyDer)).toThrow(CryptoError);
    // Flipping the flags byte changes the authenticated header.
    expect(() => decryptEnvelope(decodeEnvelope(flip(4)), kp.privateKeyDer)).toThrow(CryptoError);
  });

  it('reports WRONG_KEY for a different recipient', async () => {
    const a = await generateRsaKeyPair();
    const b = await generateRsaKeyPair();
    const env = encryptEnvelope({ type: 'voucher', recipientPublicKeyDer: a.publicKeyDer, plaintext: randomBytes(8), compress: false });
    try {
      decryptEnvelope(env, b.privateKeyDer);
      expect.unreachable();
    } catch (e) {
      expect((e as CryptoError).code).toBe('WRONG_KEY');
    }
  });

  it('rejects unsupported versions and bad structure', async () => {
    const kp = await generateRsaKeyPair();
    const wire = encodeEnvelope(encryptEnvelope({ type: 'voucher', recipientPublicKeyDer: kp.publicKeyDer, plaintext: randomBytes(8), compress: false }));
    const v2 = Buffer.from(wire);
    v2[2] = 2;
    expect(() => decodeEnvelope(v2)).toThrow(/version/i);
    expect(() => decodeEnvelope(wire.subarray(0, 100))).toThrow(CryptoError);
    const badMagic = Buffer.from(wire);
    badMagic[0] = 0;
    expect(() => decodeEnvelope(badMagic)).toThrow(CryptoError);
  });

  it('converts to and from the descriptive JSON model', async () => {
    const kp = await generateRsaKeyPair();
    const env = encryptEnvelope({ type: 'setup-response', recipientPublicKeyDer: kp.publicKeyDer, plaintext: randomBytes(8), compress: false });
    const model = toEnvelopeModel(env);
    expect(model.format).toBe('voucher-redeem-envelope');
    expect(fromEnvelopeModel(model).ciphertext.equals(env.ciphertext)).toBe(true);
    expect(() => fromEnvelopeModel({ ...model, extra: 1 })).toThrow();
  });
});

describe('signatures', () => {
  it('verifies valid signatures and rejects modified data or signatures', async () => {
    const kp = await generateRsaKeyPair();
    const data = Buffer.from('payload');
    const sig = signData(kp.privateKeyDer, data);
    expect(verifySignature(kp.publicKeyDer, data, sig)).toBe(true);
    expect(verifySignature(kp.publicKeyDer, Buffer.from('payloae'), sig)).toBe(false);
    const bad = Buffer.from(sig);
    bad[10] = bad[10]! ^ 1;
    expect(verifySignature(kp.publicKeyDer, data, bad)).toBe(false);
    const other = await generateRsaKeyPair();
    expect(verifySignature(other.publicKeyDer, data, sig)).toBe(false);
  });
});

describe('random values and password hashing', () => {
  it('produces UUID v4 values and uppercase identifiers', () => {
    for (let i = 0; i < 50; i++) {
      expect(newUuidV4()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(randomUpperLetters(3)).toMatch(/^[A-Z]{3}$/);
    }
  });

  it('hashes and verifies passwords', async () => {
    const h = await hashPassword('a long passphrase');
    expect(h).not.toContain('a long passphrase');
    expect(await verifyPassword('a long passphrase', h)).toBe(true);
    expect(await verifyPassword('wrong', h)).toBe(false);
    expect(await verifyPassword('x', 'garbage')).toBe(false);
  });

  it('protects secrets with the test protector and detects tampering', () => {
    const p = new MemorySecretProtector();
    const enc = p.protect(Buffer.from('secret'));
    expect(p.unprotect(enc).toString()).toBe('secret');
    enc[enc.length - 1] = enc[enc.length - 1]! ^ 1;
    expect(() => p.unprotect(enc)).toThrow();
  });
});
