import { useCallback, useEffect, useState } from 'react';
import type { AppState } from '@shared/types/api';
import { Notice } from './components/common';
import { call, errorMessage } from './services/api';
import { AdministrationPage } from './pages/AdministrationPage';
import { CreateVoucherPage } from './pages/CreateVoucherPage';
import { HistoryPage } from './pages/HistoryPage';
import { IssuerDashboardPage } from './pages/IssuerDashboardPage';
import { PairingPage } from './pages/PairingPage';
import { RoleSelectPage } from './pages/RoleSelectPage';
import { ScanVoucherPage } from './pages/ScanVoucherPage';
import { SettingsPage } from './pages/SettingsPage';
import { IssuerSetupPage, RedeemerSetupPage } from './pages/SetupPairingPages';

const ISSUER_NAV = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'create', label: 'Create Voucher' },
  { id: 'pairing', label: 'Pairing Status' },
  { id: 'settings', label: 'Settings' },
  { id: 'admin', label: 'Administration' },
];

const REDEEMER_NAV = [
  { id: 'scan', label: 'Scan Voucher' },
  { id: 'history', label: 'Redemption History' },
  { id: 'pairing', label: 'Pairing' },
  { id: 'settings', label: 'Settings' },
  { id: 'admin', label: 'Administration' },
];

export function App() {
  const [app, setApp] = useState<AppState | null>(null);
  const [error, setError] = useState('');
  const [page, setPage] = useState('');

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setApp(await call('app:getState', undefined));
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Administrator sessions are short-lived; poll lightly so the UI reflects expiry.
  useEffect(() => {
    if (!app?.adminUnlocked) return;
    const t = window.setInterval(() => void refresh(), 30_000);
    return () => window.clearInterval(t);
  }, [app?.adminUnlocked, refresh]);

  if (error) {
    return (
      <main className="centre">
        <Notice kind="error">{error}</Notice>
      </main>
    );
  }
  if (!app) return <main className="centre"><p>Starting…</p></main>;

  if (!app.secureStorageAvailable) {
    return (
      <main className="centre">
        <h1>Secure storage unavailable</h1>
        <Notice kind="error">
          This computer cannot protect cryptographic keys with operating-system secure storage, so the application cannot run safely. On Linux, install and unlock a
          keyring (GNOME Keyring or KWallet).
        </Notice>
      </main>
    );
  }

  if (!app.role) {
    return <RoleSelectPage launchRole={app.launchRole} onConfigured={(s) => { setApp(s); setPage(''); }} />;
  }

  if (app.pairingState !== 'paired') {
    return app.role === 'issuer' ? (
      <IssuerSetupPage app={app} onPaired={() => void refresh()} />
    ) : (
      <RedeemerSetupPage onPaired={() => void refresh()} />
    );
  }

  const nav = app.role === 'issuer' ? ISSUER_NAV : REDEEMER_NAV;
  const current = nav.some((n) => n.id === page) ? page : nav[0]!.id;

  return (
    <div className="shell">
      <a className="skip" href="#content">Skip to content</a>
      <nav aria-label="Main" className="nav">
        <div className="brand">Voucher Redeem<span>{app.role === 'issuer' ? 'Issuer' : 'Redeemer'}</span></div>
        <ul>
          {nav.map((n) => (
            <li key={n.id}>
              <button type="button" className={n.id === current ? 'nav-item active' : 'nav-item'} aria-current={n.id === current ? 'page' : undefined} onClick={() => setPage(n.id)}>
                {n.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <main id="content" className="content" tabIndex={-1}>
        {app.launchRole && app.launchRole !== app.role && (
          <Notice kind="warning">
            Launched with --role={app.launchRole}, but this installation is already configured as {app.role}. The configured role is used.
          </Notice>
        )}
        {current === 'dashboard' && <IssuerDashboardPage app={app} go={setPage} />}
        {current === 'create' && <CreateVoucherPage app={app} setApp={setApp} />}
        {current === 'scan' && <ScanVoucherPage app={app} setApp={setApp} />}
        {current === 'history' && <HistoryPage />}
        {current === 'pairing' && <PairingPage app={app} />}
        {current === 'settings' && <SettingsPage app={app} />}
        {current === 'admin' && <AdministrationPage app={app} setApp={(s) => { setApp(s); if (!s.role) setPage(''); }} />}
      </main>
    </div>
  );
}
