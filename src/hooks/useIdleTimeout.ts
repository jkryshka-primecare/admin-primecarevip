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

    const events = [
      "mousemove",
      "mousedown",
      "keydown",
      "touchstart",
      "scroll",
    ] as const;
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    document.addEventListener("visibilitychange", reset);
    reset();

    return () => {
      if (timer) window.clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, reset));
      document.removeEventListener("visibilitychange", reset);
    };
  }, [timeoutMs, enabled]);
}
