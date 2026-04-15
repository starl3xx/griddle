import type { FunnelEvent } from './events';

/**
 * Client-side funnel emitter. Fire-and-forget: never await it, never
 * surface errors to the UI. Uses `navigator.sendBeacon` when available
 * so page unloads don't drop events; falls back to `fetch` with
 * `keepalive: true` for the same reason.
 *
 * Identity resolution happens server-side — the client only sends the
 * event + metadata and the API handler looks up session wallet /
 * profile / id from KV. This keeps the client dumb and avoids leaking
 * identity state into every component that wants to emit an event.
 */
export function trackEvent(event: FunnelEvent): void {
  if (typeof window === 'undefined') return;

  const body = JSON.stringify(event);
  const url = '/api/telemetry/event';

  try {
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      const blob = new Blob([body], { type: 'application/json' });
      if (navigator.sendBeacon(url, blob)) return;
    }
    // Fallback: keepalive fetch lets the request survive unload.
    fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {/* swallow */});
  } catch {
    // Private mode / CSP / sendBeacon rejections — silently drop.
  }
}
