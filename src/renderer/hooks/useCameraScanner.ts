import { useCallback, useEffect, useRef, useState } from 'react';
import { decodeImageData } from '../services/scanner';

export type CameraStatus = 'idle' | 'starting' | 'scanning' | 'denied' | 'unavailable';

interface Options {
  active: boolean;
  deviceId: string | null;
  onScan: (bytes: Uint8Array) => void;
}

/** Streams a camera into a <video> and decodes PDF417 frames locally. Frames are never stored or sent anywhere. */
export function useCameraScanner({ active, deviceId, onScan }: Options) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [status, setStatus] = useState<CameraStatus>('idle');
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  const refreshDevices = useCallback(async () => {
    const all = await navigator.mediaDevices.enumerateDevices();
    setDevices(all.filter((d) => d.kind === 'videoinput'));
  }, []);

  useEffect(() => {
    if (!active) {
      setStatus('idle');
      return;
    }
    let cancelled = false;
    let stream: MediaStream | null = null;
    let timer: number | undefined;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    const tick = async (): Promise<void> => {
      const video = videoRef.current;
      if (cancelled || !video || !ctx) return;
      if (video.readyState >= 2 && video.videoWidth > 0) {
        const scale = Math.min(1, 1600 / video.videoWidth);
        canvas.width = Math.round(video.videoWidth * scale);
        canvas.height = Math.round(video.videoHeight * scale);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        try {
          const bytes = await decodeImageData(ctx.getImageData(0, 0, canvas.width, canvas.height));
          if (bytes && !cancelled) {
            onScanRef.current(bytes);
            // Pause briefly so one held barcode is not reported many times.
            timer = window.setTimeout(() => void tick(), 1200);
            return;
          }
        } catch {
          // A failed frame is simply skipped.
        }
      }
      if (!cancelled) timer = window.setTimeout(() => void tick(), 150);
    };

    setStatus('starting');
    navigator.mediaDevices
      .getUserMedia({
        video: {
          ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: 'environment' }),
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      })
      .then(async (s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        const video = videoRef.current;
        if (video) {
          video.srcObject = s;
          await video.play().catch(() => undefined);
        }
        setStatus('scanning');
        await refreshDevices();
        void tick();
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const name = err instanceof DOMException ? err.name : '';
        setStatus(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'unavailable');
      });

    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, [active, deviceId, refreshDevices]);

  return { videoRef, status, devices };
}
