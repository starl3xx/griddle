/**
 * Shared visual primitives for the OG image routes.
 *
 * Both /api/og (1200x630 share card) and /api/og/embed (1200x800
 * Farcaster miniapp embed) render the same 3x3 tile pattern in the
 * same palette as the home-screen icon (public/icon.svg). The shared
 * bits live here so a brand-color or pattern change lands in one file.
 *
 * Consumed only by edge-runtime OG routes — no browser APIs, no hooks.
 */

export const BRAND = '#2D68C7';
export const GRAY_500 = '#6b7280';
export const GRAY_900 = '#111827';

const TILE_MINT_FILL = '#D1FAE5';
const TILE_MINT_STROKE = '#86EFAC';
const TILE_EDGE_FILL = '#F1F3F5';
const TILE_EDGE_STROKE = '#D9D9D9';

export type CellState = 'available' | 'blocked' | 'current';

// Mirrors the TinyGridIllustration in TutorialModal: center is the
// "current" cell, the four orthogonal neighbors are "blocked" (off-
// limits), and the four diagonal corners are "available" (go). Same
// visual story as the real game grid — recognizable without letters.
export const TILE_PATTERN: readonly CellState[] = [
  'available', 'blocked',  'available',
  'blocked',   'current',  'blocked',
  'available', 'blocked',  'available',
];

const TILE_STYLES: Record<CellState, { bg: string; border: string }> = {
  available: { bg: TILE_MINT_FILL, border: TILE_MINT_STROKE },
  blocked: { bg: TILE_EDGE_FILL, border: TILE_EDGE_STROKE },
  current: { bg: BRAND, border: BRAND },
};

export function TileCell({ state, size }: { state: CellState; size: number }) {
  const { bg, border } = TILE_STYLES[state];
  return (
    <div
      style={{
        width: `${size}px`,
        height: `${size}px`,
        backgroundColor: bg,
        border: `4px solid ${border}`,
        borderRadius: `${Math.round(size * 0.12)}px`,
      }}
    />
  );
}
