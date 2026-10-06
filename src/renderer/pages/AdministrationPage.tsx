import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { LIMITS, VOUCHER_LAYOUTS, type VoucherLayoutId } from '@shared/constants/index';
import type { AppState, AuditEntry, BrandingConfig, ExpiryInfo } from '@shared/types/api';
import { AdminUnlock, Notice } from '../components/common';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ScannerPanel } from '../components/ScannerPanel';
import { ScannerTest } from '../components/ScannerTest';
import { call, errorMessage } from '../services/api';

type Tab = 'overview' | 'branding' | 'devices' | 'scanner' | 'audit' | 'backup';

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'branding', label: 'Branding' },
  { id: 'devices', label: 'Camera and printer' },
  { id: 'scanner', label: 'Scanner test' },
  { id: 'audit', label: 'Audit events' },
  { id: 'backup', label: 'Backup and reset' },
];

interface Props {
  app: AppState;
  setApp: (s: AppState) => void;
}

export function AdministrationPage({ app, setApp }: Props) {
  const [tab, setTab] = useState<Tab>('overview');

  if (!app.adminUnlocked) {
    return (
      <section>
        <h1>Administration</h1>
        <AdminUnlock onUnlocked={setApp} hint="Sign in to change settings, view audit events or manage backups." />
      </section>
    );
  }

  return (
    <section>
      <div className="row between">
        <h1>Administration</h1>
        <button type="button" className="secondary" onClick={() => void call('admin:lock', undefined).then(setApp)}>
          Lock administration
        </button>
      </div>
      <div role="tablist" aria-label="Administration sections" className="tabs">
        {TABS.filter((t) => t.id !== 'scanner' || app.role === 'redeemer').map((t) => (
          <button key={t.id} role="tab" type="button" aria-selected={tab === t.id} className={tab === t.id ? 'tab active' : 'tab'} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {tab === 'overview' && <Overview app={app} setApp={setApp} />}
        {tab === 'branding' && <Branding />}
        {tab === 'devices' && <Devices />}
        {tab === 'scanner' && <ScannerTest />}
        {tab === 'audit' && <Audit />}
        {tab === 'backup' && <BackupReset setApp={setApp} />}
      </div>
    </section>
  );
}

// ---------- Overview ----------

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function Overview({ app, setApp }: Props) {
  const [expiry, setExpiry] = useState<ExpiryInfo | null>(null);
  const [local, setLocal] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [confirmClock, setConfirmClock] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const zone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);

  useEffect(() => {
    if (app.role !== 'redeemer') return;
    call('expiry:get', undefined).then((e) => {
      setExpiry(e);
      if (e.expiryIso) setLocal(toLocalInput(e.expiryIso));
    }, (e: unknown) => setError(errorMessage(e)));
  }, [app.role]);

  const newIso = local ? new Date(local).toISOString() : '';

  const saveExpiry = async (): Promise<void> => {
    setConfirming(false);
    setError('');
    try {
      setExpiry(await call('expiry:set', { expiryIso: newIso, timeZone: zone, confirmed: true }));
      setMessage('Global voucher expiry updated and recorded in the audit log.');
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const resolveClock = async (): Promise<void> => {
    setConfirmClock(false);
    try {
      setApp(await call('clock:resolve', { confirmed: true }));
      setMessage('Clock warning resolved. The current time is now the trusted baseline.');
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <div>
      {message && <Notice kind="success">{message}</Notice>}
      {error && <Notice kind="error">{error}</Notice>}
      {app.role === 'redeemer' && (
        <>
          <div className="card">
            <h2>Global voucher expiry</h2>
            <p>
              Current expiry: <strong>{expiry?.display ?? 'Not set'}</strong>
            </p>
            <p className="hint">All vouchers expire together at this date and time. Changing it affects every voucher immediately.</p>
            <form
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                setConfirming(true);
              }}
            >
              <label>
                New expiry date and time ({zone})
                <input type="datetime-local" value={local} onChange={(e) => setLocal(e.target.value)} required />
              </label>
              <button type="submit" className="primary" disabled={!local}>
                Change expiry…
              </button>
            </form>
          </div>
          {app.clockBlocked && (
            <div className="card warning-card">
              <h2>⚠ Clock integrity warning</h2>
              <p>The computer clock moved backwards. Redemption is blocked. Check the date and time are correct, then resolve the warning.</p>
              <button type="button" className="primary" onClick={() => setConfirmClock(true)}>
                Resolve clock warning…
              </button>
            </div>
          )}
          <ConfirmDialog open={confirming} title="Change global voucher expiry?" confirmLabel="Change expiry" onConfirm={() => void saveExpiry()} onCancel={() => setConfirming(false)}>
            <p>
              All vouchers will expire at <strong>{local ? new Date(local).toLocaleString('en-GB', { dateStyle: 'full', timeStyle: 'short' }) : ''}</strong> ({zone}).
              This change is recorded in the audit log.
            </p>
          </ConfirmDialog>
          <ConfirmDialog open={confirmClock} title="Resolve clock warning?" confirmLabel="Resolve" onConfirm={() => void resolveClock()} onCancel={() => setConfirmClock(false)}>
            <p>Only continue if you have confirmed that the computer&apos;s current date and time are correct. This is recorded in the audit log.</p>
          </ConfirmDialog>
        </>
      )}
      <PairingSummary />
      <Notice kind="info">
        A completely offline application cannot independently verify the computer clock. Keep the system time accurate.
      </Notice>
    </div>
  );
}

function PairingSummary() {
  const [text, setText] = useState('');
  useEffect(() => {
    call('pairing:getStatus', undefined).then(
      (s) =>
        setText(
          `${s.state === 'paired' ? 'Paired' : 'Not paired'} · Own key ${s.ownKeyFingerprint ?? '—'} · Paired key ${s.peerKeyFingerprint ?? '—'} · Installation identifier ${s.installationIdentifier ?? '—'}`,
        ),
      () => undefined,
    );
  }, []);
  return (
    <div className="card">
      <h2>Pairing</h2>
      <p className="mono">{text}</p>
    </div>
  );
}

// ---------- Branding ----------

function Branding() {
  const [b, setB] = useState<BrandingConfig | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    call('branding:get', undefined).then(setB, (e: unknown) => setError(errorMessage(e)));
  }, []);

  if (!b) return error ? <Notice kind="error">{error}</Notice> : <p>Loading…</p>;

  const set = <K extends keyof BrandingConfig>(k: K, v: BrandingConfig[K]): void => setB({ ...b, [k]: v });

  const onLogo = (file: File | undefined): void => {
    if (!file) return;
    const mime = file.type === 'image/png' || file.type === 'image/jpeg' ? file.type : null;
    if (!mime) return setError('The logo must be a PNG or JPEG image.');
    if (file.size > LIMITS.logoBytes) return setError('The logo must be smaller than 512 KB.');
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      set('logo', { mime, base64: result.slice(result.indexOf(',') + 1) });
      setError('');
    };
    reader.readAsDataURL(file);
  };

  const save = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError('');
    setMessage('');
    try {
      setB(await call('branding:set', b));
      setMessage('Branding saved.');
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <form className="card" onSubmit={(e) => void save(e)}>
      <h2>Voucher branding</h2>
      <label>
        Organisation name
        <input type="text" value={b.organisationName} maxLength={LIMITS.organisationName} onChange={(e) => set('organisationName', e.target.value)} required />
      </label>
      <div className="row wrap">
        <label>
          Primary colour
          <input type="color" value={b.primaryColour} onChange={(e) => set('primaryColour', e.target.value)} />
        </label>
        <label>
          Secondary colour
          <input type="color" value={b.secondaryColour} onChange={(e) => set('secondaryColour', e.target.value)} />
        </label>
        <label>
          Text colour
          <input type="color" value={b.textColour} onChange={(e) => set('textColour', e.target.value)} />
        </label>
      </div>
      <label>
        Footer text
        <input type="text" value={b.footerText} maxLength={LIMITS.footerText} onChange={(e) => set('footerText', e.target.value)} />
      </label>
      <label>
        Voucher layout
        <select value={b.layout} onChange={(e) => set('layout', e.target.value as VoucherLayoutId)}>
          {(Object.keys(VOUCHER_LAYOUTS) as VoucherLayoutId[]).map((id) => (
            <option key={id} value={id}>
              {VOUCHER_LAYOUTS[id].label}
            </option>
          ))}
        </select>
      </label>
      <p className="hint">
        The wallet card holds a dense barcode. If printed vouchers do not scan reliably, choose A6 or A5 and use the printer test.
      </p>
      <label>
        Logo (PNG or JPEG, up to 512 KB)
        <input type="file" accept="image/png,image/jpeg" onChange={(e) => onLogo(e.target.files?.[0])} />
      </label>
      {b.logo && (
        <div className="row">
          <img className="logo-preview" alt="Logo preview" src={`data:${b.logo.mime};base64,${b.logo.base64}`} />
          <button type="button" className="secondary" onClick={() => set('logo', null)}>
            Remove logo
          </button>
        </div>
      )}
      {error && <Notice kind="error">{error}</Notice>}
      {message && <Notice kind="success">{message}</Notice>}
      <button type="submit" className="primary">
        Save branding
      </button>
    </form>
  );
}

