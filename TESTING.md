# Testing

```bash
npm run typecheck   # strict TypeScript (main + renderer)
npm run lint
npm test            # everything below
npm run test:unit
npm run test:integration
npm run test:e2e
npm run verify      # typecheck + lint + test
```

Tests run in plain Node with Vitest. Services are Electron-independent, so the real code paths are exercised with an in-memory SQLite database, a test secret protector and an injectable clock. Real PDF417 symbols are generated, rasterised and decoded with the same `zxing-wasm` library the renderer uses.

## Coverage

| Area | Where |
| --- | --- |
| Key generation, key validation | `tests/unit/crypto.test.ts` |
| Hybrid encryption and decryption, modified ciphertext/tag/IV/key/header rejection, wrong key, versions, structure | `tests/unit/crypto.test.ts` |
| Signature creation, verification, modified data and signature | `tests/unit/crypto.test.ts`, `tests/integration/rejections.test.ts` |
| Password hashing, UUID v4, random identifiers | `tests/unit/crypto.test.ts` |
| Pairing request, schema strictness, PDF417 round trip | `tests/unit/pairing.test.ts` |
| Setup encryption/decryption, multi-part splitting, out-of-order, missing, duplicate and altered parts, payload checksum failure, mixed sessions, corrupted barcodes | `tests/unit/pairing.test.ts` |
| Rolling codes, 29 February, 366 keys, word list | `tests/unit/utilities.test.ts` |
| GBP/pence conversion, canonical JSON, base64url, voucher schema and compact codec | `tests/unit/utilities.test.ts` |
| PDF417 encode/decode (binary and text) | `tests/unit/barcode.test.ts` |
| Voucher PDF layouts, scannability, long names, unsupported glyphs, logo, metadata, too-small layout | `tests/unit/pdf.test.ts` |
| Voucher creation, validation, size limit | `tests/integration/voucher.test.ts` |
| Redemption, duplicate redemption, cancel, history search and sort, database unique constraint and immutability | `tests/integration/voucher.test.ts` |
| Wrong Redeemer, wrong identifier, rolling code, invalid signature, altered data, unsupported versions, corrupted barcodes, wrong envelope type | `tests/integration/rejections.test.ts` |
| Global expiry boundary and re-check at confirmation, expiry changes audited, expiry unset, future-dated vouchers, clock rollback and resolution | `tests/integration/rejections.test.ts` |
| Backup and restore, wrong password, tampering, role mismatch, reset | `tests/integration/backup.test.ts` |
| Database migrations (apply, idempotent, failed migration rolls back, newer schema refused) | `tests/integration/backup.test.ts` |
| IPC handlers: full flow, administrator gating, lockout, no private key in responses, safe errors, request-schema strictness | `tests/integration/ipc.test.ts` |
| End-to-end development flow | `tests/e2e/fullFlow.test.ts` |

## End-to-end development test mode

`tests/e2e/fullFlow.test.ts` performs the complete sequence:

1. Create an Issuer and a Redeemer installation.
2. Pair them using simulated PDF417 (each barcode is rendered to pixels and decoded), with setup parts scanned out of order.
3. Create a £4.00 voucher.
4. Generate its PDF and verify the page size.
5. Decode the drawn PDF417 (rasterised at about 300 dpi).
6. Redeem it.
7. Attempt to redeem it again and confirm it is rejected.

It exists only in `tests/` and is never part of the production bundle, so test mode cannot be enabled in a packaged build.

## Manual checks before release

- Print a voucher at the chosen layout on the real printer and scan it with the real camera (Administration, Scanner and printer provides a test page).
- Pair two real computers, create and redeem a voucher, restart the Redeemer and confirm it is still rejected as already redeemed.
- Create a backup, reset, restore, confirm history and expiry return.
- Build the Windows installer on Windows and run through the user guide.
