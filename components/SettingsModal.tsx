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
  Question,
  Gear,
} from '@phosphor-icons/react';
import { Avatar } from './Avatar';

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
const HANDLE_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

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

    // Only send fields that actually changed. PATCH /api/profile rejects
    // empty strings explicitly for each field, so "no change" means
    // "don't include in the body" — not "send empty."
    const patch: { displayName?: string; handle?: string; avatarUrl?: string } = {};
    const trimmedName = displayNameDraft.trim();
    const trimmedHandle = handleDraft.trim().toLowerCase();
    const trimmedAvatar = avatarUrlDraft.trim();

    if (trimmedName && trimmedName !== (profile?.displayName ?? '')) {
      patch.displayName = trimmedName;
    }
    if (trimmedHandle && trimmedHandle !== (profile?.handle ?? '')) {
      if (!HANDLE_RE.test(trimmedHandle) || trimmedHandle.length < 2 || trimmedHandle.length > 32) {
        setProfileError('Handle must be 2–32 chars, lowercase letters, numbers, or hyphens.');
        return;
      }
      patch.handle = trimmedHandle;
    }
    if (trimmedAvatar && trimmedAvatar !== (profile?.avatarUrl ?? '')) {
      patch.avatarUrl = trimmedAvatar;
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
      className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="modal-sheet sm:rounded-card animate-slide-up max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 mb-5">
          <Avatar pfpUrl={profile?.avatarUrl ?? null} />
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-black tracking-tight text-gray-900 dark:text-gray-100 truncate">
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

        {/* Anonymous state — onboarding CTAs. Two sub-states: pure
            anonymous (no profile, no premium) sees all three paths;
            premium-but-profileless (fiat buyer who hasn't created a
            profile yet) sees only Create profile + Connect wallet,
            since showing "Unlock with card or crypto" to a user who
            already paid would risk a duplicate purchase. */}
        {!hasIdentity && !premium && (
          <div className="py-2 space-y-3">
            <p className="text-sm text-gray-600 dark:text-gray-400 text-center leading-relaxed">
              Create a profile, connect a wallet, or unlock premium to get started.
            </p>
            <button type="button" onClick={onCreateProfile} className="btn-primary w-full">
              Create profile
            </button>
            <button type="button" onClick={onConnect} className="btn-secondary w-full">
              Connect wallet
            </button>
            <button type="button" onClick={onUpgrade} className="btn-secondary w-full inline-flex items-center justify-center gap-2">
              <Diamond className="w-4 h-4 text-accent" weight="fill" aria-hidden />
              Unlock with card or crypto
            </button>
          </div>
        )}
        {!hasIdentity && premium && (
          <div className="py-2 space-y-3">
            <p className="text-sm text-gray-600 dark:text-gray-400 text-center leading-relaxed">
              You’re premium. Attach a profile or wallet so your access follows you across devices.
            </p>
            <button type="button" onClick={onCreateProfile} className="btn-primary w-full">
              Create profile
            </button>
            <button type="button" onClick={onConnect} className="btn-secondary w-full">
              Connect wallet
            </button>
          </div>
        )}

        {/* Profile editor — shown when an identity exists */}
        {hasIdentity && (
          <Section title="Profile">
            <LabeledInput
              label="Display name"
              value={displayNameDraft}
              onChange={setDisplayNameDraft}
              placeholder="alice"
              maxLength={50}
            />
            <LabeledInput
              label="Handle"
              value={handleDraft}
              onChange={(v) => setHandleDraft(v.toLowerCase())}
              placeholder="alice-42"
              maxLength={32}
              hint="2–32 chars, a–z, 0–9, hyphens"
            />
            <LabeledInput
              label="Avatar URL"
              value={avatarUrlDraft}
              onChange={setAvatarUrlDraft}
              placeholder="https://…"
              maxLength={500}
              hint="Leave blank to use the default silhouette"
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
              Save profile
            </button>
          </Section>
        )}

        {/* Identity anchors — add missing ones */}
        {hasIdentity && (
          <Section title="Sign-in methods">
            <IdentityRow
              icon={<Envelope className="w-4 h-4" weight="bold" />}
              label="Email"
              value={profile?.email ?? null}
              verified={!!profile?.emailVerifiedAt}
            />
            {/* Inline add-email for users who don't have one yet */}
            {!profile?.email && (
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

            <IdentityRow
              icon={<Wallet className="w-4 h-4" weight="bold" />}
              label="Wallet"
              value={profile?.wallet
                ? `${profile.wallet.slice(0, 6)}…${profile.wallet.slice(-4)}`
                : null}
            />
            {!profile?.wallet && (
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

          {premium && (
            <>
              <ToggleRow
                icon={<ShieldCheck className="w-4 h-4" weight="bold" />}
                label="Streak protection"
                description={
                  protectionOnCooldown
                    ? `Available again in ${cooldownDaysLeft}d`
                    : settings?.streakProtectionEnabled
                      ? 'Armed — will save your streak once'
                      : 'Saves your streak if you miss a day'
                }
                checked={settings?.streakProtectionEnabled ?? false}
                disabled={savingProtection || protectionOnCooldown}
                onChange={() => toggleSetting('streakProtectionEnabled')}
              />
              <ToggleRow
                icon={settings?.unassistedModeEnabled
                  ? <EyeSlash className="w-4 h-4" weight="bold" />
                  : <Eye className="w-4 h-4" weight="bold" />}
                label="Unassisted mode"
                description="Hides cell hints — earn 🎯 Ace for solving blind"
                checked={settings?.unassistedModeEnabled ?? false}
                disabled={savingUnassisted}
                onChange={() => toggleSetting('unassistedModeEnabled')}
              />
            </>
          )}
        </Section>

        {/* Premium status — upsell if not premium but has an account,
            badge if already premium. Anonymous users see the onboarding
            CTAs above and don't need this section at all, so skip it
            entirely to avoid an orphaned "PREMIUM" header with no body. */}
        {(premium || hasIdentity) && (
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
                  <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">Unlock premium</p>
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

        {/* Footer — FAQ link */}
        <div className="mt-5 pt-3 border-t border-gray-100 dark:border-gray-800 flex items-center justify-center gap-1.5">
          <Question className="w-3.5 h-3.5 text-gray-400" weight="bold" aria-hidden />
          <a
            href="/faq"
            className="text-xs font-semibold text-gray-400 hover:text-brand transition-colors"
          >
            FAQ
          </a>
        </div>
      </div>
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
  icon, label, description, checked, disabled, onChange,
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onChange: () => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-accent flex-shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">{label}</p>
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
