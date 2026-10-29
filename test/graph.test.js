'use strict';
// Smoke test: generuje materiały testowe, buduje graf eksportu i renderuje film prawdziwym FFmpeg.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { buildExportArgs, canvasSize } = require('../src/main/exportGraph');

const tryRequire = (name, pick) => { try { const v = require(name); return pick ? pick(v) : v; } catch { return null; } };
const FFMPEG = process.env.FFMPEG_PATH || tryRequire('ffmpeg-static') || 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH || tryRequire('ffprobe-static', (v) => v.path) || 'ffprobe';

function findFont(bold) {
  const win = path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts', bold ? 'arialbd.ttf' : 'arial.ttf');
  if (fs.existsSync(win)) return win.replace(/\\/g, '/');
  const lin = bold ? '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf' : '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
  if (fs.existsSync(lin)) return lin;
  throw new Error('Nie znaleziono czcionki do testu drawtext');
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kadr-test-'));
const run = (bin, args) => execFileSync(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] }).toString();

// --- materiały testowe ---
const vid = path.join(tmp, 'a.mp4');
const vid2 = path.join(tmp, 'b.mp4');
const aud = path.join(tmp, 'm.wav');
const img = path.join(tmp, 'i.png');
run(FFMPEG, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=s=640x360:r=25:d=4', '-f', 'lavfi', '-i', 'sine=f=440:d=4', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-y', vid]);
run(FFMPEG, ['-v', 'error', '-f', 'lavfi', '-i', 'smptebars=s=320x240:r=25:d=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', vid2]); // bez audio
run(FFMPEG, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=f=220:d=6', '-y', aud]);
run(FFMPEG, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=200x200', '-frames:v', '1', '-y', img]);

const vis = { scale: 1, x: 0, y: 0, opacity: 1, brightness: 0, contrast: 1, saturation: 1, blur: 0, sepia: false };
const base = { speed: 1, volume: 1, fadeIn: 0, fadeOut: 0 };
const project = {
  media: [
    { id: 'm1', path: vid, kind: 'video', duration: 4, hasAudio: true },
    { id: 'm2', path: vid2, kind: 'video', duration: 3, hasAudio: false },
    { id: 'm3', path: aud, kind: 'audio', duration: 6, hasAudio: true },
    { id: 'm4', path: img, kind: 'image', duration: 5, hasAudio: false },
  ],
  clips: [
    { id: 'c1', track: 'V1', type: 'video', mediaId: 'm1', start: 0, in: 0, out: 4, ...base, ...vis, fadeIn: 0.5, saturation: 0, contrast: 1.2 },
    { id: 'c2', track: 'V1', type: 'video', mediaId: 'm2', start: 4, in: 0, out: 3, ...base, ...vis, speed: 2, sepia: true, blur: 3 },
    { id: 'c3', track: 'V2', type: 'image', mediaId: 'm4', start: 1, in: 0, out: 2, ...base, ...vis, scale: 0.3, x: 30, y: -30, opacity: 0.7, fadeOut: 0.5 },
    { id: 'c4', track: 'T1', type: 'text', start: 0.5, in: 0, out: 3, ...base, text: 'Zażółć gęślą jaźń: 100%', fontSize: 8, color: '#ffee00', bold: true, box: true, x: 0, y: 30, fadeIn: 0.3, fadeOut: 0.3 },
    { id: 'c5', track: 'A1', type: 'audio', mediaId: 'm3', start: 0, in: 1, out: 5, ...base, volume: 0.5, fadeOut: 1 },
  ],
};
const expected = Math.max(4 + 1.5, 4); // c2: 3 s / 2x = 1.5 s, zaczyna się w 4 s => 5.5 s

const { w, h } = canvasSize('9:16', 720);
if (w !== 720 || h !== 1280) throw new Error(`canvasSize 9:16/720 => ${w}x${h}`);

const out = path.join(tmp, 'out.mp4');
const built = buildExportArgs(project, {
  width: 640, height: 360, fps: 25, crf: 28, preset: 'ultrafast',
  outPath: out, tmpDir: tmp, fontRegular: findFont(false), fontBold: findFont(true),
});
for (const f of built.files) fs.writeFileSync(f.path, f.content, 'utf8');
try {
  run(FFMPEG, built.args.filter((a, i, arr) => !(a === '-progress' || arr[i - 1] === '-progress')));
} catch (e) {
  console.error('FFmpeg error:\n' + (e.stderr ? e.stderr.toString() : e.message));
  console.error('\nGRAF:\n' + built.graph);
  process.exit(1);
}

const info = JSON.parse(run(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', out]));
const dur = parseFloat(info.format.duration);
const hasV = info.streams.some((s) => s.codec_type === 'video');
const hasA = info.streams.some((s) => s.codec_type === 'audio');
if (!hasV || !hasA) throw new Error('Brak strumienia wideo lub audio w wyniku');
if (Math.abs(dur - expected) > 0.35) throw new Error(`Zła długość: ${dur}s (oczekiwano ~${expected}s)`);
console.log(`OK: ${w}x${h} canvas, eksport ${dur.toFixed(2)}s, wideo+audio obecne`);
