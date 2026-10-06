import { useState, type FormEvent, type ReactNode } from 'react';
import type { AppState } from '@shared/types/api';
import { call, errorMessage } from '../services/api';

export function Notice({ kind, children }: { kind: 'error' | 'warning' | 'success' | 'info'; children: ReactNode }) {
  const icon = { error: '✖', warning: '⚠', success: '✔', info: 'ℹ' }[kind];
  return (
    <p role={kind === 'error' ? 'alert' : 'status'} className={`notice ${kind}`}>
      <span aria-hidden="true">{icon}</span> {children}
    </p>
  );
}

export function AdminUnlock({ onUnlocked, hint }: { onUnlocked: (state: AppState) => void; hint?: string }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const state = await call('admin:unlock', { password });
      setPassword('');
      onUnlocked(state);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card narrow" onSubmit={(e) => void submit(e)}>
      <h2>Administrator sign-in</h2>
      {hint && <p>{hint}</p>}
      <label>
        Administrator password
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
      </label>
      {error && <Notice kind="error">{error}</Notice>}
      <button type="submit" className="primary" disabled={busy || password === ''}>
        Sign in
      </button>
    </form>
  );
}
