'use strict';
/**
 * Składanie prezentacji z klatek wyrenderowanych przez FFmpeg.
 *  - PPTX: pptxgenjs (czysty JS, działa też w zwykłym Node – patrz test/slides.test.js)
 *  - PDF:  ukryte okno Chromium + printToPDF (wymaga Electrona)
 *
 * meta: { images: [ścieżki JPG], info: [{ time, texts: [] }], aspect: [a, b], title, outPath, tmpDir }
 */
const fs = require('fs');
const path = require('path');

const fmtClock = (t) => {
  const s = Math.max(0, Math.round(t * 10) / 10);
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}:${r < 10 ? '0' : ''}${r.toFixed(1)}`;
};

/** Rozmiar strony w calach: dłuższy bok 13,333" (jak domyślny slajd 16:9 w PowerPoincie). */
function pageInches([a, b]) {
  const long = 13.333;
  return a >= b ? { w: long, h: +((long * b) / a).toFixed(3) } : { w: +((long * a) / b).toFixed(3), h: long };
}

function notesFor(item, i, total) {
  const lines = [`Slajd ${i + 1}/${total} – kadr z ${fmtClock(item.time)}`];
  if (item.texts.length) lines.push('', ...item.texts);
  return lines.join('\n');
}

async function buildPptx({ images, info, aspect, title, outPath }) {
  if (!images.length) throw new Error('Nie powstała żadna klatka do prezentacji.');
  const PptxGenJS = require('pptxgenjs');
  const pptx = new PptxGenJS();
  const { w, h } = pageInches(aspect);
  pptx.defineLayout({ name: 'KADR', width: w, height: h });
  pptx.layout = 'KADR';
  pptx.title = title;
  pptx.author = 'Kadr Studio';
  images.forEach((img, i) => {
    const s = pptx.addSlide();
    s.background = { color: '000000' };
    s.addImage({ path: img, x: 0, y: 0, w, h });
    s.addNotes(notesFor(info[i], i, images.length));
  });
  await pptx.writeFile({ fileName: outPath, compression: true });
}

async function buildPdf({ images, aspect, title, outPath, tmpDir }) {
  if (!images.length) throw new Error('Nie powstała żadna klatka do prezentacji.');
  const { BrowserWindow } = require('electron');
  const { w, h } = pageInches(aspect);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // obrazy leżą obok pliku HTML w katalogu tymczasowym => względne ścieżki, bez file:// i bez sieci
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' file:; style-src 'unsafe-inline'">
<style>
@page { size: ${w}in ${h}in; margin: 0; }
html, body { margin: 0; padding: 0; background: #000; }
.page { width: ${w}in; height: ${h}in; break-after: page; overflow: hidden; }
.page:last-child { break-after: auto; }
img { display: block; width: 100%; height: 100%; object-fit: contain; }
</style></head><body>
${images.map((f) => `<div class="page"><img src="${esc(path.basename(f))}"></div>`).join('\n')}
</body></html>`;
  const htmlPath = path.join(tmpDir, 'slides.html');
  fs.writeFileSync(htmlPath, html, 'utf8');

  const pw = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false },
  });
  try {
    await pw.loadFile(htmlPath);
    const pdf = await pw.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
    });
    fs.writeFileSync(outPath, pdf);
  } finally {
    pw.destroy();
  }
}

module.exports = { buildPptx, buildPdf, pageInches, fmtClock };
