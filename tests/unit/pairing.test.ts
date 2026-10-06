import { describe, expect, it } from 'vitest';
import { generateRsaKeyPair, sha256Hex } from '../../src/main/crypto/keys';
import {
  PairingError,
  SetupAssembler,
  buildSetupBlob,
  createPairingRequest,
  openSetupBlob,
  parsePairingRequest,
  setupPartText,
  splitSetupBlob,
} from '../../src/main/pairing/protocol';
import { generateRollingDateCodes } from '../../src/main/pairing/rollingCodes';
import { encodePdf417, matrixToRgba } from '../../src/main/pdf/barcode';
import { decodePdf417 } from '../helpers/decode';

async function setup() {
  const issuer = await generateRsaKeyPair();
  const redeemer = await generateRsaKeyPair();
  const { request, text } = createPairingRequest(issuer.publicKeyDer, new Date('2026-03-10T10:00:00.000Z'));
  const parsed = parsePairingRequest(Buffer.from(text));
  const codes = generateRollingDateCodes();
  const blob = buildSetupBlob({
    request: parsed.request,
    issuerPublicKeyDer: parsed.issuerPublicKeyDer,
    redeemerPublicKeyDer: redeemer.publicKeyDer,
    redeemerPrivateKeyDer: redeemer.privateKeyDer,
    identifier: 'QZK',
    rollingDateCodes: codes,
    now: new Date('2026-03-10T10:01:00.000Z'),
  });
  return { issuer, redeemer, request, text, blob, codes };
}

const bytes = (s: string): Buffer => Buffer.from(s, 'utf8');

describe('pairing request', () => {
  it('contains only public information and validates strictly', async () => {
    const { request, text, issuer } = await setup();
    expect(request.type).toBe('issuer-pairing-request');
    expect(text).not.toContain(issuer.privateKeyDer.toString('base64').slice(0, 20));
    expect(() => parsePairingRequest(bytes('{"type":"x"}'))).toThrow(PairingError);
    expect(() => parsePairingRequest(bytes('not json'))).toThrow(PairingError);
    expect(() => parsePairingRequest(bytes(text.replace('"version":1', '"version":1,"extra":1')))).toThrow(PairingError);
  });

  it('fits in a single decodable PDF417', async () => {
    const { text } = await setup();
    const m = encodePdf417(text, { columns: 12, eclevel: 4 });
    const decoded = await decodePdf417(matrixToRgba(m, 3));
    expect(decoded?.toString('utf8')).toBe(text);
  });
});

