/**
 * USB / Bluetooth external barcode scanner support.
 * These devices emulate keyboard input – they type characters rapidly
 * and finish with Enter.
 *
 * Zebra DS4608 and similar scanners may have configurable keystroke
 * delays. Default maxDelay is 100ms to accommodate various scanner
 * configurations including Zebra HID Keyboard mode.
 */
export function createExternalScannerListener(
  onScan: (barcode: string) => void,
  options?: { maxDelay?: number; minLength?: number }
) {
  // 100ms accommodates Zebra DS4608 default and custom keystroke delay settings
  const maxDelay = options?.maxDelay ?? 100;
  const minLength = options?.minLength ?? 3;
  let buffer = "";
  let lastKeyTime = 0;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const handleKeyDown = (e: KeyboardEvent) => {
    // Ignore if user is typing in an input/textarea
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
      return;
    }

    const now = Date.now();

    // Reset buffer if too much time has passed between keystrokes
    if (now - lastKeyTime > maxDelay && buffer.length > 0) {
      buffer = "";
    }
    lastKeyTime = now;

    // Clear any pending timeout
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }

    if (e.key === "Enter") {
      if (buffer.length >= minLength) {
        e.preventDefault();
        e.stopPropagation();
        onScan(buffer.trim());
      }
      buffer = "";
      return;
    }

    // Only capture printable single characters
    if (e.key.length === 1) {
      buffer += e.key;

      // Safety timeout: if no Enter arrives within 300ms after last char,
      // and we have enough chars, submit anyway (some scanners may not send Enter)
      timeoutId = setTimeout(() => {
        if (buffer.length >= minLength) {
          onScan(buffer.trim());
        }
        buffer = "";
      }, 300);
    }
  };

  window.addEventListener("keydown", handleKeyDown, true);
  return () => {
    window.removeEventListener("keydown", handleKeyDown, true);
    if (timeoutId) clearTimeout(timeoutId);
  };
}
