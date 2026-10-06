import { useEffect, useRef, useState } from 'react';
import { FAILURE_INFO, type RedeemFailureCode } from '@shared/constants/messages';
import type { AppState, ConfirmOutcome, ValidateOutcome, VoucherSummary } from '@shared/types/api';
import { RedeemerInput } from '../components/RedeemerInput';
import { call, ApiError } from '../services/api';
import { bytesToBase64 } from '../services/scanner';

type Phase =
  | { kind: 'scanning' }
  | { kind: 'checking' }
  | { kind: 'confirm'; ticketId: string; voucher: VoucherSummary }
  | { kind: 'redeeming'; voucher: VoucherSummary }
  | { kind: 'success'; voucher: VoucherSummary; at: string }
  | { kind: 'failure'; code: RedeemFailureCode };

export function ScanVoucherPage({ app, setApp }: { app: AppState; setApp: (s: AppState) => void }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'scanning' });
  const [cameraId, setCameraId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const lock = useRef(false);

  useEffect(() => {
    call('scanner:getPrefs', undefined).then(
      (p) => setCameraId(p.cameraDeviceId),
      () => undefined,
    ).finally(() => setReady(true));
  }, []);

  const refreshState = (): void => {
    call('app:getState', undefined).then(setApp, () => undefined);
  };

  const onBytes = (bytes: Uint8Array): void => {
    if (lock.current) return;
    lock.current = true;
    setPhase({ kind: 'checking' });
    call('redeemer:validate', { dataBase64: bytesToBase64(bytes) })
      .then((r: ValidateOutcome) => {
        if (r.ok) setPhase({ kind: 'confirm', ticketId: r.ticketId, voucher: r.voucher });
        else {
          setPhase({ kind: 'failure', code: r.code });
          if (r.code === 'CLOCK_INTEGRITY') refreshState();
        }
      })
      .catch((e: unknown) => {
        setPhase({ kind: 'failure', code: e instanceof ApiError && e.code === 'NOT_PAIRED' ? 'NOT_PAIRED' : 'DATABASE_ERROR' });
      });
  };

  const reset = (): void => {
    lock.current = false;
    setPhase({ kind: 'scanning' });
  };

  const cancel = (ticketId: string): void => {
    void call('redeemer:cancel', { ticketId }).finally(reset);
  };

  const redeem = (ticketId: string, voucher: VoucherSummary): void => {
    setPhase({ kind: 'redeeming', voucher });
    call('redeemer:confirm', { ticketId })
      .then((r: ConfirmOutcome) => {
        if (r.ok) setPhase({ kind: 'success', voucher: r.voucher, at: `${r.redeemedDateUk} ${r.redeemedTime}` });
        else setPhase({ kind: 'failure', code: r.code });
      })
      .catch(() => setPhase({ kind: 'failure', code: 'DATABASE_ERROR' }));
  };

  return (
    <section>
      <h1>Scan voucher</h1>
      {app.clockBlocked && (
        <p role="alert" className="notice warning">
          <span aria-hidden="true">⚠</span> Redeemer clock integrity warning. Redemption is blocked until an administrator resolves it.
        </p>
      )}
      {ready && (
        <div hidden={phase.kind !== 'scanning' && phase.kind !== 'checking'}>
          <RedeemerInput
            enabled={phase.kind === 'scanning'}
            cameraDeviceId={cameraId}
            onBytes={onBytes}
            instructions="Scan the voucher's PDF417 barcode with the USB barcode scanner."
          />
          {phase.kind === 'checking' && <p role="status" className="status">Checking voucher…</p>}
        </div>
      )}

      {phase.kind === 'confirm' && (
        <div className="result-panel info" role="dialog" aria-label="Confirm redemption">
          <h2>✔ VALID VOUCHER</h2>
          <p className="big-name">{phase.voucher.fullName}</p>
          <p className="big-amount">{phase.voucher.amountDisplay}</p>
          <p>Created {phase.voucher.dateCreatedUk} · Reference {phase.voucher.reference}</p>
          <p className="hint">Honour this amount, then press Redeem to record it. This cannot be undone.</p>
          <div className="row">
            <button type="button" className="primary xl" autoFocus onClick={() => redeem(phase.ticketId, phase.voucher)}>
              Redeem
            </button>
            <button type="button" className="secondary xl" onClick={() => cancel(phase.ticketId)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {phase.kind === 'redeeming' && <p role="status" className="status">Recording redemption…</p>}

      {phase.kind === 'success' && (
        <div className="result-panel success" role="alert">
          <h2 className="result-title">✔ VALID VOUCHER</h2>
          <p className="big-name">{phase.voucher.fullName}</p>
          <p className="big-amount">{phase.voucher.amountDisplay}</p>
          <p>Redemption recorded at {phase.at}.</p>
          <button type="button" className="primary xl" autoFocus onClick={reset}>
            Scan next voucher
          </button>
        </div>
      )}

      {phase.kind === 'failure' && (
        <div className={`result-panel ${FAILURE_INFO[phase.code].severity === 'warning' ? 'warning' : 'error'}`} role="alert">
          <h2 className="result-title">
            {FAILURE_INFO[phase.code].severity === 'warning' ? '⚠' : '✖'} {FAILURE_INFO[phase.code].title}
          </h2>
          <p className="big-advice">{FAILURE_INFO[phase.code].advice}</p>
          <button type="button" className="primary xl" autoFocus onClick={reset}>
            Scan again
          </button>
        </div>
      )}
    </section>
  );
}
