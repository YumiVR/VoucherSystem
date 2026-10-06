import { useRef, useState } from 'react';
import { useCameraScanner } from '../hooks/useCameraScanner';
import { decodeImageFile } from '../services/scanner';

interface Props {
  onBytes: (bytes: Uint8Array) => void;
  /** When true the camera is released and input is ignored. */
  paused?: boolean;
  cameraDeviceId?: string | null;
  instructions: string;
}

/** Live camera preview that continuously decodes PDF417 only; other barcode formats are ignored. */
export function ScannerPanel({ onBytes, paused = false, cameraDeviceId = null, instructions }: Props) {
  const [chosen, setChosen] = useState<string | null>(cameraDeviceId);
  const [note, setNote] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  const emit = (bytes: Uint8Array): void => {
    if (!pausedRef.current) onBytes(bytes);
  };
  const { videoRef, status, devices } = useCameraScanner({ active: !paused, deviceId: chosen, onScan: emit });

  const onFile = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    setNote('Reading image…');
    try {
      const bytes = await decodeImageFile(file);
      if (bytes) {
        setNote('');
        emit(bytes);
      } else {
        setNote('No PDF417 barcode was found in that image.');
      }
    } catch {
      setNote('That image could not be read.');
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  const statusText: Record<typeof status, string> = {
    idle: 'Camera is off.',
    starting: 'Starting camera…',
    scanning: 'Camera ready. Hold the barcode steadily in view.',
    denied: 'Camera permission was denied. Allow camera access in your system settings, then reload.',
    unavailable: 'No camera could be started. You can still import an image.',
  };

  return (
    <section className="scanner" aria-label="Camera scanner">
      <p className="instructions">{instructions}</p>
      <div className="video-frame">
        <video ref={videoRef} muted playsInline aria-label="Camera preview" />
        {status === 'scanning' && <div className="scan-guide" aria-hidden="true" />}
      </div>
      <p role="status" aria-live="polite" className={status === 'denied' ? 'status warning' : 'status'}>
        {status === 'denied' ? '⚠ ' : ''}
        {statusText[status]}
      </p>
      <div className="row wrap">
        {devices.length > 1 && (
          <label>
            Camera
            <select value={chosen ?? devices[0]?.deviceId ?? ''} onChange={(e) => setChosen(e.target.value)}>
              {devices.map((d, i) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `Camera ${i + 1}`}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="button secondary file-button">
          Import barcode image
          <input ref={fileRef} type="file" accept="image/*" onChange={(e) => void onFile(e.target.files?.[0])} />
        </label>
      </div>
      {note && (
        <p role="status" className="status warning">
          ⚠ {note}
        </p>
      )}
    </section>
  );
}
