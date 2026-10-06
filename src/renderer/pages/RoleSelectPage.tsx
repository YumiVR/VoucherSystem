import { useState, type FormEvent } from 'react';
import type { Role } from '@shared/constants/index';
import { LIMITS } from '@shared/constants/index';
import type { AppState } from '@shared/types/api';
import { Notice } from '../components/common';
import { call, errorMessage } from '../services/api';

export function RoleSelectPage({ onConfigured, launchRole = null }: { onConfigured: (s: AppState) => void; launchRole?: Role | null }) {
  const [role, setRole] = useState<Role | null>(launchRole);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!role) return;
    if (password !== confirm) {
      setError('The passwords do not match.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      onConfigured(await call('setup:begin', { role, adminPassword: password }));
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  if (!role) {
    return (
      <main className="centre">
        <h1>Voucher Redeem</h1>
        <p className="lead">Choose what this computer will be used for. This cannot be changed later without an administrator reset.</p>
        <div className="role-grid">
          <button type="button" className="role-card" onClick={() => setRole('issuer')}>
            <strong>Set up as Issuer</strong>
            <span>Creates encrypted, signed vouchers as printable PDFs.</span>
          </button>
          <button type="button" className="role-card" onClick={() => setRole('redeemer')}>
            <strong>Set up as Redeemer</strong>
            <span>Scans vouchers, checks them and records each redemption.</span>
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="centre">
      <h1>Set up as {role === 'issuer' ? 'Issuer' : 'Redeemer'}</h1>
      <form className="card narrow" onSubmit={(e) => void submit(e)}>
        <Notice kind="warning">
          This computer will be locked to the {role === 'issuer' ? 'Issuer' : 'Redeemer'} role. A new key pair is generated and stored
          using this computer&apos;s secure storage.
        </Notice>
        <label>
          Choose an administrator password (at least {LIMITS.passwordMin} characters)
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={LIMITS.passwordMin} maxLength={LIMITS.passwordMax} autoComplete="new-password" required />
        </label>
        <label>
          Confirm administrator password
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
        </label>
        <p className="hint">Keep this password safe. It cannot be recovered; forgetting it requires a full reset.</p>
        {error && <Notice kind="error">{error}</Notice>}
        <div className="row">
          <button type="button" className="secondary" disabled={busy || launchRole !== null} onClick={() => setRole(null)}>
            Back
          </button>
          <button type="submit" className="primary" disabled={busy || password.length < LIMITS.passwordMin}>
            {busy ? 'Generating keys…' : 'Create installation'}
          </button>
        </div>
      </form>
    </main>
  );
}