// ---------- Devices ----------

function Devices() {
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [selected, setSelected] = useState('');
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    call('scanner:getPrefs', undefined).then((p) => setSelected(p.cameraDeviceId ?? ''), () => undefined);
    navigator.mediaDevices.enumerateDevices().then((d) => setCameras(d.filter((x) => x.kind === 'videoinput')), () => undefined);
  }, [testing]);

  const saveCamera = async (): Promise<void> => {
    try {
      await call('scanner:setCamera', { deviceId: selected || null });
      setMessage('Camera preference saved.');
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const printTest = async (): Promise<void> => {
    setError('');
    try {
      const r = await call('admin:testPdf', undefined);
      setMessage(r.opened ? 'A test voucher page has opened in your PDF viewer. Print it and try scanning it.' : 'The test page could not be opened.');
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <div>
      {message && <Notice kind="success">{message}</Notice>}
      {error && <Notice kind="error">{error}</Notice>}
      <div className="card">
        <h2>Camera device</h2>
        <label>
          Preferred camera
          <select value={selected} onChange={(e) => setSelected(e.target.value)}>
            <option value="">Automatic</option>
            {cameras.map((c, i) => (
              <option key={c.deviceId} value={c.deviceId}>
                {c.label || `Camera ${i + 1}`}
              </option>
            ))}
          </select>
        </label>
        <p className="hint">Camera names appear once camera access has been granted. Run the scanner test below to grant it.</p>
        <div className="row">
          <button type="button" className="primary" onClick={() => void saveCamera()}>
            Save camera
          </button>
          <button type="button" className="secondary" onClick={() => { setResult(''); setTesting(!testing); }}>
            {testing ? 'Stop scanner test' : 'Run scanner test'}
          </button>
        </div>
        {testing && (
          <>
            <ScannerPanel
              cameraDeviceId={selected || null}
              instructions="Hold any PDF417 barcode in view. Only the barcode type and size are shown; its content is never displayed."
              onBytes={(b) => setResult(`PDF417 barcode detected (${b.length} bytes).`)}
            />
            {result && <Notice kind="success">{result}</Notice>}
          </>
        )}
      </div>
      <div className="card">
        <h2>Printer and PDF test</h2>
        <p>Opens a test voucher page using the current branding and layout, with a harmless test barcode.</p>
        <button type="button" className="primary" onClick={() => void printTest()}>
          Open test page
        </button>
      </div>
    </div>
  );
}

// ---------- Audit ----------

function Audit() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    call('audit:list', { limit: 300 }).then((r) => setEntries(r.entries), (e: unknown) => setError(errorMessage(e)));
  }, []);
  return (
    <div>
      {error && <Notice kind="error">{error}</Notice>}
      <table className="table">
        <caption className="sr-only">Audit events, newest first</caption>
        <thead>
          <tr>
            <th scope="col">Time</th>
            <th scope="col">Event</th>
            <th scope="col">Details</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id}>
              <td>{new Date(e.eventTimestamp).toLocaleString('en-GB')}</td>
              <td>{e.eventType}</td>
              <td className="mono">{e.details}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------- Backup and reset ----------

