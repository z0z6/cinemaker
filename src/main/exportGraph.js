'use strict';
/**
 * Zamienia model projektu (klipy na torach) na argumenty FFmpeg.
 * Moduł jest czysty (bez Electrona), dzięki czemu można go testować w Node (test/graph.test.js).
 *
 * Model klipu:
 *  { id, track, type: 'video'|'image'|'audio'|'text', mediaId,
 *    start, in, out, speed, volume, fadeIn, fadeOut,
 *    scale, x, y, opacity, brightness, contrast, saturation, blur, sepia,   // wideo / obraz
 *    text, fontSize, color, bold, box }                                      // tekst (rasteryzowany do PNG przez renderer)
 *  start = pozycja na osi czasu [s]; in/out = zakres w źródle [s]; czas na osi = (out-in)/speed
 */
const path = require('path');

const ASPECTS = { '16:9': [16, 9], '9:16': [9, 16], '1:1': [1, 1], '4:3': [4, 3], '21:9': [21, 9] };

const even = (v) => Math.max(2, Math.round(v / 2) * 2);

/** shortSide = krótszy bok kadru (720, 1080, 1440, 2160) */
function canvasSize(aspect, shortSide) {
  const [a, b] = ASPECTS[aspect] || ASPECTS['16:9'];
  return a >= b
    ? { w: even((shortSide * a) / b), h: even(shortSide) }
    : { w: even(shortSide), h: even((shortSide * b) / a) };
}

const n = (v) => String(+Number(v).toFixed(4)); // liczba bez notacji wykładniczej
const dur = (c) => (c.out - c.in) / (c.speed || 1);
const endOf = (c) => c.start + dur(c);

// atempo przyjmuje 0.5–2.0, więc większe/mniejsze tempo składamy w łańcuch
function atempoChain(speed) {
  const out = [];
  let s = speed;
  while (s > 2) { out.push('atempo=2'); s /= 2; }
  while (s < 0.5) { out.push('atempo=0.5'); s /= 0.5; }
  if (Math.abs(s - 1) > 1e-6) out.push(`atempo=${n(s)}`);
  return out;
}

