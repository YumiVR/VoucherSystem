import { useEffect, useRef, useState } from 'react';
import type { AppState, BarcodeImage, SetupProgress } from '@shared/types/api';
import { BarcodeView, PartViewer } from '../components/Barcode';
import { Notice } from '../components/common';
import { RedeemerInput } from '../components/RedeemerInput';
import { ScannerPanel } from '../components/ScannerPanel';
import { call, errorMessage } from '../services/api';
import { bytesToBase64 } from '../services/scanner';

/** Issuer first-run pairing: show the request, then capture the Redeemer's multi-part setup. */
export function IssuerSetupPage({ app, onPaired }: { app: AppState; onPaired: () => void }) {
  const [step, setStep] = useState<'show' | 'scan'>('show');
  const [request, setRequest] = useState<{ barcode: BarcodeImage; reference: string } | null>(null);
  const [progress, setProgress] = useState<SetupProgress | null>(null);
  const [error, setError] = useState('');
  const busy = useRef(false);
  const seen = useRef(new Set<string>());

  useEffect(() => {
    call('issuer:getPairingRequest', undefined).then(setRequest, (e) => setError(errorMessage(e)));
  }, []);

  const onBytes = (bytes: Uint8Array): void => {
    if (busy.current || progress?.paired) return;
    const key = bytesToBase64(bytes);
    // A part already accepted is ignored silently so a held barcode is not captured twice.
    if (seen.current.has(key)) return;
    busy.current = true;
    call('issuer:submitSetupPart', { dataBase64: key })
      .then((p) => {
        if (p.captured.length > (progress?.captured.length ?? 0) || p.paired) seen.current.add(key);
        setProgress(p);
        setError('');
        if (p.paired) onPaired();
      })
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => {
        busy.current = false;
      });
  };

  if (step === 'show') {
    return (
      <main className="fullscreen">
        <h1>Pair with the Redeemer</h1>
        <p className="lead">On the Redeemer computer, choose &ldquo;Set up as Redeemer&rdquo; and scan this barcode. It contains no secret information.</p>
        {request ? <BarcodeView barcode={request.barcode} label="Issuer pairing request barcode" fill /> : <p>Preparing…</p>}
        <p className="reference">Pairing reference: <strong>{request?.reference ?? '…'}</strong></p>
        {error && <Notice kind="error">{error}</Notice>}
        <button type="button" className="primary large" disabled={!request} onClick={() => setStep('scan')}>
          Next: capture the Redeemer&apos;s setup barcodes
        </button>
        <p className="hint">Role: {app.role}</p>
      </main>
    );
  }

  return (
    <main className="fullscreen">
      <h1>Capture setup barcodes</h1>
      <ScannerPanel
        paused={progress?.paired === true}
        onBytes={onBytes}
        instructions="Scan each setup part shown on the Redeemer with this computer's camera. Parts can be scanned in any order. The camera is released when pairing completes."
      />
      <section aria-label="Captured parts" className="parts-status">
        <h2>{progress?.total ? `${progress.captured.length} of ${progress.total} parts captured` : 'No parts captured yet'}</h2>
        {progress?.total && (
          <ul className="chips">
            {Array.from({ length: progress.total }, (_, i) => i + 1).map((n) => (
              <li key={n} className={progress.captured.includes(n) ? 'chip done' : 'chip'}>
                {progress.captured.includes(n) ? '✔' : '○'} Part {n}
              </li>
            ))}
          </ul>
        )}
        {progress && (
          <Notice kind={progress.paired ? 'success' : 'info'}>{progress.message}</Notice>
        )}
        {error && <Notice kind="error">{error}</Notice>}
      </section>
      <button type="button" className="secondary" onClick={() => setStep('show')}>
        Back to pairing barcode
      </button>
    </main>
  );
}

/** Redeemer first-run pairing: scan the Issuer request, then display the encrypted setup parts. */
export function RedeemerSetupPage({ onPaired }: { onPaired: () => void }) {
  const [parts, setParts] = useState<{ reference: string; parts: BarcodeImage[] } | null>(null);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const busy = useRef(false);

  const onBytes = (bytes: Uint8Array): void => {
    if (busy.current) return;
    busy.current = true;
    setWorking(true);
    call('redeemer:submitPairingRequest', { dataBase64: bytesToBase64(bytes) })
      .then((r) => {
        setParts(r);
        setError('');
      })
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => {
        busy.current = false;
        setWorking(false);
      });
  };

  if (parts) {
    return (
      <main className="fullscreen">
        <h1>Send setup to the Issuer</h1>
        <PartViewer parts={parts.parts} reference={parts.reference} />
        <Notice kind="info">These barcodes are encrypted for the Issuer and are safe to display.</Notice>
        <button type="button" className="primary large" onClick={onPaired}>
          The Issuer has captured every part
        </button>
      </main>
    );
  }

  return (
    <main className="fullscreen">
      <h1>Pair with the Issuer</h1>
      <RedeemerInput
        enabled={!working}
        onBytes={onBytes}
        instructions="Scan the pairing barcode shown on the Issuer computer with the USB barcode scanner."
      />
      {working && <Notice kind="info">Creating the encrypted setup…</Notice>}
      {error && <Notice kind="error">{error}</Notice>}
    </main>
  );
}
