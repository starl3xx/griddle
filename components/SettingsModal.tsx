'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Moon,
  Sun,
  Envelope,
  Wallet,
  Diamond,
  ShieldCheck,
  Eye,
  EyeSlash,
  CircleNotch,
  Check,
  Gear,
  Camera,
} from '@phosphor-icons/react';
import { Avatar } from './Avatar';
import { FaqAccordion } from './FaqAccordion';
import { uploadAvatar } from '@/lib/avatar-upload';

/**
 * Shape of the profile object surfaced by GET /api/profile. Kept narrow
 * on purpose — we only pull the fields SettingsModal renders or edits.
 */
export interface ProfileSnapshot {
  id: number;
  email: string | null;
  emailVerifiedAt: string | null;
  handle: string | null;
  displayName: string | null;
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
   * Settings can show a "Complete your profile" form instead of the
   * generic onboarding CTAs.
   */
  sessionWallet: string | null;
  premium: boolean;
  dark: boolean;
  onToggleDark: () => void;
  /** Called when profile state mutates so the parent can re-fetch. */
  onProfileChanged: () => void;
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
// Handles are lowercase letters, digits, and underscores only —
// no hyphens, no special characters, no unicode glyphs. "starl3xx"
// works; "$t✪rl3xx" does not.
//
// The structure `[a-z0-9]+(_[a-z0-9]+)*` is equivalent to
// "one or more runs of alphanumerics separated by single
// underscores" — this enforces the same structural invariants the
// old hyphen regex did:
//   - must contain at least one alphanumeric (rejects `__`)
//   - no leading/trailing underscore (rejects `_foo` / `foo_`)
//   - no consecutive underscores (rejects `foo__bar`)
// A flat `/^[a-z0-9_]+$/` would accept all of those, which the
// slugifier in /api/profile/create explicitly cleans up — keeping
// the validator in sync means anything the slugifier produces
// round-trips through PATCH /api/profile.
const HANDLE_RE = /^[a-z0-9]+(_[a-z0-9]+)*$/;

/**
 * Settings modal — all identity and preferences surfaces, accessed via
 * the top-right gear/avatar button.
 *
 * Responsibilities:
 *   - Identity editing (display name, handle, avatar URL) for users
 *     with a profile, via PATCH /api/profile.
 *   - Inline add-email for wallet-only users (sends a magic link via
 *     POST /api/auth/request, then the verify route merges the new
 *     email profile into the existing wallet profile).
 *   - Connect-wallet trigger for email/handle-only users.
 *   - Dark mode toggle (everyone).
 *   - Premium preferences (streak protection, unassisted mode) — only
 *     when premium is unlocked AND the user has a wallet (the
 *     user_settings table keys on wallet).
 *   - Anonymous state: Create profile / Connect wallet / Unlock with
 *     card or crypto — the three onboarding CTAs, moved here from
 *     StatsModal so Stats stays read-only.
 */
export function SettingsModal({
  open,
  profile,
  sessionWallet,
  premium,
  dark,
  onToggleDark,
  onProfileChanged,
  onClose,
  onCreateProfile,
  onConnect,
  onUpgrade,
  onRefreshPremium,
}: SettingsModalProps) {
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [savingProtection, setSavingProtection] = useState(false);
  const [savingUnassisted, setSavingUnassisted] = useState(false);

  // Local edit buffers for profile fields. Seeded from the incoming
  // profile whenever the modal opens (or the profile refetches) so we
  // don't clobber in-flight user typing.
  const [displayNameDraft, setDisplayNameDraft] = useState('');
  const [handleDraft, setHandleDraft] = useState('');
  const [avatarUrlDraft, setAvatarUrlDraft] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSavedAt, setProfileSavedAt] = useState<number | null>(null);

