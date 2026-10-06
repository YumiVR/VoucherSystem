import { useEffect, useState } from 'react';
import type { AppState, BrandingConfig, ExpiryInfo } from '@shared/types/api';
import { VOUCHER_LAYOUTS } from '@shared/constants/index';
import { Notice } from '../components/common';
import { call } from '../services/api';

export function SettingsPage({ app }: { app: AppState }) {
  const [expiry, setExpiry] = useState<ExpiryInfo | null>(null);
  const [branding, setBranding] = useState<BrandingConfig | null>(null);
  const [camera, setCamera] = useState<string | null>(null);

  useEffect(() => {
    if (app.role === 'redeemer') call('expiry:get', undefined).then(setExpiry, () => undefined);
    call('branding:get', undefined).then(setBranding, () => undefined);
    call('scanner:getPrefs', undefined).then((p) => setCamera(p.cameraDeviceId), () => undefined);
  }, [app.role]);

  return (
    <section>
      <h1>Settings</h1>
      <p className="hint">These settings are read-only. Changes are made under Administration.</p>
      <dl className="card details">
        <dt>Role</dt>
        <dd>{app.role === 'issuer' ? 'Issuer' : 'Redeemer'}</dd>
        <dt>Application version</dt>
        <dd>{app.appVersion}</dd>
        {app.role === 'redeemer' && (
          <>
            <dt>Global voucher expiry</dt>
            <dd>{expiry?.display ?? 'Not set — redemption is blocked until an administrator sets it.'}</dd>
          </>
        )}
        <dt>Camera</dt>
        <dd>{camera ? 'A specific camera is configured' : 'Automatic'}</dd>
        {branding && (
          <>
            <dt>Organisation</dt>
            <dd>{branding.organisationName}</dd>
            <dt>Voucher layout</dt>
            <dd>{VOUCHER_LAYOUTS[branding.layout].label}</dd>
          </>
        )}
      </dl>
      {app.role === 'redeemer' && !expiry?.display && <Notice kind="warning">Global voucher expiry has not been set.</Notice>}
    </section>
  );
}
