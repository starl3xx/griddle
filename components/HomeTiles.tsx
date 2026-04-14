'use client';

interface HomeTilesProps {
  onStatsClick: () => void;
  onLeaderboardClick: () => void;
  onArchiveClick: () => void;
  /** Farcaster profile picture URL, if the user is authed in a miniapp. */
  pfpUrl: string | null;
  /** Short label (monogram or truncated address) rendered when pfp is missing. */
  monogram: string;
  /** True when the user has premium unlocked — drives the lock badge on gated tiles. */
  premium: boolean;
}

/**
 * Three-tile action row below the Backspace/Reset controls. Tapping a
 * tile dispatches its handler — the parent owns the modal state and the
 * premium-gate decision so unit-level premium logic doesn't leak into
 * this component. Tiles share a single visual rhythm (square icon,
 * label, optional lock badge) so the row reads as one unit at a glance.
 */
export function HomeTiles({
  onStatsClick,
  onLeaderboardClick,
  onArchiveClick,
  pfpUrl,
  monogram,
  premium,
}: HomeTilesProps) {
  return (
    <div className="w-full max-w-[420px] grid grid-cols-3 gap-3">
      <Tile label="Stats" onClick={onStatsClick}>
        <StatsIcon pfpUrl={pfpUrl} monogram={monogram} />
      </Tile>
      <Tile label="Leaderboard" onClick={onLeaderboardClick} locked={!premium}>
        <span className="text-2xl leading-none" aria-hidden>
          🏆
        </span>
      </Tile>
      <Tile label="Archive" onClick={onArchiveClick} locked={!premium}>
        <span className="text-2xl leading-none" aria-hidden>
          🗃️
        </span>
      </Tile>
    </div>
  );
}

interface TileProps {
  label: string;
  onClick: () => void;
  locked?: boolean;
  children: React.ReactNode;
}

function Tile({ label, onClick, locked = false, children }: TileProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative bg-white hover:bg-brand-50 border border-gray-200 hover:border-brand-200 rounded-card aspect-square flex flex-col items-center justify-center gap-2 shadow-card transition-colors duration-fast focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
    >
      {children}
      <span className="text-[11px] font-bold uppercase tracking-wider text-gray-600">
        {label}
      </span>
      {locked && (
        <span
          className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-accent/15 text-accent flex items-center justify-center text-[9px]"
          aria-label="Premium"
          title="Premium"
        >
          ◆
        </span>
      )}
    </button>
  );
}

function StatsIcon({
  pfpUrl,
  monogram,
}: {
  pfpUrl: string | null;
  monogram: string;
}) {
  if (pfpUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={pfpUrl}
        alt=""
        className="w-9 h-9 rounded-full bg-gray-100 object-cover"
      />
    );
  }
  return (
    <div className="w-9 h-9 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center font-black text-base">
      {monogram}
    </div>
  );
}