  // Inline add-email state for wallet-only users
  const [emailDraft, setEmailDraft] = useState('');
  const [emailSending, setEmailSending] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailSentTo, setEmailSentTo] = useState<string | null>(null);

  // Avatar upload state. `avatarUploading` drives the spinner on the
  // upload button; `avatarUploadError` surfaces resize/network errors
  // inline. The actual resulting URL is written to `avatarUrlDraft`
  // so it flows through the existing Save / Complete profile button
  // and gets persisted atomically with any display-name changes.
  const avatarFileInputRef = useRef<HTMLInputElement | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarUploadError, setAvatarUploadError] = useState<string | null>(null);

  const handleAvatarFilePick = async (file: File) => {
    setAvatarUploadError(null);
    setAvatarUploading(true);
    try {
      const url = await uploadAvatar(file);
      setAvatarUrlDraft(url);
    } catch (err) {
      setAvatarUploadError(
        err instanceof Error ? err.message : 'Upload failed',
      );
    } finally {
      setAvatarUploading(false);
      // Reset the file input so re-selecting the same file fires
      // `onChange` again — browsers otherwise suppress duplicates.
      if (avatarFileInputRef.current) avatarFileInputRef.current.value = '';
    }
  };

  // Reset status state on every *open* transition — error banner,
  // saved confirmation, email draft. Previously this also seeded the
  // profile drafts which caused two bugs: (a) the post-save refetch
  // cleared the "Saved." confirmation before the user could read it,
  // and (b) any mid-edit refetch clobbered in-flight draft edits.
  useEffect(() => {
    if (!open) return;
    setProfileError(null);
    setProfileSavedAt(null);
    setEmailDraft('');
    setEmailError(null);
    setEmailSentTo(null);
  }, [open]);

  // Seed profile drafts from the incoming profile, but only *once* per
  // open cycle. A ref-flag handles the edge case where the modal is
  // opened BEFORE the async profile fetch resolves (the onProfileCreated
  // and ?auth=ok paths) — we wait for profile to become non-null and
  // then seed. The ref resets on close so the next open cycle can seed
  // fresh from whatever the current profile is.
  const seededOpenRef = useRef(false);
  useEffect(() => {
    if (!open) { seededOpenRef.current = false; return; }
    if (seededOpenRef.current) return;
    if (!profile) return; // wait for profile
    setDisplayNameDraft(profile.displayName ?? '');
    setHandleDraft(profile.handle ?? '');
    setAvatarUrlDraft(profile.avatarUrl ?? '');
    seededOpenRef.current = true;
  }, [open, profile]);

  // Auto-dismiss the "Saved." confirmation after 2.5s. Beats leaving it
  // stuck until the next modal open, and gives the user enough time to
  // read it without requiring an acknowledge click.
  useEffect(() => {
    if (profileSavedAt === null) return;
    const t = setTimeout(() => setProfileSavedAt(null), 2500);
    return () => clearTimeout(t);
  }, [profileSavedAt]);

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
      }
    } catch {/* best-effort */} finally {
      setSaving(false);
    }
  };

  const saveProfile = async () => {
    setProfileError(null);
    setProfileSavedAt(null);

    const trimmedName = displayNameDraft.trim();
    const trimmedHandle = handleDraft.trim().toLowerCase();
    const trimmedAvatar = avatarUrlDraft.trim();

    // Two modes:
    //   a) profile exists → PATCH /api/profile with the diff of changed
    //      fields (displayName / handle / avatarUrl). Empty blanks on
    //      displayName or handle surface as specific errors; blank
    //      avatarUrl sends explicit `null` to clear the column.
    //   b) no profile yet (wallet-connected user completing onboarding
    //      for the first time) → POST /api/profile/create with the
    //      drafts, server auto-attaches the session wallet.
    if (!profile) {
      if (!trimmedName) {
        setProfileError('Display name is required.');
        return;
      }
      setProfileSaving(true);
      try {
        const res = await fetch('/api/profile/create', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            displayName: trimmedName,
            ...(trimmedAvatar ? { avatarUrl: trimmedAvatar } : {}),
          }),
        });
        if (!res.ok) {
          const d = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(d.error ?? `Save failed (${res.status})`);
        }
        setProfileSavedAt(Date.now());
        onProfileChanged();
      } catch (err) {
        setProfileError(err instanceof Error ? err.message : 'Save failed');
      } finally {
        setProfileSaving(false);
      }
      return;
    }

    // PATCH path — existing profile.
    const patch: { displayName?: string; handle?: string; avatarUrl?: string | null } = {};
    const currentName = profile.displayName ?? '';
    const currentHandle = profile.handle ?? '';
    const currentAvatar = profile.avatarUrl ?? '';

    if (trimmedName !== currentName) {
      if (!trimmedName) {
        setProfileError('Display name cannot be empty.');
        return;
      }
      patch.displayName = trimmedName;
    }
    if (trimmedHandle !== currentHandle) {
      if (!trimmedHandle) {
        setProfileError('Handle cannot be empty.');
        return;
      }
      if (!HANDLE_RE.test(trimmedHandle) || trimmedHandle.length < 2 || trimmedHandle.length > 32) {
        setProfileError('Handle must be 2–32 chars, lowercase letters, numbers, or underscores.');
        return;
      }
      patch.handle = trimmedHandle;
    }
    if (trimmedAvatar !== currentAvatar) {
      // Empty → null = clear the avatar. Non-empty → set the URL.
      patch.avatarUrl = trimmedAvatar ? trimmedAvatar : null;
    }

    if (Object.keys(patch).length === 0) {
      setProfileError('Nothing to save.');
      return;
    }

    setProfileSaving(true);
    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error ?? `Save failed (${res.status})`);
      }
      setProfileSavedAt(Date.now());
      onProfileChanged();
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setProfileSaving(false);
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

  // Identity resolution for the header — prefer display name, then
  // handle, then a truncated wallet, then "Anonymous."
  const headerLabel =
    profile?.displayName?.trim()
    || (profile?.handle ? `/${profile.handle}` : null)
    || (profile?.wallet ? `${profile.wallet.slice(0, 6)}…${profile.wallet.slice(-4)}` : null)
    || 'Anonymous';
  const hasIdentity = !!profile;

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
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="modal-sheet animate-slide-up max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 mb-5">
          <Avatar pfpUrl={profile?.avatarUrl ?? null} />
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

        {/* Fully anonymous — no profile, no wallet, no premium. The
            anonymous surface for a brand-new visitor: sign-in entry,
            wallet connect, and the upsell path. Worded as "sign in"
            because the magic-link flow is idempotent — same button
            for both new and returning users. */}
        {!hasIdentity && !sessionWallet && !premium && (
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
            <button type="button" onClick={onUpgrade} className="btn-secondary w-full inline-flex items-center justify-center gap-2">
              <Diamond className="w-4 h-4 text-accent" weight="fill" aria-hidden />
              Upgrade to Premium <span className="font-medium text-gray-500">(card or crypto)</span>
            </button>
          </div>
        )}

        {/* Premium but no identity — fiat buyer who hasn't created a
            profile yet. Same sign-in affordance, no unlock CTA (they
            already paid). */}
        {!hasIdentity && !sessionWallet && premium && (
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

        {/* Profile editor — shown for both existing profiles and
            wallet-connected users completing onboarding. In
            "complete" mode (no profile yet) we hide the handle field
            since it's auto-slugged from the displayName on the
            server, and the whole flow is framed as "Complete your
            profile" rather than "edit." */}
        {(hasIdentity || sessionWallet) && (
          <Section title={hasIdentity ? 'Profile' : 'Complete your profile'}>
            {!hasIdentity && (
              <p className="text-[12px] text-gray-500 dark:text-gray-400 leading-relaxed">
                Your wallet is connected. Add a display name so your solves appear under a real identity on the leaderboard.
              </p>
            )}
            <LabeledInput
              label="Display name"
              value={displayNameDraft}
              onChange={setDisplayNameDraft}
              placeholder="alice"
              maxLength={50}
            />
            {hasIdentity && (
              <LabeledInput
                label="Handle"
                value={handleDraft}
                onChange={(v) => setHandleDraft(v.toLowerCase())}
                placeholder="alice_42"
                maxLength={32}
                hint="2–32 chars, a–z, 0–9, underscores"
              />
            )}
            <AvatarUploadRow
              avatarUrl={avatarUrlDraft}
              uploading={avatarUploading}
              error={avatarUploadError}
              premiumLocked={!premium}
              fileInputRef={avatarFileInputRef}
              onFilePick={handleAvatarFilePick}
              onUpgrade={onUpgrade}
              onClear={() => {
                setAvatarUrlDraft('');
                setAvatarUploadError(null);
              }}
              hint={
                !premium
                  ? 'Upload a custom photo with Premium'
                  : hasIdentity
                    ? 'Tap to upload a new photo'
                    : 'Optional — we’ll use a silhouette if you skip'
              }
            />

            {profileError && (
              <p className="text-[12px] text-red-600 dark:text-red-400">{profileError}</p>
            )}
            {profileSavedAt && !profileError && (
              <p className="text-[12px] text-green-600 dark:text-green-400 inline-flex items-center gap-1">
                <Check className="w-3 h-3" weight="bold" aria-hidden />
                Saved.
              </p>
            )}

            <button
              type="button"
              onClick={saveProfile}
              disabled={profileSaving}
              className="btn-primary w-full inline-flex items-center justify-center gap-2"
            >
              {profileSaving ? (
                <CircleNotch className="w-4 h-4 animate-spin" weight="bold" aria-hidden />
              ) : (
                <Check className="w-4 h-4" weight="bold" aria-hidden />
              )}
              {hasIdentity ? 'Save profile' : 'Complete profile'}
            </button>
          </Section>
        )}

        {/* Identity anchors — render for any user with at least one
            identity signal (profile row OR session wallet). Same as
            the profile editor: the section gates on "does it make
            sense to let them add anchors?" and a wallet-only user
            who hasn't saved their profile yet still qualifies. */}
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
                the Complete-profile form and this email form at the
                same time, fires the email first, and clicks the
                magic link before completing the profile — the
                verify route would then create an email-only profile
                with no wallet (because no wallet-linked row exists
                to merge into), orphaning the session wallet. For
                wallet-only users we show a hint telling them to
                complete the profile first. */}
            {hasIdentity && !profile?.email && (
              <div className="space-y-2">
                {emailSentTo ? (
                  <p className="text-[12px] text-gray-600 dark:text-gray-400 bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-800 rounded-md px-3 py-2">
                    Sign-in link sent to <strong>{emailSentTo}</strong>. Click it to attach the email to this profile — we’ll merge them automatically.
                  </p>
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
                Complete your profile above first, then you can add an email to sign in from other devices.
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

        {/* Preferences — dark mode always, premium settings conditionally */}
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
                ? 'Hide cell hints for an Ace Wordmark on solves'
                : 'Hides cell hints — earn 🎯 Ace for solving blind'
            }
            checked={premium ? (settings?.unassistedModeEnabled ?? false) : false}
            disabled={!premium || savingUnassisted}
            onChange={() => toggleSetting('unassistedModeEnabled')}
          />
        </Section>

        {/* Premium status — upsell if not premium but has an account
            OR a connected wallet (covers the "wallet connected, no
            profile row yet" path that the Complete-profile flow
            created). Fully anonymous users see the onboarding CTAs
            above and don't need this section at all, so skip it
            entirely to avoid an orphaned "PREMIUM" header with no body. */}
        {(premium || hasIdentity || sessionWallet) && (
          <Section title="Premium">
            {premium ? (
              <div className="flex items-center gap-3 bg-accent/10 border border-accent/20 rounded-md p-3">
                <Diamond className="w-5 h-5 text-accent flex-shrink-0" weight="fill" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                    Premium unlocked
                  </p>
                  <p className="text-[11px] text-gray-500">
                    {profile?.premiumSource === 'crypto' && 'Unlocked via $WORD burn'}
                    {profile?.premiumSource === 'fiat' && 'Unlocked via Apple Pay / card'}
                    {profile?.premiumSource === 'admin_grant' && 'Comped by an admin'}
                    {!profile?.premiumSource && 'Full access to leaderboard, archive, and settings'}
                  </p>
                </div>
              </div>
            ) : (
              <div className="border border-accent/30 rounded-md p-3 flex items-center gap-3">
                <Diamond className="w-5 h-5 text-accent flex-shrink-0" weight="fill" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">Unlock Premium</p>
                  <p className="text-[11px] text-gray-500">Leaderboard, archive, streak protection &amp; more.</p>
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
 * Avatar picker row. Shows the current avatar (or the default
 * silhouette when unset) as a circular thumbnail with an "Upload
 * photo" button next to it. Clicking the button triggers a hidden
 * file input with `accept="image/*"`, which on mobile prompts the
 * user's native "Take photo or choose from library" picker.
 *
 * The uploaded URL is handed back to the parent via `onFilePick`,
 * which runs the resize-and-upload helper and writes the result into
 * `avatarUrlDraft` — so the existing Save / Complete profile button
 * persists the new URL alongside any other field edits.
 */
function AvatarUploadRow({
  avatarUrl,
  uploading,
  error,
  premiumLocked,
  fileInputRef,
  onFilePick,
  onUpgrade,
  onClear,
  hint,
}: {
  avatarUrl: string;
  uploading: boolean;
  error: string | null;
  /** When true, the upload button is disabled and a Premium badge is shown. */
  premiumLocked: boolean;
  fileInputRef: React.RefObject<HTMLInputElement>;
  onFilePick: (file: File) => void | Promise<void>;
  /** Called when a locked user clicks the Upload button — opens the gate. */
  onUpgrade: () => void;
  onClear: () => void;
  hint?: string;
}) {
  const hasAvatar = avatarUrl.trim().length > 0;
  const handleUploadClick = () => {
    if (premiumLocked) {
      onUpgrade();
      return;
    }
    fileInputRef.current?.click();
  };
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2">
        <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          Photo
        </label>
        {premiumLocked && (
          <span className="text-[9px] font-bold uppercase tracking-wider text-accent bg-accent/10 rounded px-1.5 py-0.5 inline-flex items-center gap-0.5">
            <Diamond className="w-2.5 h-2.5" weight="fill" aria-hidden />
            Premium
          </span>
        )}
      </div>
      <div className="flex items-center gap-3">
        <div
          className={`w-14 h-14 rounded-full bg-brand-50 dark:bg-brand-900/30 border border-gray-200 dark:border-gray-700 flex items-center justify-center overflow-hidden flex-shrink-0 ${premiumLocked ? 'opacity-70' : ''}`}
        >
          {hasAvatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatarUrl}
              alt="Your avatar"
              className="w-full h-full object-cover"
            />
          ) : (
            <Camera className="w-5 h-5 text-brand" weight="bold" aria-hidden />
          )}
        </div>
        <div className="flex-1 min-w-0 flex flex-col gap-1">
          <div className="flex gap-2">
            <button
              type="button"
              disabled={uploading}
              onClick={handleUploadClick}
              className={`text-xs py-2 px-3 inline-flex items-center gap-1.5 ${premiumLocked ? 'btn-secondary opacity-70' : 'btn-secondary'}`}
            >
              {uploading ? (
                <CircleNotch className="w-3.5 h-3.5 animate-spin" weight="bold" aria-hidden />
              ) : (
                <Camera className="w-3.5 h-3.5" weight="bold" aria-hidden />
              )}
              {hasAvatar ? 'Change photo' : 'Upload photo'}
            </button>
            {hasAvatar && !uploading && !premiumLocked && (
              <button
                type="button"
                onClick={onClear}
                className="text-xs font-semibold text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                Remove
              </button>
            )}
          </div>
          {hint && !error && (
            <p className="text-[10px] text-gray-400 dark:text-gray-500">{hint}</p>
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
        disabled={premiumLocked}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFilePick(f);
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

function LabeledInput({
  label, value, onChange, placeholder, maxLength, hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  maxLength?: number;
  hint?: string;
}) {
  return (
    <div>
      <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1">
        {label}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        spellCheck={false}
        className="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand focus:border-brand"
      />
      {hint && (
        <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">{hint}</p>
      )}
    </div>
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
              <Diamond className="w-2.5 h-2.5" weight="fill" aria-hidden />
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
