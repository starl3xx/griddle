'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Moon,
  Sun,
  Envelope,
  Wallet,
  Crown,
  ShieldCheck,
  Eye,
  EyeSlash,
  CircleNotch,
  Check,
  Gear,
  Camera,
  Timer,
  PencilSimple,
  ArrowRight,
} from '@phosphor-icons/react';
import { Avatar } from './Avatar';
import { FaqAccordion } from './FaqAccordion';
import { OtpCodeInput } from './OtpCodeInput';
import { uploadAvatar } from '@/lib/avatar-upload';
import { suggestUsernameFromWallet, validateUsername } from '@/lib/username';
import { getDefaultAvatarDataUri, pickAvatarSeed } from '@/lib/default-avatar';

/**
 * Shape of the profile object surfaced by GET /api/profile. Kept narrow
 * on purpose — we only pull the fields SettingsModal renders or edits.
 */
export interface ProfileSnapshot {
  id: number;
  email: string | null;
  emailVerifiedAt: string | null;
  /**
   * User's public username. Stored in the `handle` column on profiles
   * — we kept the DB name but renamed everywhere else to "username"
   * when the old two-field (display_name + handle) design collapsed
   * into a single field.
   */
  handle: string | null;
  avatarUrl: string | null;
  wallet: string | null;
  premiumSource: 'crypto' | 'fiat' | 'admin_grant' | null;
}

interface SettingsResponse {
  streakProtectionEnabled: boolean;
  streakProtectionUsedAt: string | null;
  unassistedModeEnabled: boolean;
  darkModeEnabled: boolean;
}

interface SettingsModalProps {
  open: boolean;
  /** The bound profile, or null for anonymous sessions. */
  profile: ProfileSnapshot | null;
  /**
   * The wallet currently bound to the session via KV, or null. Used
   * to detect the "wallet-connected but no profile row yet" state so
   * Settings can render the onboarding flow with a wallet-derived
   * suggested username instead of a generic empty input.
   */
  sessionWallet: string | null;
  premium: boolean;
  dark: boolean;
  onToggleDark: () => void;
  /**
   * Zen mode — when true, GameClient hides the in-game timer pill.
   * Available to all users (no premium gate): solve timing is still
   * recorded server-side for the leaderboard, this just stops
   * showing the clock on screen.
   */
  zen: boolean;
  onToggleZen: () => void;
  /** Called when profile state mutates so the parent can re-fetch. */
  onProfileChanged: () => void;
  /** Called when unassisted mode is toggled so the game grid updates. */
  onUnassistedChanged: (enabled: boolean) => void;
  onClose: () => void;
  /** Opens CreateProfileModal in the parent. */
  onCreateProfile: () => void;
  /** Triggers the wallet connector picker. */
  onConnect: () => void;
  /** Opens the PremiumGateModal in its 'premium' variant. */
  onUpgrade: () => void;
  /** Re-checks premium server-side (post-admin-grant or post-fiat). */
  onRefreshPremium: () => void;
}

