import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const ROOT = join(import.meta.dir, '..');
const SRC = join(ROOT, 'public/icon.svg');
const OUT_DIR = join(ROOT, 'public/icons');

const EXPORTS: { size: number; name: string }[] = [
  { size: 32, name: 'icon-32.png' },
  { size: 48, name: 'icon-48.png' },
  { size: 64, name: 'icon-64.png' },
  { size: 180, name: 'apple-touch-icon.png' },
  { size: 192, name: 'icon-192.png' },
  { size: 256, name: 'icon-256.png' },
  { size: 512, name: 'icon-512.png' },
  { size: 1024, name: 'icon-1024.png' },
];

const svg = readFileSync(SRC);
mkdirSync(OUT_DIR, { recursive: true });

for (const { size, name } of EXPORTS) {
  const out = join(OUT_DIR, name);
  await sharp(svg, { density: Math.max(72, Math.round((size / 1024) * 384)) })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(out);
  console.log(`wrote ${out} (${size}×${size})`);
}
