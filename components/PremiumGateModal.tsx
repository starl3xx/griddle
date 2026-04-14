'use client';

interface PremiumGateModalProps {
  open: boolean;
  /** What the user tried to open — shapes the modal headline. */
  feature: 'leaderboard' | 'archive';
  onClose: () => void;
  /** CTA is stubbed until M4f wires in the Stripe + permit-burn flows. */
  onUnlockClick: () => void;
}

/**
 * Premium-gate modal. Shown when a non-premium user taps the Leaderboard
 * or Archive tile. The Unlock CTA is intentionally stubbed for now — the
 * actual Stripe / Apple Pay / permit-burn paths land in M4f, and the
 * skeleton here already has the two pricing tiers laid out so M4f only
 * has to wire the handlers.
 */
export function PremiumGateModal({
  open,
  feature,
  onClose,
  onUnlockClick,
}: PremiumGateModalProps) {
  if (!open) return null;

  const headline =
    feature === 'leaderboard' ? 'See the leaderboard' : 'Play past puzzles';
  const blurb =
    feature === 'leaderboard'
      ? 'Premium unlocks every day’s ranked leaderboard — see who solved fastest, who went unassisted, and how you stack up.'
      : 'Premium unlocks the full puzzle archive — replay any past day and climb its leaderboard.';

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="modal-sheet sm:rounded-card animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-full bg-accent/10 text-accent flex items-center justify-center text-lg flex-shrink-0">
            ◆
          </div>
          <div className="min-w-0">
            <h2 className="text-xl font-black tracking-tight text-gray-900">
              {headline}
            </h2>
            <p className="text-sm font-medium text-gray-500 mt-0.5">
              Griddle Premium — one-time unlock
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="ml-auto w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-full transition-colors duration-fast"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              className="w-4 h-4"
              aria-hidden
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <p className="text-sm text-gray-700 leading-relaxed mt-4">{blurb}</p>

        <ul className="text-sm text-gray-800 leading-relaxed mt-4 space-y-1.5">
          <Benefit>Every day’s ranked leaderboard</Benefit>
          <Benefit>Full puzzle archive</Benefit>
          <Benefit>Personal stats dashboard</Benefit>
          <Benefit>Streak protection + unassisted mode</Benefit>
        </ul>

        <div className="mt-5 grid grid-cols-2 gap-2.5">
          <PriceTile
            label="Pay with crypto ($WORD)"
            price="$5"
            note="One tap, onchain"
            primary
          />
          <PriceTile
            label="Pay with cash (Stripe)"
            price="$6"
            note="Card &amp; Apple Pay"
          />
        </div>

        <button
          type="button"
          onClick={onUnlockClick}
          className="btn-primary w-full mt-5"
          disabled
          title="Unlock flow ships with M4f"
        >
          Unlock soon
        </button>
        <p className="text-[11px] font-medium text-gray-400 text-center mt-2">
          Checkout lands shortly. One-time, no subscription.
        </p>
      </div>
    </div>
  );
}

function Benefit({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2">
      <span className="text-brand font-bold mt-0.5">✓</span>
      <span>{children}</span>
    </li>
  );
}

function PriceTile({
  label,
  price,
  note,
  primary = false,
}: {
  label: string;
  price: string;
  note: string;
  primary?: boolean;
}) {
  return (
    <div
      className={`rounded-md border-2 px-3 py-2.5 ${
        primary ? 'border-brand bg-brand-50' : 'border-gray-200 bg-white'
      }`}
    >
      <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
        {label}
      </div>
      <div className="text-xl font-black text-gray-900 tabular-nums mt-0.5">
        {price}
      </div>
      <div className="text-[11px] font-medium text-gray-500 mt-0.5">{note}</div>
    </div>
  );
}