// Mirrors the 7-day cooldown constant in lib/db/queries.ts / the settings API
const PROTECTION_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Settings modal — all identity and preferences surfaces, accessed via
 * the top-right gear/avatar button.
 *
 * Renders one of four mutually exclusive modes:
 *   - **anonymous**: no profile, no wallet, not premium. Shows the
 *     three onboarding CTAs (sign in, connect wallet, upgrade).
 *   - **premium-no-profile**: paid via fiat without picking an
 *     identity. Shows sign-in/connect prompts so the unlock can
 *     follow them across devices.
 *   - **onboarding**: identity bound (wallet or email) but no `handle`
 *     yet. One focused task: pick a username. Wallet-first users get a
 *     `griddle_<hex>` suggestion pre-filled; email-first users start
 *     empty. Single primary CTA.
 *   - **settings**: handle exists. Read-mostly identity panel with
 *     atomic per-row editors (username, photo) and the existing
 *     sign-in-methods, preferences, premium, and FAQ sections. There
 *     is no global "Save profile" button — each row that *can* edit
 *     manages its own dirty state and Save call.
 *
 * Splitting modes structurally (not via guards inside one render path)
 * is what kills the historical "Save profile / Nothing to save" bug:
 * the global save affordance only renders in the one mode where it
 * has work to do (onboarding's Continue button, which always writes).
 */
export function SettingsModal({
  open,
  profile,
  sessionWallet,
  premium,
  dark,
  onToggleDark,
  zen,
  onToggleZen,
  onProfileChanged,
  onUnassistedChanged,
  onClose,
  onCreateProfile,
  onConnect,
  onUpgrade,
  onRefreshPremium,
}: SettingsModalProps) {
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [savingProtection, setSavingProtection] = useState(false);
  const [savingUnassisted, setSavingUnassisted] = useState(false);

  // Inline add-email state for wallet-only users
  const [emailDraft, setEmailDraft] = useState('');
  const [emailSending, setEmailSending] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailSentTo, setEmailSentTo] = useState<string | null>(null);

  const hasIdentity = !!profile;
  const hasHandle = hasIdentity && !!profile.handle;
  const mode: 'anonymous' | 'premium-no-profile' | 'onboarding' | 'settings' =
    hasHandle
      ? 'settings'
      : hasIdentity || sessionWallet
        ? 'onboarding'
        : premium
          ? 'premium-no-profile'
          : 'anonymous';

  // Reset email-add status on every open transition.
  useEffect(() => {
    if (!open) return;
    setEmailDraft('');
    setEmailError(null);
    setEmailSentTo(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (!premium) { setSettings(null); return; }
    let cancelled = false;
    fetch('/api/settings')
      .then((r) => (r.ok ? r.json() : null))
      .then((s: SettingsResponse | null) => { if (!cancelled) setSettings(s); })
      .catch(() => {/* best-effort */});
    return () => { cancelled = true; };
  }, [open, premium]);

  const toggleSetting = async (field: 'streakProtectionEnabled' | 'unassistedModeEnabled') => {
    if (!settings) return;
    const current = field === 'streakProtectionEnabled'
      ? settings.streakProtectionEnabled
      : settings.unassistedModeEnabled;
    const next = !current;
    const setSaving = field === 'streakProtectionEnabled' ? setSavingProtection : setSavingUnassisted;
    setSaving(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ [field]: next }),
      });
      if (res.ok) {
        const updated = (await res.json()) as SettingsResponse;
        setSettings(updated);
        if (field === 'unassistedModeEnabled') {
          onUnassistedChanged(updated.unassistedModeEnabled);
        }
      }
    } catch {/* best-effort */} finally {
      setSaving(false);
    }
  };

  const sendAddEmail = async () => {
    setEmailError(null);
    const trimmed = emailDraft.trim().toLowerCase();
    if (!EMAIL_RE.test(trimmed)) {
      setEmailError('Enter a valid email address.');
      return;
    }
    setEmailSending(true);
    try {
      const res = await fetch('/api/auth/request', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: trimmed }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error ?? 'Failed to send email');
      }
      setEmailSentTo(trimmed);
    } catch (err) {
      setEmailError(err instanceof Error ? err.message : 'Failed to send');
    } finally {
      setEmailSending(false);
    }
  };

  if (!open) return null;

  // Identity resolution for the header. Pulled through the shared
  // `pickAvatarSeed` helper so the gear button, this header, and the
  // StatsPanel header all derive the same monogram for the same user.
  const headerSeed = pickAvatarSeed({
    handle: profile?.handle,
    wallet: sessionWallet,
    email: profile?.email,
  });
  const headerLabel =
    profile?.handle?.trim()
    || (mode === 'onboarding'
      ? 'Welcome — pick a username'
      : sessionWallet
        ? `${sessionWallet.slice(0, 6)}…${sessionWallet.slice(-4)}`
        : 'Anonymous');

  // Streak protection cooldown (mirrors StatsModal logic)
  const protectionUsedAt = settings?.streakProtectionUsedAt
    ? new Date(settings.streakProtectionUsedAt)
    : null;
  const protectionOnCooldown = protectionUsedAt
    ? Date.now() - protectionUsedAt.getTime() < PROTECTION_COOLDOWN_MS
    : false;
  const cooldownDaysLeft = protectionOnCooldown && protectionUsedAt
    ? Math.ceil((PROTECTION_COOLDOWN_MS - (Date.now() - protectionUsedAt.getTime())) / (24 * 60 * 60 * 1000))
    : 0;

  return (
    // Outer overlay respects the device safe-area insets so the modal
    // isn’t hidden behind iPhone notches, home indicators, or mobile-
    // browser chrome. Using `max()` means we still get the nominal 1rem
    // gutter on devices without insets, and the inset only kicks in
    // when it’s larger than the base gutter.
    //
    // `100dvh` (dynamic viewport) replaces 100vh for the height cap so
    // iOS Safari's URL-bar show/hide cycle doesn't make the modal taller
    // than the visible area. `92vh` on Safari with the URL bar showing
    // was producing exactly the "content clipped at the edges" the bug
    // report described. `svh` fallback covers older engines.
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 animate-fade-in"
      style={{
        paddingTop: 'max(1rem, env(safe-area-inset-top))',
        paddingBottom: 'max(1rem, env(safe-area-inset-bottom))',
        paddingLeft: 'max(1rem, env(safe-area-inset-left))',
        paddingRight: 'max(1rem, env(safe-area-inset-right))',
      }}
      onClick={onClose}
    >
      <div
        className="modal-sheet animate-slide-up max-h-[92svh] supports-[height:100dvh]:max-h-[92dvh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 mb-5">
          <Avatar pfpUrl={profile?.avatarUrl ?? null} seed={headerSeed} />
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold tracking-tight text-gray-900 dark:text-gray-100 truncate">
              {headerLabel}
            </h2>
            <p className="text-xs font-medium text-gray-500 flex items-center gap-1.5">
              <Gear className="w-3 h-3" weight="bold" aria-hidden />
              Settings
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors duration-fast"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="w-4 h-4" aria-hidden>
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        {mode === 'anonymous' && (
          <div className="py-2 space-y-3">
            <p className="text-sm text-gray-600 dark:text-gray-400 text-center leading-relaxed">
              Sign in to track your streaks, fastest times, and carry your progress across devices.
            </p>
            <button type="button" onClick={onCreateProfile} className="btn-primary w-full">
              Sign in
            </button>
            <button type="button" onClick={onConnect} className="btn-secondary w-full">
              Connect wallet
            </button>
            <button type="button" onClick={onUpgrade} className="btn-accent w-full inline-flex items-center justify-center gap-2">
              <Crown className="w-4 h-4" weight="fill" aria-hidden />
              Upgrade to Premium <span className="font-medium text-white/80">(card or crypto)</span>
            </button>
          </div>
        )}

        {mode === 'premium-no-profile' && (
          <div className="py-2 space-y-3">
            <p className="text-sm text-gray-600 dark:text-gray-400 text-center leading-relaxed">
              You’re Premium. Sign in so your access follows you across devices.
            </p>
            <button type="button" onClick={onCreateProfile} className="btn-primary w-full">
              Sign in
            </button>
            <button type="button" onClick={onConnect} className="btn-secondary w-full">
              Connect wallet
            </button>
          </div>
        )}

        {mode === 'onboarding' && (
          <OnboardingPanel
            sessionWallet={sessionWallet}
            email={profile?.email ?? null}
            onCreated={onProfileChanged}
          />
        )}

        {mode === 'settings' && profile && (
          <Section title="Profile">
            <EditableUsernameRow
              handle={profile.handle ?? ''}
              premium={premium}
              onSaved={onProfileChanged}
              onUpgrade={onUpgrade}
            />
            <EditablePhotoRow
              avatarUrl={profile.avatarUrl}
              seed={pickAvatarSeed({
                handle: profile.handle,
                wallet: profile.wallet,
                email: profile.email,
              }) ?? 'guest'}
              premium={premium}
              onSaved={onProfileChanged}
              onUpgrade={onUpgrade}
            />
          </Section>
        )}

        {/* Sign-in methods — render for everyone with at least one
            identity signal (profile row OR session wallet). */}
        {(hasIdentity || sessionWallet) && (
          <Section title="Sign-in methods">
            <IdentityRow
              icon={<Envelope className="w-4 h-4" weight="bold" />}
              label="Email"
              value={profile?.email ?? null}
              verified={!!profile?.emailVerifiedAt}
            />
            {/* Inline add-email flow. Only shown when the user
                already has a saved profile row (hasIdentity). Gating
                on hasIdentity (not hasIdentity || sessionWallet)
                prevents a race where a wallet-only user sees both
                the onboarding form and this email form at the
                same time, fires the email first, and clicks the
                magic link before completing the profile — the
                verify route would then create an email-only profile
                with no wallet (because no wallet-linked row exists
                to merge into), orphaning the session wallet. */}
            {hasIdentity && !profile?.email && (
              <div className="space-y-2">
                {emailSentTo ? (
                  <>
                    <p className="text-[12px] text-gray-600 dark:text-gray-400 bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-800 rounded-md px-3 py-2">
                      Sign-in link sent to <strong>{emailSentTo}</strong>. Tap it, or paste the 6-digit code from the email below — handy when you’re using the installed PWA and the link would otherwise open in a browser.
                    </p>
                    <OtpCodeInput
                      email={emailSentTo}
                      prompt="Got the code? Enter it here"
                      onVerified={() => {
                        setEmailSentTo(null);
                        onProfileChanged();
                      }}
                    />
                  </>
                ) : (
                  <>
                    <input
                      type="email"
                      value={emailDraft}
                      onChange={(e) => setEmailDraft(e.target.value)}
                      placeholder="you@example.com"
                      className="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand focus:border-brand"
                      autoComplete="email"
                    />
                    {emailError && (
                      <p className="text-[12px] text-red-600 dark:text-red-400">{emailError}</p>
                    )}
                    <button
                      type="button"
                      onClick={sendAddEmail}
                      disabled={emailSending}
                      className="btn-secondary w-full text-sm inline-flex items-center justify-center gap-2"
                    >
                      {emailSending
                        ? <CircleNotch className="w-4 h-4 animate-spin" weight="bold" aria-hidden />
                        : <Envelope className="w-4 h-4" weight="bold" aria-hidden />}
                      Send sign-in link
                    </button>
                  </>
                )}
              </div>
            )}
            {!hasIdentity && sessionWallet && (
              <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">
                Pick a username above first, then you can add an email to sign in from other devices.
              </p>
            )}

            <IdentityRow
              icon={<Wallet className="w-4 h-4" weight="bold" />}
              label="Wallet"
              value={
                profile?.wallet
                  ? `${profile.wallet.slice(0, 6)}…${profile.wallet.slice(-4)}`
                  : sessionWallet
                    ? `${sessionWallet.slice(0, 6)}…${sessionWallet.slice(-4)}`
                    : null
              }
            />
            {!profile?.wallet && !sessionWallet && (
              <button
                type="button"
                onClick={onConnect}
                className="btn-secondary w-full text-sm"
              >
                Connect wallet
              </button>
            )}
          </Section>
        )}

        {/* Preferences — dark mode + zen mode always, premium settings conditionally */}
        <Section title="Preferences">
          <ToggleRow
            icon={dark
              ? <Sun className="w-4 h-4" weight="bold" />
              : <Moon className="w-4 h-4" weight="bold" />}
            label="Dark mode"
            description={dark ? 'Dark theme across all devices' : 'Light theme'}
            checked={dark}
            disabled={false}
            onChange={onToggleDark}
          />
          <ToggleRow
            icon={<Timer className="w-4 h-4" weight="bold" />}
            label="Zen mode"
            description={
              zen
                ? 'Timer hidden — just you and the grid'
                : 'Hide the timer while you play'
            }
            checked={zen}
            disabled={false}
            onChange={onToggleZen}
          />

          {/* Premium preferences — always rendered so non-premium
              users see them as a feature preview. When !premium the
              toggles are disabled and get a "Premium" badge; the
              description copy flips to an upsell tease. This is a
              deliberate UX nudge: showing "you could have this" is
              a stronger upgrade prompt than hiding the settings
              entirely. */}
          <ToggleRow
            icon={<ShieldCheck className="w-4 h-4" weight="bold" />}
            label="Streak protection"
            premiumLocked={!premium}
            description={
              !premium
                ? 'Save your streak once per week if you miss a day'
                : protectionOnCooldown
                  ? `Available again in ${cooldownDaysLeft}d`
                  : settings?.streakProtectionEnabled
                    ? 'Armed — will save your streak once'
                    : 'Saves your streak if you miss a day'
            }
            checked={premium ? (settings?.streakProtectionEnabled ?? false) : false}
            disabled={!premium || savingProtection || protectionOnCooldown}
            onChange={() => toggleSetting('streakProtectionEnabled')}
          />
          <ToggleRow
            icon={settings?.unassistedModeEnabled
              ? <EyeSlash className="w-4 h-4" weight="bold" />
              : <Eye className="w-4 h-4" weight="bold" />}
            label="Unassisted mode"
            premiumLocked={!premium}
            description={
              !premium
                ? 'Hide cell hints for a Blameless Wordmark on solves'
                : 'Hides cell hints — earn 🎯 Blameless for solving blind'
            }
            checked={premium ? (settings?.unassistedModeEnabled ?? false) : false}
            disabled={!premium || savingUnassisted}
            onChange={() => toggleSetting('unassistedModeEnabled')}
          />
        </Section>

        {/* Premium status — upsell if not premium but has an account
            OR a connected wallet (covers the "wallet connected, no
            profile row yet" path). Fully anonymous users see the
            onboarding CTAs above and don't need this section at all,
            so skip it entirely to avoid an orphaned "PREMIUM" header
            with no body. */}
        {(premium || hasIdentity || sessionWallet) && (
          <Section title="Premium">
            {premium ? (
              <div className="flex items-center gap-3 bg-accent/10 border border-accent/20 rounded-md p-3">
                <Crown className="w-5 h-5 text-accent flex-shrink-0" weight="fill" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                    Premium unlocked
                  </p>
                  <p className="text-[11px] text-gray-500">
                    {profile?.premiumSource === 'crypto' && 'Unlocked via USDC → $WORD burn'}
                    {profile?.premiumSource === 'fiat' && 'Unlocked via Apple Pay / card'}
                    {profile?.premiumSource === 'admin_grant' && 'Comped by an admin'}
                    {!profile?.premiumSource && 'Full access to leaderboard, archive, and settings'}
                  </p>
                </div>
              </div>
            ) : (
              <div className="border border-accent/30 rounded-md p-3 flex items-center gap-3">
                <Crown className="w-5 h-5 text-accent flex-shrink-0" weight="fill" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">Unlock Premium</p>
                  <p className="text-[11px] text-gray-500">Leaderboard, archive, custom photo, username changes &amp; more.</p>
                </div>
                <div className="flex gap-1.5 flex-shrink-0">
                  <button
                    type="button"
                    onClick={onRefreshPremium}
                    title="Already paid? Tap to refresh"
                    className="py-1.5 px-2 text-xs font-semibold text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 rounded transition-colors"
                  >
                    Refresh
                  </button>
                  <button type="button" onClick={onUpgrade} className="btn-accent py-1.5 px-3 text-xs">
                    Upgrade
                  </button>
                </div>
              </div>
            )}
          </Section>
        )}

        {/* FAQ — inline accordion. Renders the shared FAQ data via
            FaqAccordion so /faq and this modal stay in sync. Previously
            we linked out to /faq; inlining keeps users in the Settings
            flow without a full page navigation. */}
        <Section title="FAQ">
          <FaqAccordion />
        </Section>
      </div>
    </div>
  );
}

