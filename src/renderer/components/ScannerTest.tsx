import { useEffect, useState } from 'react';
import { SCANNER_TEST_TEXT } from '@shared/constants/index';
import type { BarcodeImage, ScannerConfig } from '@shared/types/api';
import { DEFAULT_WEDGE_CONFIG, type WedgeEvent } from '@shared/utilities/wedgeParser';
import { useScannerWedge } from '../hooks/useScannerWedge';
import { call, errorMessage } from '../services/api';
import { BarcodeView } from './Barcode';
import { Notice } from './common';

const show = (s: string): string =>
  [...s].map((c) => (c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 ? `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}` : c)).join('');

interface Result {
  kind: 'ok' | 'mismatch' | 'rejected';
  text: string;
  detail?: string;
}

/** Administrator scanner test: reads keyboard-wedge input and compares it with a known barcode. It never validates vouchers. */
export function ScannerTest() {
  const [config, setConfig] = useState<ScannerConfig>({ ...DEFAULT_WEDGE_CONFIG });
  const [saved, setSaved] = useState<ScannerConfig>({ ...DEFAULT_WEDGE_CONFIG });
  const [barcode, setBarcode] = useState<BarcodeImage | null>(null);
  const [activity, setActivity] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    call('scanner:getConfig', undefined).then((c) => {
      setConfig(c);
      setSaved(c);
    }, (e: unknown) => setError(errorMessage(e)));
    call('scanner:getTestBarcode', undefined).then((r) => setBarcode(r.barcode), (e: unknown) => setError(errorMessage(e)));
  }, []);

  const onEvent = (ev: WedgeEvent): void => {
    if (ev.kind === 'rejected') {
      const raw = show(ev.raw.length > 80 ? `${ev.raw.slice(0, 80)}…` : ev.raw);
      const text = { incomplete: 'Incomplete scan (no terminator received).', prefix: 'Prefix not found.', suffix: 'Suffix not found.', empty: 'Empty scan.', duplicate: 'Duplicate scan ignored.' }[ev.reason];
      setResult({ kind: 'rejected', text, detail: `Received: ${raw}` });
      return;
    }
    if (ev.text === SCANNER_TEST_TEXT) {
      setResult({ kind: 'ok', text: 'PDF417 supported. The scanner sent every character correctly.' });
      return;
    }
    const idx = ev.raw.indexOf(SCANNER_TEST_TEXT);
    if (idx >= 0) {
      const lead = ev.raw.slice(0, idx);
      const trail = ev.raw.slice(idx + SCANNER_TEST_TEXT.length);
      setResult({
        kind: 'mismatch',
        text: 'The barcode was read but the scanner added extra characters. Enter them below as the prefix and suffix, then scan again.',
        detail: `Prefix detected: ${lead ? show(lead) : 'none'} · Suffix detected: ${trail ? show(trail) : 'none'}`,
      });
      return;
    }
    setResult({
      kind: 'mismatch',
      text: 'Input received, but it does not match the test barcode. Check that the scanner reads PDF417 and that its keyboard layout matches this computer.',
      detail: `Received ${ev.raw.length} characters; expected ${SCANNER_TEST_TEXT.length}.`,
    });
  };

  useScannerWedge({ enabled: true, config: saved, onEvent, onActivity: () => setActivity(true) });

  const save = async (): Promise<void> => {
    setError('');
    setMessage('');
    try {
      const c = await call('scanner:setConfig', config);
      setSaved(c);
      setConfig(c);
      setMessage('Scanner settings saved.');
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const set = <K extends keyof ScannerConfig>(k: K, v: ScannerConfig[K]): void => setConfig({ ...config, [k]: v });

  return (
    <div>
      {message && <Notice kind="success">{message}</Notice>}
      {error && <Notice kind="error">{error}</Notice>}
      <div className="card">
        <h2>Scanner test</h2>
        <p role="status" className="status">
          Status: {activity ? '✔ Scanner activity detected' : '… Waiting for scanner input'}
        </p>
        <p>Scan this barcode with the USB scanner. Nothing is redeemed and no voucher content is shown.</p>
        {barcode ? <BarcodeView barcode={barcode} label="Scanner test barcode" /> : <p>Preparing…</p>}
        {result && (
          <Notice kind={result.kind === 'ok' ? 'success' : result.kind === 'rejected' ? 'warning' : 'error'}>
            {result.text} {result.detail && <span className="mono">{result.detail}</span>}
          </Notice>
        )}
      </div>
      <form className="card" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <h2>Scanner format</h2>
        <p className="hint">Match these to the scanner&apos;s configuration. The scanner should send the barcode text followed by Enter (carriage return).</p>
        <div className="row wrap">
          <label>
            Prefix (up to 8 characters)
            <input type="text" value={config.prefix} maxLength={8} onChange={(e) => set('prefix', e.target.value)} autoComplete="off" />
          </label>
          <label>
            Suffix (up to 8 characters)
            <input type="text" value={config.suffix} maxLength={8} onChange={(e) => set('suffix', e.target.value)} autoComplete="off" />
          </label>
          <label>
            Terminator
            <select value={config.terminator} onChange={(e) => set('terminator', e.target.value as ScannerConfig['terminator'])}>
              <option value="enter">Enter / Carriage Return</option>
              <option value="tab">Tab</option>
              <option value="none">None (end of input)</option>
            </select>
          </label>
        </div>
        <button type="submit" className="primary">Save scanner settings</button>
      </form>
    </div>
  );
}