function BackupReset({ setApp }: { setApp: (s: AppState) => void }) {
  const [adminPw, setAdminPw] = useState('');
  const [backupPw, setBackupPw] = useState('');
  const [backupPw2, setBackupPw2] = useState('');
  const [restorePw, setRestorePw] = useState('');
  const [phrase, setPhrase] = useState('');
  const [resetPw, setResetPw] = useState('');
  const [resetting, setResetting] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const backup = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError('');
    setMessage('');
    if (backupPw !== backupPw2) return setError('The backup passwords do not match.');
    try {
      const r = await call('backup:create', { adminPassword: adminPw, backupPassword: backupPw });
      setMessage(r.saved ? 'Encrypted backup saved.' : 'Backup cancelled.');
      setBackupPw('');
      setBackupPw2('');
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const restore = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError('');
    setMessage('');
    try {
      const r = await call('backup:restore', { adminPassword: adminPw, backupPassword: restorePw });
      if (r.restored) {
        setApp(r.state);
        setMessage('Backup restored. Sign in again with the restored administrator password.');
      } else setMessage('Restore cancelled.');
      setRestorePw('');
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const reset = async (): Promise<void> => {
    setResetting(false);
    setError('');
    try {
      setApp(await call('installation:reset', { adminPassword: resetPw, confirmation: 'RESET' }));
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <div>
      {message && <Notice kind="success">{message}</Notice>}
      {error && <Notice kind="error">{error}</Notice>}
      <div className="card">
        <h2>Administrator password</h2>
        <label>
          Current administrator password (needed for backup, restore and reset)
          <input type="password" value={adminPw} onChange={(e) => { setAdminPw(e.target.value); setResetPw(e.target.value); }} autoComplete="current-password" />
        </label>
      </div>
      <form className="card" onSubmit={(e) => void backup(e)}>
        <h2>Create encrypted backup</h2>
        <p>The backup contains this computer&apos;s keys, configuration and redemption records, encrypted with a separate backup password.</p>
        <Notice kind="warning">Without the Redeemer private key, existing vouchers cannot be decrypted. Without the redemption database, redeemed vouchers could be presented again. Store backups safely.</Notice>
        <label>
          Backup password (at least {LIMITS.backupPasswordMin} characters)
          <input type="password" value={backupPw} onChange={(e) => setBackupPw(e.target.value)} minLength={LIMITS.backupPasswordMin} autoComplete="new-password" required />
        </label>
        <label>
          Confirm backup password
          <input type="password" value={backupPw2} onChange={(e) => setBackupPw2(e.target.value)} autoComplete="new-password" required />
        </label>
        <button type="submit" className="primary" disabled={adminPw === '' || backupPw.length < LIMITS.backupPasswordMin}>
          Create backup…
        </button>
      </form>
      <form className="card" onSubmit={(e) => void restore(e)}>
        <h2>Restore backup</h2>
        <p>Replaces the current configuration and records with those in the backup. Only a backup from the same role can be restored.</p>
        <label>
          Backup password
          <input type="password" value={restorePw} onChange={(e) => setRestorePw(e.target.value)} autoComplete="off" required />
        </label>
        <button type="submit" className="secondary" disabled={adminPw === '' || restorePw === ''}>
          Choose backup file…
        </button>
      </form>
      <div className="card danger-card">
        <h2>Reset installation</h2>
        <Notice kind="error">
          This deletes the keys, pairing, settings and redemption records on this computer. Vouchers issued for the current keys will stop working. Create an
          encrypted backup first.
        </Notice>
        <label>
          Type RESET to confirm
          <input type="text" value={phrase} onChange={(e) => setPhrase(e.target.value)} autoComplete="off" />
        </label>
        <button type="button" className="danger" disabled={phrase !== 'RESET' || adminPw === ''} onClick={() => setResetting(true)}>
          Reset installation…
        </button>
      </div>
      <ConfirmDialog open={resetting} title="Reset this installation?" confirmLabel="Delete everything and reset" danger onConfirm={() => void reset()} onCancel={() => setResetting(false)}>
        <p>This cannot be undone. The computer will return to the first-run screen.</p>
      </ConfirmDialog>
    </div>
  );
}
