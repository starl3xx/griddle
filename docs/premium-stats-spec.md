# PR C — Premium Stats Dashboard

## Overview

New section in StatsPanel below the basic stats grid. Premium users see interactive charts and placement data. Free users see a blurred preview with an upgrade CTA.

## Discovered issues / scope additions

### Solve time overflows MM:SS past one hour

`lib/format.ts#formatMs` / `formatSeconds` render every duration as `${m}:${ss}` with no hours branch, so a 13-hour solve shows `790:44` instead of `13:10:44`. Hit surfaces include SolveModal, StatsPanel, LeaderboardPanel, the share image, and the admin Anomalies/Funnel tabs. Since the new Premium Stats charts (sparkline Y-axis labels, bar chart tooltips, podium times) will render solve times too, the formatter fix is in-scope for this PR.

**Fix plan:**
- Add an explicit hours branch: if `totalSeconds >= 3600`, return `${h}:${mm}:${ss}` with mm / ss zero-padded; otherwise keep the existing `${m}:${ss}` to avoid visual regression on short solves.
- Keep `formatCountdown` (already `HH:MM:SS`) unchanged — it's the template to mirror.
- No new symbol; `formatMs` signature stays the same, so all 9 callers pick up the fix automatically.
- Add a unit-test or a couple of inline assertions pinning: `formatMs(59_999) === '1:00'`, `formatMs(3_600_000) === '1:00:00'`, `formatMs(47_444_000) === '13:10:44'`.

## Backend

### New query: `getPremiumStats(wallet: string)`

**File:** `lib/db/queries.ts`

**Returns:**
```typescript
interface PremiumStats {
  // Sparkline: last 30 eligible solves, oldest first
  solveTrend: { dayNumber: number; serverSolveMs: number }[];

  // Bar chart: last 7 calendar days, null if no solve that day
  last7Days: { dayNumber: number; date: string; serverSolveMs: number | null }[];

  // Percentile: where the user ranks on today's leaderboard
  // null if they haven't solved today
  percentileRank: number | null; // 0-100, e.g. 88 = "faster than 88%"

  // Podium: count of 1st, 2nd, 3rd, and top-10 placements
  // across all days the user has solved
  placements: {
    first: number;
    second: number;
    third: number;
    topTen: number; // includes 1st/2nd/3rd
  };
}
```

**Query approach:**
- `solveTrend`: `SELECT day_number, server_solve_ms FROM solves JOIN puzzles ... WHERE wallet = $1 AND solved AND (flag IS NULL OR flag = 'suspicious') ORDER BY created_at DESC LIMIT 30`, then reverse for oldest-first
- `last7Days`: Get last 7 puzzle day numbers, left join with the user's solves for each
- `percentileRank`: Reuse `getDailyLeaderboard(today)`, find user's position, compute `100 - (rank / total * 100)` rounded
- `placements`: For each puzzle the user has solved, compute their rank via the same leaderboard logic. Count 1st/2nd/3rd/top-10. This is the expensive query — consider caching or computing incrementally on solve

### New API route: `GET /api/stats/premium`

**File:** `app/api/stats/premium/route.ts`

- Requires wallet bound to session (same auth as `/api/stats`)
- Returns `{ stats: PremiumStats }` or `{ stats: null }` if no wallet
- Consider Upstash caching with short TTL (~60s) since leaderboard data changes infrequently

## Frontend

### New component: `PremiumStatsSection`

**File:** `components/panels/PremiumStatsSection.tsx`

Rendered inside `StatsPanel` after the basic `StatsGrid`, gated on `hasAccount`.

#### Layout (top to bottom):

**1. Solve Time Sparkline**
- Pure SVG, no charting library
- Last 30 data points from `solveTrend`, connected line with subtle gradient fill below
- X-axis implicit (just the line), Y-axis label shows fastest and slowest
- Responsive width (fills container), fixed ~80px height

**2. Last 7 Days Bar Chart**
- 7 vertical bars, one per day
- Height proportional to solve time (taller = slower)
- Missing days show a dotted-outline placeholder bar
- Day labels below: Mon/Tue/Wed or day numbers
- Brand color fill, ~100px height

**3. Percentile Rank**
- Bold number: "Top 12%" or "Faster than 88%"
- Subtle distribution curve SVG with a marker dot at the user's position (optional — can ship as text-only first and add the curve later)
- Shows "Solve today's puzzle to see your rank" if `percentileRank` is null

**4. Podium Tile**
- Three stepped bars (gold/silver/bronze) — tallest left (1st), medium center (2nd), shortest right (3rd)
- Count inside each bar
- Colors: gold `#FFD700`, silver `#C0C0C0`, bronze `#CD7F32` (or themed equivalents)
- Below the podium: "**N** top-10 finishes" as a single line
- All in one bordered card matching the stats grid density

#### Free user preview:
- Render the same section but with:
  - `opacity-40 blur-[2px] pointer-events-none` on the stats content
  - Absolute-positioned overlay with Diamond icon + "Unlock with Premium" button
  - Use dummy/placeholder data for the blurred preview so it looks populated

### StatsPanel integration

In `components/panels/StatsPanel.tsx`, after the `StatsGrid` render:

```tsx
{hasAccount && (
  <PremiumStatsSection
    wallet={wallet}
    premium={premium}
    onUpgrade={onUpgrade}
  />
)}
```

The component fetches its own data from `/api/stats/premium` on mount (only when `premium` is true). When `!premium`, it renders the blurred preview with static placeholder data.

## Design notes

- SVG sparkline and bar chart should respect dark mode (`stroke`/`fill` colors adapt)
- All charts are pure SVG — no D3, no Recharts, no bundle bloat
- Podium uses CSS for the stepped bars, not SVG
- The percentile curve (if added) is a single `<path>` bell curve with a dot — ~10 lines of SVG
- Entire section animates in with the same `animate-fade-in` used elsewhere

## Test plan

- [ ] Premium user with solves -> sparkline renders with correct data points
- [ ] Premium user with <7 days of solves -> bar chart shows gaps correctly
- [ ] Premium user solves today -> percentile shows
- [ ] Premium user hasn't solved today -> "Solve today's puzzle" message
- [ ] Premium user with leaderboard placements -> podium counts correct
- [ ] Free user -> blurred preview visible with upgrade CTA
- [ ] Dark mode -> all charts render correctly
- [ ] Mobile -> charts are responsive, no horizontal overflow
- [ ] Solve that took >1h displays as H:MM:SS in SolveModal (was MM:SS with minutes overflow)
- [ ] Same fix flows through StatsPanel "fastest / last solve" times, LeaderboardPanel rows, the share image, and admin tabs