describe('setup transfer', () => {
  it('encrypts for the issuer, signs by the redeemer and decrypts', async () => {
    const { issuer, redeemer, request, blob, codes } = await setup();
    const payload = openSetupBlob(blob, issuer.privateKeyDer, request.pairingSessionId);
    expect(payload.identifier).toBe('QZK');
    expect(payload.rollingDateCodes).toEqual(codes);
    expect(Object.keys(payload.rollingDateCodes)).toHaveLength(366);
    expect(payload.redeemerPublicKey.length).toBeGreaterThan(100);
    expect(() => openSetupBlob(blob, redeemer.privateKeyDer, request.pairingSessionId)).toThrow(/decrypted/);
  });

  it('rejects a mismatched pairing session', async () => {
    const { issuer, blob } = await setup();
    expect(() => openSetupBlob(blob, issuer.privateKeyDer, '00000000-0000-4000-8000-000000000000')).toThrow(/another pairing session/);
  });

  it('splits into the smallest sensible number of ordered parts, each decodable as PDF417', async () => {
    const { blob, request } = await setup();
    const { parts } = splitSetupBlob(blob, request.pairingSessionId);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.length).toBeLessThanOrEqual(12);
    parts.forEach((p, i) => {
      expect(p.partNumber).toBe(i + 1);
      expect(p.totalParts).toBe(parts.length);
    });
    const first = setupPartText(parts[0]!);
    const decoded = await decodePdf417(matrixToRgba(encodePdf417(first, { columns: 14, eclevel: 4 }), 3));
    expect(decoded?.toString('utf8')).toBe(first);
  });

  it('reassembles parts scanned out of order', async () => {
    const { blob, request } = await setup();
    const { parts } = splitSetupBlob(blob, request.pairingSessionId);
    const a = new SetupAssembler(request.pairingSessionId);
    const order = [...parts].reverse();
    const mid = order.splice(1, 1);
    order.push(...mid);
    for (const p of order) a.addPart(bytes(setupPartText(p)));
    expect(a.isComplete).toBe(true);
    expect(a.assemble().equals(blob)).toBe(true);
  });

  it('does not assemble with missing parts', async () => {
    const { blob, request } = await setup();
    const { parts } = splitSetupBlob(blob, request.pairingSessionId);
    const a = new SetupAssembler(request.pairingSessionId);
    for (const p of parts.slice(0, -1)) a.addPart(bytes(setupPartText(p)));
    expect(a.isComplete).toBe(false);
    expect(() => a.assemble()).toThrow(/Not all parts/);
  });

  it('rejects duplicate, altered and foreign parts', async () => {
    const { blob, request } = await setup();
    const { parts } = splitSetupBlob(blob, request.pairingSessionId);
    const a = new SetupAssembler(request.pairingSessionId);
    a.addPart(bytes(setupPartText(parts[0]!)));
    expect(() => a.addPart(bytes(setupPartText(parts[0]!)))).toThrow(/already captured/);

    const altered = { ...parts[1]!, chunk: 'A' + parts[1]!.chunk.slice(1) };
    expect(() => a.addPart(bytes(JSON.stringify(altered)))).toThrow(/checksum/i);

    const foreign = { ...parts[1]!, pairingSessionId: '11111111-1111-4111-8111-111111111111' };
    expect(() => a.addPart(bytes(JSON.stringify(foreign)))).toThrow(/another pairing session/);

    // Same part number with a different, self-consistent chunk is reported as altered.
    const chunk = parts[0]!.chunk.slice(0, -1) + (parts[0]!.chunk.endsWith('A') ? 'B' : 'A');
    const forged = { ...parts[0]!, chunk, chunkChecksum: sha256Hex(chunk) };
    try {
      a.addPart(bytes(JSON.stringify(forged)));
      expect.unreachable();
    } catch (e) {
      expect((e as PairingError).reason).toBe('altered');
    }
  });

  it('rejects parts from a different payload mid-session', async () => {
    const first = await setup();
    const second = await setup();
    const a = new SetupAssembler(first.request.pairingSessionId);
    a.addPart(bytes(setupPartText(splitSetupBlob(first.blob, first.request.pairingSessionId).parts[0]!)));
    const other = splitSetupBlob(second.blob, first.request.pairingSessionId).parts[1]!;
    expect(() => a.addPart(bytes(setupPartText(other)))).toThrow(/does not match/);
  });

  it('detects a full-payload checksum failure even when every chunk checksum is valid', async () => {
    const { blob, request } = await setup();
    const { parts } = splitSetupBlob(blob, request.pairingSessionId);
    const a = new SetupAssembler(request.pairingSessionId);
    const forgedParts = parts.map((p, i) => {
      if (i !== 0) return p;
      const chunk = p.chunk.slice(0, 10) + (p.chunk[10] === 'A' ? 'B' : 'A') + p.chunk.slice(11);
      return { ...p, chunk, chunkChecksum: sha256Hex(chunk) };
    });
    for (const p of forgedParts) a.addPart(bytes(JSON.stringify(p)));
    expect(() => a.assemble()).toThrow(/checksum/i);
  });

  it('rejects corrupted barcode content', () => {
    const a = new SetupAssembler('11111111-1111-4111-8111-111111111111');
    expect(() => a.addPart(Buffer.from([0xff, 0xfe, 0x00]))).toThrow(PairingError);
    expect(() => a.addPart(bytes('{"type":"setup-part"}'))).toThrow(PairingError);
  });
});