function buildExportArgs(project, o) {
  const { width: W, height: H, fps } = o;
  const clips = project.clips.filter((c) => c.out - c.in > 0.01);
  if (!clips.length) throw new Error('Projekt jest pusty – dodaj klipy na oś czasu.');
  const media = new Map(project.media.map((m) => [m.id, m]));
  const D = Math.max(0.1, ...clips.map(endOf));

  const inputs = ['-f', 'lavfi', '-t', n(D), '-i', 'anullsrc=r=48000:cl=stereo']; // wejście 0 = cisza (baza audio)
  let nextInput = 1;
  const parts = [`color=c=black:s=${W}x${H}:r=${fps}:d=${n(D)}[base]`];
  const files = [];
  const audioLabels = ['[0:a]'];

  const getMedia = (c) => {
    const m = media.get(c.mediaId);
    if (!m) throw new Error(`Brak pliku źródłowego dla klipu (${c.type}).`);
    return m;
  };

  const audioChain = (inLabel, c, outLabel) => {
    const sp = c.speed || 1;
    const d = dur(c);
    const f = ['asetpts=PTS-STARTPTS', 'aresample=48000', 'aformat=sample_fmts=fltp:channel_layouts=stereo', ...atempoChain(sp)];
    if (Math.abs(c.volume - 1) > 1e-6) f.push(`volume=${n(c.volume)}`);
    if (c.fadeIn > 0) f.push(`afade=t=in:st=0:d=${n(c.fadeIn)}`);
    if (c.fadeOut > 0) f.push(`afade=t=out:st=${n(Math.max(0, d - c.fadeOut))}:d=${n(c.fadeOut)}`);
    const ms = Math.round(c.start * 1000);
    f.push(`adelay=${ms}|${ms}`);
    parts.push(`${inLabel}${f.join(',')}${outLabel}`);
    audioLabels.push(outLabel);
  };

  // ---------- WARSTWY OBRAZU: wideo/obrazy (V1 pod V2), na wierzchu napisy ----------
  // Napisy są wcześniej rasteryzowane do PNG przez Chromium (o.textImages[clipId] = ścieżka),
  // dzięki czemu nie potrzeba filtra drawtext (brak w wielu buildach FFmpeg) ani czcionek systemowych.
  const z = { V1: 0, V2: 1 };
  const layers = [
    ...clips
      .filter((c) => c.type === 'video' || c.type === 'image')
      .sort((a, b) => (z[a.track] || 0) - (z[b.track] || 0) || a.start - b.start),
    ...clips.filter((c) => c.type === 'text' && String(c.text || '').trim()).sort((a, b) => a.start - b.start),
  ];

  let cur = 'base';
  layers.forEach((c, i) => {
    const isText = c.type === 'text';
    const m = isText ? null : getMedia(c);
    const sp = c.type === 'video' ? c.speed || 1 : 1;
    const d = dur(c);
    const idx = nextInput++;
    if (isText) {
      const tp = o.textImages && o.textImages[c.id];
      if (!tp) throw new Error('Brak obrazu napisu dla klipu tekstowego.');
      inputs.push('-loop', '1', '-framerate', String(fps), '-t', n(d), '-i', tp);
    } else if (c.type === 'image') {
      inputs.push('-loop', '1', '-framerate', String(fps), '-t', n(d), '-i', m.path);
    } else {
      inputs.push('-ss', n(c.in), '-t', n(c.out - c.in), '-i', m.path);
    }

    const f = [`setpts=(PTS-STARTPTS)/${n(sp)}`, `fps=${fps}`];
    if (isText) f.push('setsar=1'); // PNG ma już docelowy rozmiar w pikselach kadru
    else f.push(`scale=${W}:${H}:force_original_aspect_ratio=decrease`, 'setsar=1');
    const s = c.scale ?? 1;
    if (!isText && Math.abs(s - 1) > 1e-3) f.push(`scale=trunc(iw*${n(s)}/2)*2:trunc(ih*${n(s)}/2)*2`);
    if (c.brightness || (c.contrast ?? 1) !== 1 || (c.saturation ?? 1) !== 1) {
      f.push(`eq=brightness=${n(c.brightness || 0)}:contrast=${n(c.contrast ?? 1)}:saturation=${n(c.saturation ?? 1)}`);
    }
    if (c.blur > 0) f.push(`gblur=sigma=${n((c.blur * H) / 1080)}`);
    const op = c.opacity ?? 1;
    if (c.sepia || op < 1) {
      const mix = [];
      if (c.sepia) mix.push('rr=.393:rg=.769:rb=.189:gr=.349:gg=.686:gb=.168:br=.272:bg=.534:bb=.131');
      if (op < 1) mix.push(`aa=${n(op)}`);
      f.push('format=rgba', `colorchannelmixer=${mix.join(':')}`);
    }
    if (isText || op < 1 || c.fadeIn > 0 || c.fadeOut > 0) f.push('format=yuva420p');
    if (c.fadeIn > 0) f.push(`fade=t=in:st=0:d=${n(c.fadeIn)}:alpha=1`);
    if (c.fadeOut > 0) f.push(`fade=t=out:st=${n(Math.max(0, d - c.fadeOut))}:d=${n(c.fadeOut)}:alpha=1`);
    f.push(`setpts=PTS+${n(c.start)}/TB`);
    parts.push(`[${idx}:v]${f.join(',')}[v${i}]`);

    const ox = `(W-w)/2+${n((c.x || 0) / 100)}*W`;
    const oy = `(H-h)/2+${n((c.y || 0) / 100)}*H`;
    parts.push(
      `[${cur}][v${i}]overlay=x='${ox}':y='${oy}':eof_action=pass:enable='between(t,${n(c.start)},${n(endOf(c))})'[o${i}]`
    );
    cur = `o${i}`;

    if (c.type === 'video' && m.hasAudio && c.volume > 0) audioChain(`[${idx}:a]`, c, `[av${i}]`);
  });
  parts.push(`[${cur}]format=yuv420p[vout]`);

  // ---------- AUDIO ----------
  clips
    .filter((c) => c.type === 'audio')
    .sort((a, b) => a.start - b.start)
    .forEach((c, i) => {
      const m = getMedia(c);
      const idx = nextInput++;
      inputs.push('-ss', n(c.in), '-t', n(c.out - c.in), '-i', m.path);
      audioChain(`[${idx}:a]`, c, `[aa${i}]`);
    });
  parts.push(`${audioLabels.join('')}amix=inputs=${audioLabels.length}:duration=first:normalize=0:dropout_transition=0,alimiter=limit=0.97[aout]`);

  // ---------- ARGUMENTY ----------
  let graph = parts.join(';');
  const graphArgs = [];
  if (graph.length > 20000) {
    // bardzo długi graf: Windows ogranicza długość wiersza poleceń
    const gp = path.join(o.tmpDir, 'graph.txt').replace(/\\/g, '/');
    files.push({ path: gp, content: graph });
    graphArgs.push('-filter_complex_script', gp);
  } else {
    graphArgs.push('-filter_complex', graph);
  }

  const args = [
    '-y', '-hide_banner', '-loglevel', 'error', '-nostats', '-progress', 'pipe:1',
    ...inputs,
    ...graphArgs,
    '-map', '[vout]', '-map', '[aout]',
    '-c:v', 'libx264', '-preset', o.preset || 'medium', '-crf', String(o.crf ?? 21), '-pix_fmt', 'yuv420p', '-r', String(fps),
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
    '-movflags', '+faststart',
    '-t', n(D),
    o.outPath,
  ];
  return { args, files, duration: D, graph };
}

module.exports = { buildExportArgs, canvasSize, ASPECTS };
