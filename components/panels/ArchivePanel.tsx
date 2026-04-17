'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, CircleNotch } from '@phosphor-icons/react';
import { PremiumBenefitsList } from '../PremiumBenefitsList';

interface ArchiveEntry {
  dayNumber: number;
  /** ISO date string (`YYYY-MM-DD`) — the calendar day this puzzle ran. */
  date: string;
}

interface ArchiveResponse {
  entries: ArchiveEntry[];
  solvedDayNumbers: number[];
  todayDayNumber: number;
  todayDate: string;
}

interface ArchivePanelProps {
  /** True when the user has Premium — shows the calendar. */
  premium: boolean;
  /** Opens the Premium upgrade flow. */
  onUpgrade: () => void;
  /**
   * Called when the user taps a day cell. BrowseModal routes this
   * through to GameClient's archive-puzzle loader and closes itself.
   */
  onDayPick: (dayNumber: number) => void;
  onClose: () => void;
}

/**
 * Past-puzzles calendar for BrowseModal's Archive tab. Replaces the
 * old flat-list treatment with a month-by-month calendar grid: each
 * tile is one calendar day, solved days carry a checkmark, and today
 * gets its own ring highlight so the user always knows where they
 * are. Scanning the grid gives an at-a-glance sense of coverage —
 * which is what "streak" ultimately means visually — in a way the
 * list never did.
 *
 * Data: `/api/archive` returns past entries plus the caller's solved
 * day numbers and today’s day + date. All three arrive in one
 * round-trip so the calendar can render without a follow-up fetch.
 *
 * Tapping any cell calls `onDayPick(dayNumber)`; BrowseModal routes
 * that to GameClient, which swaps the active puzzle and closes the
 * modal. Today's cell also routes through `onDayPick` — GameClient's
 * archive loader is a no-op for the current day, so the user lands
 * back on today's puzzle with the running timer intact.
 */