/**
 * Onboarding mode — renders only when the user has bound an identity
 * (email or wallet) but has no `handle` yet. One focused task: pick a
 * username. The default monogram preview updates live as the user
 * types so they see the avatar they'll get even before saving.
 *
 * Wallet-first users get a `griddle_<hex>` suggestion pre-filled (they
 * can edit it). Email-first users start with an empty input.
 *
 * The Continue button always has work to do — by mode definition the
 * profile has no handle, so submitting always writes. This is the
 * structural reason the old "Save profile / Nothing to save" bug
 * can't reappear here.
 */
function OnboardingPanel({
  sessionWallet,
  email,
  onCreated,
}: {
  sessionWallet: string | null;
  email: string | null;
  onCreated: () => void;
}) {
  const initial = useMemo(
    () => (sessionWallet ? suggestUsernameFromWallet(sessionWallet) : ''),
    [sessionWallet],
  );
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // If `sessionWallet` binds *after* this panel mounts (e.g. user
  // opened Settings while anonymous, then connected a wallet from the
  // Sign-in methods row below), `useState(initial)` would otherwise
  // hold the empty string forever and the wallet-derived suggestion
  // would never appear. Pre-fill only when the user hasn't typed —
  // we never overwrite an in-flight draft.
  useEffect(() => {
    setDraft((current) => (current ? current : initial));
  }, [initial]);

  const trimmed = draft.trim().toLowerCase();
  const previewSeed = trimmed || sessionWallet || 'guest';
  const previewSrc = getDefaultAvatarDataUri(previewSeed);

  const submit = async () => {
    setError(null);
    const validation = validateUsername(trimmed);
    if (!validation.valid) {
      setError(validation.error ?? 'Invalid username.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/profile/create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: trimmed }),
      });
      // Server upserts on duplicate sessions (returns 409 in stale
      // client states); fall through to a PATCH so the user isn't
      // stuck behind a race with their own /api/auth/verify redirect.
      if (res.status === 409) {
        const patchRes = await fetch('/api/profile', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ handle: trimmed }),
        });
        if (!patchRes.ok) {
          const d = (await patchRes.json().catch(() => ({}))) as { error?: string };
          throw new Error(d.error ?? `Save failed (${patchRes.status})`);
        }
      } else if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error ?? `Save failed (${res.status})`);
      }
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 py-2">
      <div className="flex flex-col items-center gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={previewSrc}
          alt=""
          className="w-20 h-20 rounded-full bg-gray-100"
        />
        <p className="text-[11px] text-gray-400 dark:text-gray-500">
          Custom photos with Premium
        </p>
      </div>
      <p className="text-sm text-gray-600 dark:text-gray-400 text-center leading-relaxed">
        Pick a username so your solves appear under a real identity on the leaderboard.
        <br />
        <span className="text-[11px] text-gray-400 dark:text-gray-500">
          You can change it later with Premium.
        </span>
      </p>
      <div>
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value.toLowerCase())}
          placeholder="starl3xx"
          maxLength={32}
          spellCheck={false}
          autoFocus
          className="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand focus:border-brand"
        />
        <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">
          2–32 chars, a–z, 0–9, underscores
        </p>
      </div>
      {error && (
        <p className="text-[12px] text-red-600 dark:text-red-400">{error}</p>
      )}
      <button
        type="button"
        onClick={submit}
        disabled={saving || trimmed.length === 0}
        className="btn-primary w-full inline-flex items-center justify-center gap-2"
      >
        {saving ? (
          <CircleNotch className="w-4 h-4 animate-spin" weight="bold" aria-hidden />
        ) : (
          <ArrowRight className="w-4 h-4" weight="bold" aria-hidden />
        )}
        Continue
      </button>
      {(sessionWallet || email) && (
        <p className="text-[11px] text-gray-400 dark:text-gray-500 text-center">
          Signed in as{' '}
          <span className="font-mono text-gray-500 dark:text-gray-400">
            {email ?? `${sessionWallet!.slice(0, 6)}…${sessionWallet!.slice(-4)}`}
          </span>
        </p>
      )}
    </div>
  );
}

