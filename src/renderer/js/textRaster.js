// Rasteryzacja napisów do PNG (canvas w Chromium). Ten sam silnik tekstu co w podglądzie,
// więc eksport wygląda jak podgląd, a FFmpeg nie potrzebuje filtra drawtext ani czcionek.
import { TEXT_FONT } from './store.js';

const even = (n) => Math.max(2, Math.ceil(n / 2) * 2);

/** Zwraca PNG (base64) z napisem w rozmiarze pikseli docelowego kadru o wysokości H. */
export function rasterizeText(c, H) {
  const px = Math.max(8, Math.round((H * (c.fontSize || 8)) / 100));
  const k = H / 1080;
  const lines = String(c.text).split('\n');
  const font = `${c.bold ? 700 : 400} ${px}px ${TEXT_FONT}`;
  const lh = px * 1.2;

  const probe = document.createElement('canvas').getContext('2d');
  probe.font = font;
  const tw = Math.max(...lines.map((l) => probe.measureText(l).width));
  const pad = c.box ? Math.round(H * 0.013) : 0;
  const sh = Math.max(1, Math.round(2 * k)); // przesunięcie cienia (jak w podglądzie)
  const margin = sh + 2;

  const cw = even(tw + 2 * pad + 2 * margin);
  const ch = even(lines.length * lh + 2 * pad + 2 * margin);
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (c.box) {
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    ctx.fillRect(margin, margin, cw - 2 * margin, ch - 2 * margin);
  }
  lines.forEach((line, i) => {
    const x = cw / 2;
    const y = margin + pad + lh * (i + 0.5);
    ctx.fillStyle = 'rgba(0,0,0,.5)';
    ctx.fillText(line, x + sh, y + sh);
    ctx.fillStyle = c.color || '#ffffff';
    ctx.fillText(line, x, y);
  });
  return canvas.toDataURL('image/png').split(',')[1];
}
