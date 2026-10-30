// Podgląd na żywo: każdy aktywny klip to element DOM ułożony wg toru (V1 < V2 < tekst).
// Wideo/audio są synchronizowane z zegarem osi czasu.
import { state, emit, ASPECTS, clipDur, clipEnd, projectDuration, getMedia, fileUrl, clamp, TEXT_FONT } from './store.js';
import { $, h } from './dom.js';

const stage = $('#stage');
const wrap = $('#stage-wrap');
const els = new Map(); // clipId -> element
const Z = { V1: 1, V2: 2, T1: 3 };
let stageH = 360;
let raf = 0;
let startWall = 0;
let startT = 0;

export function fit() {
  const [aw, ah] = ASPECTS[state.project.settings.aspect] || ASPECTS['16:9'];
  const r = wrap.getBoundingClientRect();
  const mw = r.width - 32, mh = r.height - 32;
  let w = mw, hh = (w * ah) / aw;
  if (hh > mh) { hh = mh; w = (hh * aw) / ah; }
  stage.style.width = Math.max(40, w) + 'px';
  stage.style.height = Math.max(40, hh) + 'px';
  stageH = Math.max(40, hh);
  render();
}
new ResizeObserver(fit).observe(wrap);

function create(c) {
  let e;
  if (c.type === 'video' || c.type === 'audio') {
    e = document.createElement(c.type === 'video' ? 'video' : 'audio');
    e.preload = 'auto';
    e.src = fileUrl(getMedia(c.mediaId)?.path || '');
    if (c.type === 'video') e.playsInline = true;
  } else if (c.type === 'image') {
    e = document.createElement('img');
    e.src = fileUrl(getMedia(c.mediaId)?.path || '');
  } else {
    e = h('div', 'ov-text');
  }
  if (c.type !== 'text') e.className = 'layer';
  stage.appendChild(e);
  return e;
}

function pauseMedia(e) {
  if (e.pause && !e.paused) e.pause();
}

function update(e, c, t) {
  const local = t - c.start;
  const d = clipDur(c);
  const fi = c.fadeIn > 0 ? Math.min(1, local / c.fadeIn) : 1;
  const fo = c.fadeOut > 0 ? Math.min(1, (d - local) / c.fadeOut) : 1;
  const fade = clamp(Math.min(fi, fo), 0, 1);
  const k = stageH / 1080; // współczynnik skali względem kadru 1080 (jak w eksporcie)

  if (c.type === 'video' || c.type === 'image') {
    e.style.display = 'block';
    e.style.zIndex = Z[c.track] || 1;
    e.style.opacity = (c.opacity ?? 1) * fade;
    e.style.filter =
      `brightness(${1 + (c.brightness || 0)}) contrast(${c.contrast ?? 1}) saturate(${c.saturation ?? 1})` +
      (c.blur > 0 ? ` blur(${c.blur * k}px)` : '') +
      (c.sepia ? ' sepia(1)' : '');
    e.style.transform = `translate(${c.x || 0}%, ${c.y || 0}%) scale(${c.scale ?? 1})`;
  } else if (c.type === 'text') {
    e.style.display = 'block';
    e.style.zIndex = Z.T1;
    e.textContent = c.text;
    e.style.fontFamily = TEXT_FONT;
    e.style.fontSize = (stageH * (c.fontSize || 8)) / 100 + 'px';
    e.style.color = c.color;
    e.style.fontWeight = c.bold ? '700' : '400';
    e.style.left = `calc(50% + ${c.x || 0}%)`;
    e.style.top = `calc(50% + ${c.y || 0}%)`;
    e.style.opacity = fade;
    e.style.background = c.box ? 'rgba(0,0,0,.55)' : 'transparent';
    e.style.padding = c.box ? stageH * 0.013 + 'px' : '0';
    e.style.textShadow = `${2 * k}px ${2 * k}px 0 rgba(0,0,0,.5)`;
  }

  if (c.type === 'video' || c.type === 'audio') {
    const target = c.in + local * (c.speed || 1);
    e.playbackRate = clamp(c.speed || 1, 0.0625, 16);
    e.volume = clamp(c.volume ?? 1, 0, 1) * fade; // podgląd ogranicza głośność do 100%
    if (state.playing) {
      if (e.paused) {
        e.currentTime = target;
        e.play().catch(() => {});
      } else if (Math.abs(e.currentTime - target) > 0.35) {
        e.currentTime = target;
      }
    } else {
      pauseMedia(e);
      if (Math.abs(e.currentTime - target) > 0.03) e.currentTime = target;
    }
  }
}

export function render() {
  const t = state.playhead;
  const clips = state.project.clips;
  for (const c of clips) {
    const active = t >= c.start - 1e-6 && t < clipEnd(c) - 1e-6;
    let e = els.get(c.id);
    if (!active) {
      if (e) { pauseMedia(e); e.style.display = 'none'; }
      continue;
    }
    if (!e) { e = create(c); els.set(c.id, e); }
    update(e, c, t);
  }
  for (const [id, e] of els) {
    if (!clips.some((c) => c.id === id)) { pauseMedia(e); e.remove(); els.delete(id); }
  }
}

function loop() {
  const t = startT + (performance.now() - startWall) / 1000;
  const D = projectDuration();
  if (t >= D) { state.playhead = D; pause(); render(); emit('time'); return; }
  state.playhead = t;
  render();
  emit('time');
  raf = requestAnimationFrame(loop);
}

export function play() {
  const D = projectDuration();
  if (state.playing || D <= 0) return;
  if (state.playhead >= D - 0.01) state.playhead = 0;
  state.playing = true;
  startWall = performance.now();
  startT = state.playhead;
  emit('transport');
  raf = requestAnimationFrame(loop);
}

export function pause() {
  cancelAnimationFrame(raf);
  const was = state.playing;
  state.playing = false;
  for (const e of els.values()) pauseMedia(e);
  if (was) emit('transport');
}

export const toggle = () => (state.playing ? pause() : play());

export function seek(t) {
  state.playhead = Math.max(0, t);
  if (state.playing) { startWall = performance.now(); startT = state.playhead; }
  render();
  emit('time');
}
