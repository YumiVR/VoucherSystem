-- Settings: plain values in `value`; secrets in `encryptedValue` (protected with OS-bound key material).
CREATE TABLE settings (
  key            TEXT PRIMARY KEY NOT NULL,
  value          TEXT,
  encryptedValue BLOB,
  updatedAt      TEXT NOT NULL,
  CHECK ((value IS NULL) <> (encryptedValue IS NULL))
) STRICT;

-- Audit log: append-only. Never store secrets or personal data here.
CREATE TABLE audit_log (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  eventType           TEXT NOT NULL CHECK (length(eventType) BETWEEN 1 AND 64),
  eventTimestamp      TEXT NOT NULL,
  nonSensitiveDetails TEXT NOT NULL DEFAULT '' CHECK (length(nonSensitiveDetails) <= 500)
) STRICT;

CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only');
END;

-- Redemptions (Redeemer only). voucherId is the unique redemption key.
CREATE TABLE redemptions (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  voucherId              TEXT NOT NULL UNIQUE CHECK (length(voucherId) = 36),
  fullName               TEXT NOT NULL CHECK (length(fullName) BETWEEN 1 AND 60),
  amountPence            INTEGER NOT NULL CHECK (amountPence > 0),
  currency               TEXT NOT NULL CHECK (currency = 'GBP'),
  dateCreated            TEXT NOT NULL,
  timeCreated            TEXT NOT NULL,
  createdAt              TEXT NOT NULL,
  dateRedeemed           TEXT NOT NULL,
  timeRedeemed           TEXT NOT NULL,
  redeemedAt             TEXT NOT NULL,
  installationIdentifier TEXT NOT NULL CHECK (length(installationIdentifier) = 3),
  payloadVersion         INTEGER NOT NULL,
  recordedAt             TEXT NOT NULL
) STRICT;

CREATE TRIGGER redemptions_no_update BEFORE UPDATE ON redemptions
BEGIN
  SELECT RAISE(ABORT, 'redemptions cannot be modified');
END;
