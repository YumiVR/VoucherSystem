export type RedeemFailureCode =
  | 'ALREADY_REDEEMED'
  | 'EXPIRED'
  | 'INVALID_ROLLING_CODE'
  | 'WRONG_INSTALLATION_ID'
  | 'INVALID_SIGNATURE'
  | 'DATA_ALTERED'
  | 'UNABLE_TO_DECRYPT'
  | 'WRONG_REDEEMER'
  | 'UNSUPPORTED_VERSION'
  | 'INVALID_STRUCTURE'
  | 'CORRUPTED_BARCODE'
  | 'FUTURE_DATE'
  | 'CLOCK_INTEGRITY'
  | 'DATABASE_ERROR'
  | 'SCANNER_PERMISSION_DENIED'
  | 'NOT_PAIRED'
  | 'EXPIRY_NOT_CONFIGURED'
  | 'TICKET_INVALID';

export type Severity = 'error' | 'warning';

export interface FailureInfo {
  title: string;
  advice: string;
  severity: Severity;
}

export const FAILURE_INFO: Record<RedeemFailureCode, FailureInfo> = {
  ALREADY_REDEEMED: {
    title: 'Already redeemed',
    advice: 'This voucher has already been used. Do not honour it.',
    severity: 'error',
  },
  EXPIRED: {
    title: 'Voucher expired',
    advice: 'The voucher period has ended. Do not honour it.',
    severity: 'error',
  },
  INVALID_ROLLING_CODE: {
    title: 'Invalid rolling date code',
    advice: 'The voucher date does not match this installation. Do not honour it.',
    severity: 'error',
  },
  WRONG_INSTALLATION_ID: {
    title: 'Incorrect installation identifier',
    advice: 'This voucher was not issued for this installation. Do not honour it.',
    severity: 'error',
  },
  INVALID_SIGNATURE: {
    title: 'Invalid digital signature',
    advice: 'This voucher was not signed by the paired issuer. Do not honour it.',
    severity: 'error',
  },
  DATA_ALTERED: {
    title: 'Voucher data has been altered',
    advice: 'The voucher failed its integrity check. Do not honour it.',
    severity: 'error',
  },
  UNABLE_TO_DECRYPT: {
    title: 'Unable to decrypt',
    advice: 'The voucher could not be read. Try scanning again, then ask an administrator.',
    severity: 'error',
  },
  WRONG_REDEEMER: {
    title: 'Wrong Redeemer computer',
    advice: 'This voucher was issued for a different Redeemer. Do not honour it.',
    severity: 'error',
  },
  UNSUPPORTED_VERSION: {
    title: 'Unsupported voucher version',
    advice: 'This voucher was created by an incompatible version of the application.',
    severity: 'error',
  },
  INVALID_STRUCTURE: {
    title: 'Invalid voucher structure',
    advice: 'The voucher content is not in the expected format. Do not honour it.',
    severity: 'error',
  },
  CORRUPTED_BARCODE: {
    title: 'Corrupted or incomplete PDF417',
    advice: 'The barcode could not be read completely. Clean the voucher and scan again.',
    severity: 'warning',
  },
  FUTURE_DATE: {
    title: 'Creation date is in the future',
    advice: 'The voucher claims to be created in the future. Check the computer clock.',
    severity: 'error',
  },
  CLOCK_INTEGRITY: {
    title: 'Redeemer clock integrity warning',
    advice: 'The computer clock appears to have moved backwards. An administrator must resolve this before redemption can continue.',
    severity: 'warning',
  },
  DATABASE_ERROR: {
    title: 'Database error',
    advice: 'The redemption could not be recorded. Nothing was redeemed. Contact an administrator.',
    severity: 'error',
  },
  SCANNER_PERMISSION_DENIED: {
    title: 'Scanner permission denied',
    advice: 'Allow camera access in the system settings, then try again.',
    severity: 'warning',
  },
  NOT_PAIRED: {
    title: 'Pairing not complete',
    advice: 'Complete pairing with the Issuer before redeeming vouchers.',
    severity: 'warning',
  },
  EXPIRY_NOT_CONFIGURED: {
    title: 'Global voucher expiry not set',
    advice: 'An administrator must set the global voucher expiry before redemption.',
    severity: 'warning',
  },
  TICKET_INVALID: {
    title: 'Confirmation no longer valid',
    advice: 'Scan the voucher again.',
    severity: 'warning',
  },
};
