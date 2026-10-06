# Security

This document describes the threat model, protections and limits of Voucher Redeem. See [CRYPTOGRAPHY.md](CRYPTOGRAPHY.md) for algorithm detail.

## What each mechanism provides

| Mechanism | Provides | Does not provide |
| --- | --- | --- |
| Hybrid encryption (RSA-OAEP + AES-256-GCM) | **Confidentiality** of vouchers and the setup transfer; tampering is detected | Authenticity on its own (anyone with the Redeemer public key can encrypt) |
| RSA-PSS digital signature | **Verification that the paired Issuer created the voucher** and that its content is unmodified | Protection against copying a genuine voucher |
| Rolling date code | **Validation of the creation-date mapping** (a voucher claiming a date must carry that date's word) | Primary protection; it is a consistency check |
| Installation identifier (three letters) | Binds a voucher to the paired installation | **It is not a password and not a secret key.** It provides negligible security by itself |
| Unique voucher UUID in the Redeemer database | **Duplicate-redemption protection** | Anything if the database is lost or restored from an older copy |
| Global expiry and clock rollback detection | Ends the voucher period; detects obvious clock tampering | Proof that the system clock is correct |

## Assets and protections

- **Private keys**: generated on the computer that uses them, never exported to the renderer, never written to logs, never placed in a barcode and never stored in plain text. They are stored encrypted with the operating system's secure storage (Electron `safeStorage`: DPAPI on Windows, Keychain on macOS). If secure storage is unavailable (or on Linux uses the weak `basic_text` backend) the application refuses to run.
- **Setup secrets** (rolling codes, installation identifier): sent only as an encrypted, signed multi-part payload and stored encrypted at rest. They are not shown to ordinary users.
- **Administrator password**: only an scrypt hash is stored. Sessions expire after 5 minutes of inactivity; five wrong attempts cause a 30-second lockout and are audited.
- **Backups**: encrypted before writing, using a separate backup password. No temporary plaintext archive.
- **Decrypted vouchers**: held in memory for the confirmation step only (5-minute ticket) and never logged. Only the validated summary is sent to the renderer.
- **Raw barcodes and camera frames**: not stored. They are decoded in memory.

## Application hardening

- `contextIsolation`, `sandbox`, no `nodeIntegration`; narrow preload with a fixed channel allow-list.
- Every IPC call is checked for a trusted sender and validated by a strict schema (unknown keys rejected, explicit maximum lengths).
- Errors returned to the UI are mapped to operator-safe messages; stack traces, keys and cryptographic detail are never shown. Sanitised technical reasons are written to the local audit log (Administration, Audit events).
- Strict Content-Security-Policy, blocked navigation and new windows, blocked network access other than the app's own origin, camera permission limited to video from the app origin.
- Electron fuses: `runAsNode` disabled, Node CLI inspection and `NODE_OPTIONS` disabled, ASAR integrity and load-only-from-ASAR enabled.
- No hard-coded keys or tokens. `Math.random()` is banned by lint rule; all random values come from Node `crypto`.
- Database rules are enforced by SQLite: a unique constraint on the voucher UUID, check constraints, triggers that forbid modifying redemptions and audit rows.
- All input is validated: pairing requests, setup envelopes/parts/payloads, voucher envelopes/payloads, database writes, IPC requests and backups. Oversized payloads, invalid base64url, impossible dates, unsupported versions, non-GBP vouchers, duplicate setup parts and mixed sessions are rejected.

## Threats and residual risk

| Threat | Mitigation | Residual risk |
| --- | --- | --- |
| Forged voucher | Needs the Issuer private key (RSA-PSS) | Compromise of the Issuer computer |
| Modified voucher | AES-GCM tag and signature | None known |
| Voucher read by a third party | Encrypted for the Redeemer key | A holder can present it; the barcode itself is the bearer token |
| Copied voucher | UUID uniqueness in the database | First presenter wins; copies are rejected once one is redeemed |
| Redeemer database deleted or rolled back | Backups; audit log | Redeemed vouchers can be accepted again |
| System clock set back | Rollback detection and blocking | Clock set back before first use, or forward past expiry cannot be independently verified |
| Stolen disk or profile | Keys protected by the OS account | Attacker running as the same OS user can use the app |
| Malicious operator | Administrator functions need the password | Operators can redeem real vouchers; Option A has no stored balances |
| Pairing interception | Issuer public key only; setup is encrypted for the Issuer and signed | An attacker who can substitute the Issuer's pairing barcode could pair with a rogue Issuer. Compare key fingerprints on both screens |

## Reporting

Report suspected vulnerabilities privately to the project maintainers. Do not include real keys or voucher data in reports.
