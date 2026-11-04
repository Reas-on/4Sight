import { useEffect, useRef } from 'react';

export function useRetryShortcut(valid: boolean, retry: () => void) {
  const latest = useRef({ valid, retry }); latest.current = { valid, retry };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'r' || event.repeat || event.ctrlKey || event.altKey || event.metaKey || event.defaultPrevented ||
          !latest.current.valid || document.querySelector('dialog[open]') ||
          event.target instanceof Element && event.target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])')) return;
      event.preventDefault(); latest.current.retry();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
}
