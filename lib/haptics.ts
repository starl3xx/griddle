/**
 * Haptic feedback wrapper. Subtle, additive — fires on grid taps,
 * keystrokes, shake/error moments, and the solve.
 *
 * Android / Chrome: standard `navigator.vibrate` Web Vibration API.
 *
 * iOS Safari (incl. PWA): silent. Apple does not expose the Vibration
 * API to the web, and the iOS 17.4 `<input type="checkbox" switch>`
 * Taptic trick only fires when the user's finger lands directly on the
 * switch UI — synthetic `.click()` dispatched from a tap handler does
 * not drive the Taptic Engine in practice. We previously shipped that
 * approach and it produced no perceptible feedback on device, so it has
 * been removed to keep the module honest about its support matrix.
 *
 * Always honors:
 *   - `griddle_haptics_v1` localStorage preference (default on, '0' = off)
 *   - `prefers-reduced-motion: reduce` media query
 *   - try/catch around every native call — haptics are nice-to-have, must
 *     never break the game
 */

export type HapticPattern = 'tap' | 'error' | 'success';

/**
 * Single source of truth for the haptics preference's localStorage key.
 * Imported by `useHaptics.ts` so the writer (the hook) and the reader
 * (`fireHaptic` below) cannot silently desync if the key is ever bumped.
 */
export const HAPTICS_LS_KEY = 'griddle_haptics_v1';

function userPrefersOff(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    if (window.localStorage.getItem(HAPTICS_LS_KEY) === '0') return true;
  } catch {
    /* private mode — fall through */
  }
  try {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return true;
  } catch {
    /* very old browsers — ignore */
  }
  return false;
}

function fireAndroid(pattern: HapticPattern): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') {
    return false;
  }
  switch (pattern) {
    case 'tap':
      return navigator.vibrate(10);
    case 'error':
      return navigator.vibrate([15, 30, 15]);
    case 'success':
      return navigator.vibrate(25);
  }
}

export function fireHaptic(pattern: HapticPattern): void {
  if (userPrefersOff()) return;
  try {
    fireAndroid(pattern);
  } catch {
    /* swallow — haptics never break the game */
  }
}

/**
 * True if the current device exposes a haptic surface (Web Vibration
 * API on a touch device). Used to hide the Settings toggle on devices
 * where it would have no effect.
 *
 * Gated on `(pointer: coarse)` first: `navigator.vibrate` is present on
 * desktop Chrome/Firefox as a no-op even without vibration hardware, so
 * checking only the API would surface the toggle on laptops where it
 * does nothing perceptible. iOS Safari returns false here — it has no
 * Vibration API and no other reliable web-exposed taptic hook.
 */
export function hapticsAvailable(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (!window.matchMedia('(pointer: coarse)').matches) return false;
  } catch {
    return false;
  }
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
}
