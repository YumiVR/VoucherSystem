# Data model

SQLite database (`node:sqlite`), created and upgraded only by SQL files in `migrations/`. The runner (`src/main/database/db.ts`) applies each unapplied file in a transaction and records it in `schema_migrations`. A database created by a newer version is refused. Tables are `STRICT`. Foreign keys are on, `synchronous = FULL` and `secure_delete = ON`.

## `settings`

| Column | Type | Notes |
| --- | --- | --- |
| `key` | TEXT, primary key | Setting name |
| `value` | TEXT, nullable | Plain, non-sensitive value |
| `encryptedValue` | BLOB, nullable | Value protected by OS secure storage (private key, installation identifier, rolling codes) |
| `updatedAt` | TEXT | ISO 8601 UTC |

A check constraint requires exactly one of `value` and `encryptedValue`.

Keys in use: `installation.role`, `admin.passwordHash` (scrypt hash), `keys.private` (encrypted), `keys.public`, `keys.peerPublic`, `pairing.state`, `pairing.sessionId`, `pairing.request` (public), `pairing.setupBlob` (Redeemer, already encrypted for the Issuer), `pairing.identifier` (encrypted), `pairing.rollingCodes` (encrypted), `redeemer.expiry` (JSON: UTC instant and IANA time zone), `redeemer.latestTrustedTime`, `redeemer.clockBlocked`, `branding.config`, `scanner.cameraDeviceId`.

## `audit_log` (append-only)

| Column | Type | Notes |
| --- | --- | --- |
| `id` | INTEGER, autoincrement | |
| `eventType` | TEXT | e.g. `INSTALLATION_CONFIGURED`, `PAIRING_COMPLETED`, `VOUCHER_REDEEMED`, `VOUCHER_REJECTED`, `EXPIRY_CHANGED`, `CLOCK_ROLLBACK_DETECTED`, `CLOCK_WARNING_RESOLVED`, `ADMIN_LOGIN`, `ADMIN_LOGIN_FAILED`, `BACKUP_CREATED`, `BACKUP_RESTORED`, `INSTALLATION_RESET` |
| `eventTimestamp` | TEXT | ISO 8601 UTC |
| `nonSensitiveDetails` | TEXT (max 500) | Never keys, names, barcodes or decrypted payloads. Rejections hold a failure code and a sanitised technical reason |

A trigger forbids `UPDATE`.

## `redemptions` (Redeemer)

| Column | Type | Notes |
| --- | --- | --- |
| `id` | INTEGER, autoincrement | |
| `voucherId` | TEXT, **UNIQUE** | Voucher UUID v4: the redemption key |
| `fullName` | TEXT | 1-60 characters |
| `amountPence` | INTEGER | Greater than 0 |
| `currency` | TEXT | Always `GBP` |
| `dateCreated` | TEXT | `YYYY-MM-DD` (creation local date) |
| `timeCreated` | TEXT | `HH:MM:SS` |
| `createdAt` | TEXT | ISO 8601 with UTC offset |
| `dateRedeemed` | TEXT | `YYYY-MM-DD` (local) |
| `timeRedeemed` | TEXT | `HH:MM:SS` |
| `redeemedAt` | TEXT | ISO 8601 with UTC offset |
| `installationIdentifier` | TEXT | Three letters |
| `payloadVersion` | INTEGER | |
| `recordedAt` | TEXT | ISO 8601 UTC |

The voucher UUID with `dateRedeemed` and `timeRedeemed` is the local proof of redemption. A unique constraint, not the user interface, prevents duplicates; a trigger forbids `UPDATE`. Inserts run inside `BEGIN IMMEDIATE ... COMMIT`; a unique violation is reported as "Already redeemed". Rows are validated with the `redemptionRecordSchema` Zod schema before insertion. There are no balance, total or summary tables (Option A).

## Money

Always integer pence. Parsing (`parseGbpToPence`) uses string arithmetic only. Display uses `formatPence`, e.g. `£4.00`.

## Dates and times

Stored internally as ISO 8601. Voucher creation records the local wall-clock date and time and an ISO timestamp with the UTC offset, so the creation date used for the rolling code is the Issuer's local date. The PDF shows `DD/MM/YYYY`.

## Not stored

Decrypted setup envelopes, raw camera frames, raw barcodes after processing, private keys in plain text, issued vouchers on the Issuer.
