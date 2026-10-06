import { useEffect, useRef } from 'react';
import { WedgeParser, type WedgeConfig, type WedgeEvent } from '@shared/utilities/wedgeParser';

interface Options {
  enabled: boolean;
  config: WedgeConfig;
  onEvent: (event: WedgeEvent) => void;
  /** Called for each keystroke that looks like scanner input, even before the scan completes. */
  onActivity?: () => void;
}

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/** Listens for keyboard-wedge scanner input anywhere in the window; no text box is needed. */
export function useScannerWedge({ enabled, config, onEvent, onActivity }: Options): void {
  const parser = useRef(new WedgeParser(config));
  const onEventRef = useRef(onEvent);
  const onActivityRef = useRef(onActivity);
  onEventRef.current = onEvent;
  onActivityRef.current = onActivity;

  useEffect(() => {
    parser.current.setConfig(config);
  }, [config]);

  useEffect(() => {
    if (!enabled) {
      parser.current.reset();
      return;
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey || e.metaKey || e.altKey || isEditable(e.target)) return;
      const r = parser.current.pushKey(e.key, performance.now());
      if (r.consumed) {
        e.preventDefault();
        e.stopPropagation();
        onActivityRef.current?.();
      }
      if (r.event) onEventRef.current(r.event);
    };
    const timer = window.setInterval(() => {
      const ev = parser.current.tick(performance.now());
      if (ev) onEventRef.current(ev);
    }, 50);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.clearInterval(timer);
      parser.current.reset();
    };
  }, [enabled]);
}
