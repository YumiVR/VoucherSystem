import type { AppState } from '@shared/types/api';
import { DEFAULT_AMOUNT_PENCE } from '@shared/constants/index';
import { formatPence } from '@shared/utilities/money';

export function IssuerDashboardPage({ app, go }: { app: AppState; go: (page: string) => void }) {
  return (
    <section>
      <h1>Issuer dashboard</h1>
      <div className="card">
        <p className="lead">
          Pairing: <strong>{app.pairingState === 'paired' ? '✔ Paired with the Redeemer' : '⚠ Not paired'}</strong>
        </p>
        <p>Standard voucher amount: {formatPence(DEFAULT_AMOUNT_PENCE)}</p>
      </div>
      <div className="row wrap">
        <button type="button" className="primary large" onClick={() => go('create')}>
          Create voucher
        </button>
        <button type="button" className="secondary large" onClick={() => go('pairing')}>
          Pairing status
        </button>
      </div>
    </section>
  );
}
