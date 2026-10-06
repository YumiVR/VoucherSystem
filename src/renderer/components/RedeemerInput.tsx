import { useEffect, useState } from 'react';
import { DEFAULT_WEDGE_CONFIG, type WedgeConfig, type WedgeEvent } from '@shared/utilities/wedgeParser';
import { useScannerWedge } from '../hooks/useScannerWedge';
import { call } from '../services/api';
import { keyboardTextToBytes } from '../services/scanner';
import { ScannerPanel } from './ScannerPanel';

interface Props {
  enabled: boolean;
  instructions: string;
  onBytes: (bytes: Uint8Array) => void;
  cameraDeviceId?: string | null;
}

const REJECTION_TEXT: Record<string, string> = {
  incomplete: 'Incomplete scan ignored. Scan the barcode again.',
  prefix: 'Scan ignored: the expected prefix was missing.',
  suffix: 'Scan ignored: the expected suffix was missing.',
  empty: 'Scan ignored: it contained no data.',
  duplicate: 'Duplicate scan ignored.',
};

/** Redeemer input: a permanent ready-to-scan USB scanner mode, with an optional camera. */
export function RedeemerInput({ enabled, instructions, onBytes, cameraDeviceId = null }: Props) {
  const [config, setConfig] = useState<WedgeConfig>(DEFAULT_WEDGE_CONFIG);
  const [camera, setCamera] = useState(false);
  const [message, setMessage] = useState('');
  const [activity, setActivity] = useState(false);

  useEffect(() => {
    call('scanner:getConfig', undefined).then(setConfig, () => undefined);
  }, []);

  useEffect(() => {
    if (!activity) return;
    const t = window.setTimeout(() => setActivity(false), 600);
    return () => window.clearTimeout(t);
  }, [activity]);

  const onEvent = (ev: WedgeEvent): void => {
    if (ev.kind === 'rejected') {
      setMessage(REJECTION_TEXT[ev.reason] ?? 'Scan ignored.');
      return;
    }
    const bytes = keyboardTextToBytes(ev.text);
    if (!bytes) {
      setMessage('Scan ignored: it contained characters that cannot be barcode data.');
      return;
    }
    setMessage('');
    onBytes(bytes);
  };

  useScannerWedge({ enabled, config, onEvent, onActivity: () => setActivity(true) });

  return (
    <div>
      <div className={enabled ? 'ready-panel ready' : 'ready-panel'} role="status" aria-live="polite">
        <span className="ready-icon" aria-hidden="true">{activity ? '◉' : '●'}</span>
        <div>
          <strong>{enabled ? 'Ready to scan' : 'Scanner paused'}</strong>
          <p>{enabled ? instructions : 'Scanning is paused until you return to the scan screen.'}</p>
        </div>
      </div>
      {message && <p role="status" className="notice warning"><span aria-hidden="true">⚠</span> {message}</p>}
      <details className="optional-camera" open={camera} onToggle={(e) => setCamera(e.currentTarget.open)}>
        <summary>Use the camera instead (optional)</summary>
        {camera && (
          <ScannerPanel
            paused={!enabled}
            cameraDeviceId={cameraDeviceId}
            onBytes={onBytes}
            instructions="Hold the PDF417 barcode in front of the camera."
          />
        )}
      </details>
    </div>
  );
}
