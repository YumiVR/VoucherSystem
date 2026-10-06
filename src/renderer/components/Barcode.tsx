import { useEffect, useState } from 'react';
import type { BarcodeImage } from '@shared/types/api';

export function BarcodeView({ barcode, label, fill = false }: { barcode: BarcodeImage; label: string; fill?: boolean }) {
  return (
    <img
      className={fill ? 'barcode barcode-fill' : 'barcode'}
      src={barcode.dataUrl}
      alt={label}
      style={{ aspectRatio: `${barcode.widthModules} / ${barcode.heightModules}` }}
    />
  );
}

/** Shows ordered barcodes one at a time with Previous and Next controls. */
export function PartViewer({ parts, reference }: { parts: BarcodeImage[]; reference: string }) {
  const [index, setIndex] = useState(0);
  const total = parts.length;

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'ArrowRight') setIndex((i) => Math.min(total - 1, i + 1));
      if (e.key === 'ArrowLeft') setIndex((i) => Math.max(0, i - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [total]);

  const current = parts[index];
  if (!current) return null;
  return (
    <div className="part-viewer">
      <h2 aria-live="polite">
        Part {index + 1} of {total}
      </h2>
      <p>Pairing reference {reference}. Scan each part with the Issuer computer, in any order.</p>
      <BarcodeView barcode={current} label={`Setup barcode part ${index + 1} of ${total}`} fill />
      <div className="row">
        <button type="button" className="secondary large" disabled={index === 0} onClick={() => setIndex(index - 1)}>
          ← Previous
        </button>
        <button type="button" className="secondary large" disabled={index === total - 1} onClick={() => setIndex(index + 1)}>
          Next →
        </button>
      </div>
    </div>
  );
}
