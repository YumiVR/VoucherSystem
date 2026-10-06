import { useEffect, useState } from 'react';
import type { AppState, BarcodeImage, PairingStatus } from '@shared/types/api';
import { PartViewer } from '../components/Barcode';
import { Notice } from '../components/common';
import { call, errorMessage } from '../services/api';

export function PairingPage({ app }: { app: AppState }) {
  const [status, setStatus] = useState<PairingStatus | null>(null);
  const [parts, setParts] = useState<BarcodeImage[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    call('pairing:getStatus', undefined).then(setStatus, (e: unknown) => setError(errorMessage(e)));
  }, [app.adminUnlocked, app.pairingState]);

  const showParts = async (): Promise<void> => {
    setError('');
    try {
      setParts((await call('redeemer:getSetupParts', undefined)).parts);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <section>
      <h1>Pairing status</h1>
      {error && <Notice kind="error">{error}</Notice>}
      {status && (
        <dl className="card details">
          <dt>Status</dt>
          <dd>{status.state === 'paired' ? '✔ Paired' : '⚠ Waiting for pairing'}</dd>
          <dt>Pairing reference</dt>
          <dd>{status.sessionReference ?? 'None'}</dd>
          <dt>This computer&apos;s key fingerprint</dt>
          <dd className="mono">{status.ownKeyFingerprint ?? '—'}</dd>
          <dt>Paired computer&apos;s key fingerprint</dt>
          <dd className="mono">{status.peerKeyFingerprint ?? '—'}</dd>
          {status.installationIdentifier && (
            <>
              <dt>Installation identifier</dt>
              <dd className="mono">{status.installationIdentifier}</dd>
            </>
          )}
        </dl>
      )}
      <p className="hint">Fingerprints are public and can be compared on both computers to confirm they are paired with each other.</p>
      {status?.role === 'redeemer' && (
        <div>
          <h2>Show setup barcodes again</h2>
          <p>If the Issuer did not capture every part, an administrator can display them again.</p>
          {app.adminUnlocked ? (
            <button type="button" className="secondary" onClick={() => void showParts()}>
              Show setup barcodes
            </button>
          ) : (
            <Notice kind="info">Sign in under Administration to show the setup barcodes.</Notice>
          )}
          {parts && <PartViewer parts={parts} reference={status.sessionReference ?? ''} />}
        </div>
      )}
    </section>
  );
}