export function ArchivePanel({
  premium,
  onUpgrade,
  onDayPick,
  onClose,
}: ArchivePanelProps) {
  const [data, setData] = useState<ArchiveResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!premium) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch('/api/archive', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
      .then((j: ArchiveResponse) => {
        if (!cancelled) {
          setData(j);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load');
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [premium]);

  // Group archive entries (+ today) by calendar month, keyed by `YYYY-MM`.
  // Memoized on the response so tab-switch re-renders don't recompute.
  const months = useMemo(() => {
    if (!data) return [] as CalendarMonth[];
    const solved = new Set(data.solvedDayNumbers);
    // Include today as a pseudo-entry so the calendar has a "you are
    // here" cell without plumbing a second code path.
    const combined: ArchiveEntry[] = [
      { dayNumber: data.todayDayNumber, date: data.todayDate },
      ...data.entries,
    ];
    return buildMonths(combined, solved, data.todayDayNumber);
  }, [data]);

  const solvedCount = data?.solvedDayNumbers.length ?? 0;
  const totalPuzzles = (data?.entries.length ?? 0) + (data ? 1 : 0); // +1 for today

  return (
    <>
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold tracking-tight text-gray-900 dark:text-gray-100">
            Archive
          </h2>
          <p className="text-xs font-medium text-gray-500">
            {premium && data
              ? `Tap a day to play · ${solvedCount}/${totalPuzzles} solved`
              : 'Tap a day to play that puzzle'}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors duration-fast"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="w-4 h-4" aria-hidden>
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      <div className="mt-5">
        {!premium ? (
          <PremiumBenefitsList
            hook="Premium unlocks every past puzzle from the full archive."
            onUpgrade={onUpgrade}
          />
        ) : loading ? (
          <div className="flex justify-center py-10">
            <CircleNotch className="w-6 h-6 text-gray-400 animate-spin" weight="bold" aria-hidden />
          </div>
        ) : error ? (
          <p className="text-center text-sm text-red-600 dark:text-red-400 py-8">
            Couldn’t load the archive. Try again.
          </p>
        ) : months.length === 0 ? (
          <p className="text-center text-gray-500 text-sm py-8">
            No past puzzles yet.
          </p>
        ) : (
          <div className="flex flex-col gap-6">
            {months.map((m) => (
              <MonthGrid key={m.key} month={m} onDayPick={onDayPick} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

/**
 * One month's worth of calendar cells, with leading/trailing empties
 * so the 7-col grid always lines up. Puzzle cells rendered with
 * state-specific styling; non-puzzle cells render nothing (invisible
 * placeholder) so the grid keeps its shape.
 */
function MonthGrid({
  month,
  onDayPick,
}: {
  month: CalendarMonth;
  onDayPick: (dayNumber: number) => void;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-2 px-1">
        <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">
          {month.label}
        </h3>
        <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 tabular-nums">
          {month.solvedInMonth}/{month.puzzlesInMonth} solved
        </span>
      </div>
      <div className="grid grid-cols-7 gap-1">
        {WEEKDAY_LABELS.map((d) => (
          <div
            key={d}
            className="text-[9px] font-bold uppercase tracking-wider text-gray-400 text-center py-1"
            aria-hidden
          >
            {d}
          </div>
        ))}
        {month.cells.map((cell, i) => (
          <DayCell key={`${month.key}-${i}`} cell={cell} onDayPick={onDayPick} />
        ))}
      </div>
    </div>
  );
}

function DayCell({
  cell,
  onDayPick,
}: {
  cell: CalendarCell;
  onDayPick: (dayNumber: number) => void;
}) {
  if (cell.kind === 'empty') {
    return <div className="aspect-square" aria-hidden />;
  }
  // Kind is 'puzzle' from here on — solved | today | past-unsolved
  const { dayNumber, dayOfMonth, solved, isToday } = cell;
  const base =
    'aspect-square rounded-full flex items-center justify-center text-xs font-bold tabular-nums transition-colors duration-fast focus:outline-none focus-visible:ring-2 focus-visible:ring-brand';
  const state = isToday
    ? 'bg-brand text-white shadow-btn ring-2 ring-brand-200 dark:ring-brand-700'
    : solved
      ? 'bg-accent/15 text-accent ring-1 ring-accent/40 hover:bg-accent/25'
      : 'bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-gray-700/60 dark:text-gray-300 dark:hover:bg-gray-600';
  const ariaLabel = `${cell.dateLabel}${isToday ? ' · today' : solved ? ' · solved' : ''}, Griddle #${dayNumber
    .toString()
    .padStart(3, '0')}`;
  return (
    <button
      type="button"
      onClick={() => onDayPick(dayNumber)}
      className={`${base} ${state} relative`}
      title={ariaLabel}
      aria-label={ariaLabel}
    >
      <span>{dayOfMonth}</span>
      {solved && !isToday && (
        <Check
          className="absolute -top-0.5 -right-0.5 w-3 h-3 text-accent bg-white dark:bg-gray-800 rounded-full p-[1px]"
          weight="bold"
          aria-hidden
        />
      )}
    </button>
  );
}

// ── Calendar shape + builder ─────────────────────────────────────────

interface CalendarMonth {
  /** `YYYY-MM` — stable key for React lists. */
  key: string;
  /** Human-readable header like "April 2026". */
  label: string;
  cells: CalendarCell[];
  puzzlesInMonth: number;
  solvedInMonth: number;
}

type CalendarCell =
  | { kind: 'empty' }
  | {
      kind: 'puzzle';
      dayNumber: number;
      dayOfMonth: number;
      dateLabel: string;
      solved: boolean;
      isToday: boolean;
    };

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function buildMonths(
  entries: ArchiveEntry[],
  solved: Set<number>,
  todayDayNumber: number,
): CalendarMonth[] {
  // Index entries by ISO date for O(1) lookup during grid fill.
  const byDate = new Map<string, ArchiveEntry>();
  for (const e of entries) byDate.set(e.date, e);

  // Find the distinct months covered, most recent first.
  const monthKeys = Array.from(
    new Set(entries.map((e) => e.date.slice(0, 7))),
  ).sort((a, b) => b.localeCompare(a));

  return monthKeys.map((ym) => {
    const [yStr, mStr] = ym.split('-');
    const year = Number(yStr);
    const monthIndex = Number(mStr) - 1;
    const label = `${MONTH_NAMES[monthIndex]} ${year}`;

    // UTC-based math so the calendar matches puzzle-date semantics
    // (puzzles key off a UTC date column). Rendering in local-TZ
    // would drift by a day for users east/west of UTC.
    const firstDow = new Date(Date.UTC(year, monthIndex, 1)).getUTCDay();
    const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();

    const cells: CalendarCell[] = [];
    // Leading empties to align Sunday-first.
    for (let i = 0; i < firstDow; i++) cells.push({ kind: 'empty' });

    let puzzlesInMonth = 0;
    let solvedInMonth = 0;
    for (let day = 1; day <= daysInMonth; day++) {
      const iso = `${yStr}-${mStr}-${String(day).padStart(2, '0')}`;
      const entry = byDate.get(iso);
      if (!entry) {
        cells.push({ kind: 'empty' });
        continue;
      }
      puzzlesInMonth += 1;
      const isSolved = solved.has(entry.dayNumber);
      if (isSolved) solvedInMonth += 1;
      cells.push({
        kind: 'puzzle',
        dayNumber: entry.dayNumber,
        dayOfMonth: day,
        dateLabel: `${MONTH_NAMES[monthIndex]} ${day}, ${year}`,
        solved: isSolved,
        isToday: entry.dayNumber === todayDayNumber,
      });
    }
    // Pad trailing cells to a full week so the grid's right edge
    // stays flush across months.
    while (cells.length % 7 !== 0) cells.push({ kind: 'empty' });

    return {
      key: ym,
      label,
      cells,
      puzzlesInMonth,
      solvedInMonth,
    };
  });
}
