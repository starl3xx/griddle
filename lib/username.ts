import { containsProfanity } from './profanity';

/**
 * Username shape: lowercase letters, digits, underscores. No
 * hyphens, no unicode, no special characters. Structural rule is
 * "one or more runs of alphanumerics separated by single underscores"
 * which rejects `__`, `_foo`, `foo_`, and `foo__bar` — all shapes the
 * flat `[a-z0-9_]+` would accept.
 *
 * Shared by /api/profile (PATCH validator), /api/profile/create
 * (slugifier), SettingsModal (client validator), and CreateProfileModal
 * (client validator). Keep this file as the single source of truth —
 * drift between the client and server checks lets bad handles slip
 * through one side.
 */

export const USERNAME_RE = /^[a-z0-9]+(_[a-z0-9]+)*$/;
export const USERNAME_MIN = 2;
export const USERNAME_MAX = 32;

export interface UsernameValidation {
  valid: boolean;
  /** Human-readable error message when `valid=false`. */
  error?: string;
}

/**
 * Validate a user-supplied username (already lowercased + trimmed).
 * Returns structured result so callers can surface the right error
 * copy. Separate from the slugifier because PATCH / form submits
 * want "reject and let the user retype" semantics, not silent
 * coercion.
 */
export function validateUsername(username: string): UsernameValidation {
  if (username.length < USERNAME_MIN) {
    return { valid: false, error: `Username must be at least ${USERNAME_MIN} characters.` };
  }
  if (username.length > USERNAME_MAX) {
    return { valid: false, error: `Username must be at most ${USERNAME_MAX} characters.` };
  }
  if (!USERNAME_RE.test(username)) {
    return {
      valid: false,
      error: 'Username can only contain lowercase letters, numbers, and underscores (no leading/trailing/double underscores).',
    };
  }
  if (containsProfanity(username)) {
    return {
      valid: false,
      error: 'Please choose a different username.',
    };
  }
  return { valid: true };
}

/**
 * Slugify arbitrary free-form input into a valid username. Used only
 * on profile CREATION paths where we need to seed a handle from
 * whatever the user (or Farcaster, or the magic-link form) gave us.
 * Never used on updates — those go through validateUsername and
 * reject-on-invalid.
 *
 * Guarantees:
 *   - Output matches USERNAME_RE if the raw input has any alphanum
 *   - Length between USERNAME_MIN and USERNAME_MAX
 *   - Trailing/leading underscores trimmed AFTER the length slice so
 *     we never produce shapes the validator would reject
 *   - Returns a `player_XXXX`-style fallback when the input has no
 *     usable characters at all (e.g. all emoji or all punctuation)
 *
 * Profanity check is NOT applied here — the slugifier is a coercion
 * helper, not a policy gate. Callers that need profanity rejection
 * should pair this with a follow-up validateUsername() call.
 */
export function slugifyUsername(raw: string): string {
  let s = raw
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .slice(0, USERNAME_MAX)
    .replace(/^_+|_+$/g, '');
  if (!s) s = 'player';
  if (s.length < USERNAME_MIN) {
    s = `${s}_player`.slice(0, USERNAME_MAX).replace(/_+$/, '');
  }
  return s;
}
