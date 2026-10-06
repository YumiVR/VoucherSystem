CREATE INDEX idx_redemptions_redeemedAt ON redemptions (redeemedAt);
CREATE INDEX idx_redemptions_fullName ON redemptions (fullName COLLATE NOCASE);
CREATE INDEX idx_audit_log_timestamp ON audit_log (eventTimestamp);