/**
 * Atomic username editor for settings mode. View state shows the
 * current handle with a trailing "Change" button; Premium users
 * expand to an inline input with Save / Cancel; free users get
 * routed to the upgrade modal instead.
 *
 * Renders no Save button outside the expanded editor — when the row
 * is collapsed there's nothing to save, so the global "Nothing to
 * save" bug from the old single-form design is structurally absent.
 */
function EditableUsernameRow({
  handle,
  premium,
  onSaved,
  onUpgrade,
}: {
  handle: string;
  premium: boolean;
  onSaved: () => void;
  onUpgrade: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(handle);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const beginEdit = () => {
    if (!premium) {
      onUpgrade();
      return;
    }
    setDraft(handle);
    setError(null);
    setEditing(true);
  };

  const cancel = () => {
    setEditing(false);
    setError(null);
    setDraft(handle);
  };

  const save = async () => {
    setError(null);
    const trimmed = draft.trim().toLowerCase();
    if (trimmed === handle) {
      setEditing(false);
      return;
    }
    const validation = validateUsername(trimmed);
    if (!validation.valid) {
      setError(validation.error ?? 'Invalid username.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ handle: trimmed }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error ?? `Save failed (${res.status})`);
      }
      setEditing(false);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <div>
        <RowLabel>Username</RowLabel>
        <div className="flex items-center gap-3">
          <p className="text-sm font-mono text-gray-800 dark:text-gray-200 truncate flex-1 min-w-0">
            @{handle}
          </p>
          <button
            type="button"
            onClick={beginEdit}
            className="btn-secondary text-xs py-1.5 px-2.5 inline-flex items-center gap-1.5 flex-shrink-0"
          >
            {premium ? (
              <PencilSimple className="w-3.5 h-3.5" weight="bold" aria-hidden />
            ) : (
              <Crown className="w-3.5 h-3.5 text-accent" weight="fill" aria-hidden />
            )}
            Change
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <RowLabel>Username</RowLabel>
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value.toLowerCase())}
        maxLength={32}
        spellCheck={false}
        autoFocus
        className="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand focus:border-brand"
      />
      {error && (
        <p className="text-[12px] text-red-600 dark:text-red-400 mt-1">{error}</p>
      )}
      <div className="flex gap-2 mt-2">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="btn-primary text-xs py-1.5 px-3 inline-flex items-center gap-1.5"
        >
          {saving ? (
            <CircleNotch className="w-3.5 h-3.5 animate-spin" weight="bold" aria-hidden />
          ) : (
            <Check className="w-3.5 h-3.5" weight="bold" aria-hidden />
          )}
          Save
        </button>
        <button
          type="button"
          onClick={cancel}
          disabled={saving}
          className="text-xs font-semibold text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 px-3"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/**
 * Atomic photo editor for settings mode. View state shows the current
 * avatar (custom upload or default monogram derived from `seed`) with
 * a trailing "Change" / "Remove" affordance. Premium users get the
 * existing upload + remove flow; free users get routed to upgrade.
 *
 * Each action is a single PATCH /api/profile so there's no draft
 * state to mis-track and no "Nothing to save" failure mode.
 */
function EditablePhotoRow({
  avatarUrl,
  seed,
  premium,
  onSaved,
  onUpgrade,
}: {
  avatarUrl: string | null;
  seed: string;
  premium: boolean;
  onSaved: () => void;
  onUpgrade: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const previewSrc = avatarUrl || getDefaultAvatarDataUri(seed);
  const hasCustom = !!avatarUrl;
  const busy = uploading || removing;

  const handleChangeClick = () => {
    if (!premium) {
      onUpgrade();
      return;
    }
    fileInputRef.current?.click();
  };

  const handleFile = async (file: File) => {
    setError(null);
    setUploading(true);
    try {
      const url = await uploadAvatar(file);
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ avatarUrl: url }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error ?? `Save failed (${res.status})`);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      // Reset the file input so re-selecting the same file fires
      // `onChange` again — browsers otherwise suppress duplicates.
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleRemove = async () => {
    setError(null);
    setRemoving(true);
    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ avatarUrl: null }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error ?? `Save failed (${res.status})`);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Remove failed');
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2">
        <RowLabel>Photo</RowLabel>
        {!premium && (
          <span className="text-[9px] font-bold uppercase tracking-wider text-accent bg-accent/10 rounded px-1.5 py-0.5 inline-flex items-center gap-0.5">
            <Crown className="w-2.5 h-2.5" weight="fill" aria-hidden />
            Premium
          </span>
        )}
      </div>
      <div className="flex items-center gap-3">
        <div className="w-14 h-14 rounded-full overflow-hidden flex-shrink-0 border border-gray-200 dark:border-gray-700">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewSrc}
            alt=""
            className="w-full h-full object-cover"
          />
        </div>
        <div className="flex-1 min-w-0 flex flex-col gap-1">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleChangeClick}
              disabled={busy}
              className="btn-secondary text-xs py-2 px-3 inline-flex items-center gap-1.5"
            >
              {uploading ? (
                <CircleNotch className="w-3.5 h-3.5 animate-spin" weight="bold" aria-hidden />
              ) : !premium ? (
                <Crown className="w-3.5 h-3.5 text-accent" weight="fill" aria-hidden />
              ) : (
                <Camera className="w-3.5 h-3.5" weight="bold" aria-hidden />
              )}
              {hasCustom && premium ? 'Change' : 'Customize'}
            </button>
            {hasCustom && premium && !busy && (
              <button
                type="button"
                onClick={handleRemove}
                disabled={removing}
                className="text-xs font-semibold text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                Remove
              </button>
            )}
          </div>
          {!error && !premium && (
            <p className="text-[10px] text-gray-400 dark:text-gray-500">
              Custom photos with Premium
            </p>
          )}
          {error && (
            <p className="text-[11px] text-red-600 dark:text-red-400">{error}</p>
          )}
        </div>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        disabled={!premium}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
        }}
      />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-5 first:mt-0 border-t border-gray-100 dark:border-gray-800 first:border-t-0 pt-4 first:pt-0 space-y-3">
      <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">{title}</p>
      {children}
    </div>
  );
}

function RowLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="block text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1">
      {children}
    </p>
  );
}

function IdentityRow({
  icon, label, value, verified,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null;
  verified?: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-gray-400 flex-shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-bold uppercase tracking-wider text-gray-500">{label}</p>
        <p className="text-sm font-mono text-gray-800 dark:text-gray-200 truncate">
          {value ?? <span className="text-gray-400 font-sans italic">Not set</span>}
        </p>
      </div>
      {verified && value && (
        <span className="text-[10px] font-bold uppercase tracking-wider text-green-600 inline-flex items-center gap-0.5">
          <Check className="w-3 h-3" weight="bold" aria-hidden />
          Verified
        </span>
      )}
    </div>
  );
}

function ToggleRow({
  icon, label, description, checked, disabled, onChange, premiumLocked,
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onChange: () => void;
  /**
   * When true, the row renders as a disabled preview with a "Premium"
   * badge next to the label. Used to tease non-premium features so
   * non-premium users can see what Premium unlocks instead of the
   * settings disappearing entirely.
   */
  premiumLocked?: boolean;
}) {
  return (
    <div className={`flex items-center gap-3 ${premiumLocked ? 'opacity-70' : ''}`}>
      <span className={`${premiumLocked ? 'text-gray-400' : 'text-accent'} flex-shrink-0`}>{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">{label}</p>
          {premiumLocked && (
            <span className="text-[9px] font-bold uppercase tracking-wider text-accent bg-accent/10 rounded px-1.5 py-0.5 inline-flex items-center gap-0.5">
              <Crown className="w-2.5 h-2.5" weight="fill" aria-hidden />
              Premium
            </span>
          )}
        </div>
        <p className="text-[11px] text-gray-500">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={onChange}
        className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full transition-colors duration-fast focus:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50 disabled:cursor-not-allowed ${checked ? 'bg-accent' : 'bg-gray-300 dark:bg-gray-600'}`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-fast mt-0.5 ${checked ? 'translate-x-4' : 'translate-x-0.5'}`}
        />
      </button>
    </div>
  );
}
