import { useEffect, useRef } from "react";

/**
 * Auto-runs `onIdle` after `timeoutMs` of no user activity.
 * Resets on mouse, keyboard, touch, scroll, or visibility change.
 *
 * Used to satisfy HIPAA-style automatic logoff for PHI workstations.
 */
export function useIdleTimeout(timeoutMs: number, onIdle: () => void, enabled = true) {
  const onIdleRef = useRef(onIdle);
  useEffect(() => { onIdleRef.current = onIdle; }, [onIdle]);

  useEffect(() => {
    if (!enabled) return;

    let timer: number | undefined;
    const reset = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => onIdleRef.current(), timeoutMs);
    };

    const events: (keyof WindowEventMap)[] = [
      "mousemove",
      "mousedown",
      "keydown",
      "touchstart",
      "scroll",
      "visibilitychange",
    ];
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();

    return () => {
      if (timer) window.clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [timeoutMs, enabled]);
}
