/**
 * Haptic feedback wrapper. Subtle, additive — fires on grid keystrokes,
 * shake/error moments, and the solve.
 *
 * Two implementation paths:
 *   - **Android / Chrome**: standard `navigator.vibrate` Web Vibration API.
 *   - **iOS Safari (17.4+)**: Apple does not expose `navigator.vibrate` to
 *     the web, but toggling a hidden `<input type="checkbox" switch>`
 *     triggers the Taptic Engine as a side-effect of the native switch
 *     animation. Capability-detected via `'switch' in HTMLInputElement
 *     .prototype`. iOS < 17.4 is silent — no audible/visible fallback.
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

let iosSwitch: HTMLInputElement | null = null;

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

function getIosSwitch(): HTMLInputElement | null {
  if (typeof document === 'undefined') return null;
  if (!('switch' in HTMLInputElement.prototype)) return null;
  if (iosSwitch && iosSwitch.isConnected) return iosSwitch;
  const el = document.createElement('input');
  el.type = 'checkbox';
  el.setAttribute('switch', '');
  el.setAttribute('aria-hidden', 'true');
  el.tabIndex = -1;
  el.style.cssText =
    'position:absolute;opacity:0;pointer-events:none;width:0;height:0;left:-9999px;';
  document.body.appendChild(el);
  iosSwitch = el;
  return el;
}

function fireIos(pattern: HapticPattern): void {
  const el = getIosSwitch();
  if (!el) return;
  // Use .click() rather than mutating .checked directly. iOS only fires
  // the Taptic Engine on user-interaction-style events; a bare property
  // assignment flips the state but never ticks the haptic. .click()
  // synthesizes the activation iOS recognizes, which both toggles the
  // switch AND fires the haptic. Called from within a real user gesture
  // (keydown / onClick) so iOS's user-activation requirement is met for
  // the `tap` and `error` patterns. The `success` pattern fires after
  // the async solve verdict resolves — outside the user-activation
  // window — so on iOS it likely no-ops; the visual glow + SolveModal
  // carry the celebration. On Android, navigator.vibrate works without
  // a gesture, so success still fires there.
  el.click();
  // Each pattern gets a distinct rhythm so they feel different in the
  // hand. We can't vary amplitude on iOS — only count + spacing.
  //   tap     → 1 click          (single light selection)
  //   error   → 2 clicks @ 60ms  (tense rapid burst)
  //   success → 3 clicks @ 80ms  (deliberate triumphant beat)
  // Synchronous back-to-back clicks coalesce into one Taptic event, so
  // each follow-up runs in its own task via setTimeout.
  if (pattern === 'error') {
    setTimeout(() => el.click(), 60);
  } else if (pattern === 'success') {
    setTimeout(() => el.click(), 80);
    setTimeout(() => el.click(), 160);
  }
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
    if (fireAndroid(pattern)) return;
    fireIos(pattern);
  } catch {
    /* swallow — haptics never break the game */
  }
}

/**
 * True if the current device exposes any haptic surface (Vibration API
 * or iOS switch). Used to hide the Settings toggle on devices where it
 * would have no effect.
 *
 * Gated on `(pointer: coarse)` first: `navigator.vibrate` is present on
 * desktop Chrome/Firefox as a no-op even without vibration hardware, so
 * checking only the API would surface the toggle on laptops where it
 * does nothing perceptible. The iOS switch path is also touch-only
 * (Safari on iPhone/iPad), so the same gate covers both.
 */
export function hapticsAvailable(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (!window.matchMedia('(pointer: coarse)').matches) return false;
  } catch {
    return false;
  }
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    return true;
  }
  if (typeof HTMLInputElement !== 'undefined' && 'switch' in HTMLInputElement.prototype) {
    return true;
  }
  return false;
}
