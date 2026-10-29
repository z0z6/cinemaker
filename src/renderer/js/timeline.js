import {
  state, on, emit, TRACKS, getMedia, clipDur, clipEnd, projectDuration, setSelected, beginEdit, endEdit,
  addClipFromMedia, findFreeStart, kindForType, trackKind, fileUrl, clamp, fmtTime, checkpoint,
} from './store.js';
import { seek } from './preview.js';
import { $, h } from './dom.js';

export const LABEL_W = 92;
let pps = 80; // piksele na sekundę

const scroll = $('#tl-scroll');
const content = $('#tl-content');
const rulerLane = $('#tl-ruler-lane');
const tracksEl = $('#tl-tracks');
const headEl = $('#tl-playhead');
const zoomEl = $('#zoom');

const xToTime = (clientX) => (clientX - content.getBoundingClientRect().left - LABEL_W) / pps;

// ---------------------------------------------------------------- rysowanie
function renderRuler(secs) {
  rulerLane.textContent = '';
  rulerLane.style.width = secs * pps + 'px';
  const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800];
  const step = steps.find((s) => s * pps >= 80) || 3600;
  const frag = document.createDocumentFragment();
  const count = Math.ceil(secs / step);
  for (let i = 0; i <= count; i++) {
    const t = i * step;
    const major = h('div', 'tick major');
    major.style.left = t * pps + 'px';
    major.textContent = fmtTime(t, step < 1 ? 2 : 0);
    frag.appendChild(major);
    for (let k = 1; k < 5; k++) {
      const minor = h('div', 'tick');
      minor.style.left = (t + (step * k) / 5) * pps + 'px';
      frag.appendChild(minor);
    }
  }
  rulerLane.appendChild(frag);
}

function clipEl(c) {
  const d = h('div', `tl-clip type-${c.type}` + (c.id === state.selectedId ? ' selected' : ''));
  d.dataset.id = c.id;
  d.style.left = c.start * pps + 'px';
  d.style.width = Math.max(4, clipDur(c) * pps) + 'px';
  const m = getMedia(c.mediaId);
  if (m && m.thumb && (c.type === 'video' || c.type === 'image')) d.style.setProperty('--thumb', `url("${fileUrl(m.thumb)}")`);
  const label = h('span', 'tl-label-text', c.type === 'text' ? String(c.text).split('\n')[0] : m ? m.name : '');
  d.append(h('i', 'handle l'), label, h('i', 'handle r'));
  return d;
}

export function render() {
  const secs = Math.max(projectDuration() + 15, (scroll.clientWidth - LABEL_W) / pps);
  content.style.width = LABEL_W + secs * pps + 'px';
  renderRuler(secs);
  tracksEl.textContent = '';
  for (const t of TRACKS) {
    const row = h('div', 'tl-track');
    row.dataset.track = t.id;
    const lane = h('div', 'tl-lane');
    lane.dataset.track = t.id;
    lane.style.width = secs * pps + 'px';
    for (const c of state.project.clips) if (c.track === t.id) lane.appendChild(clipEl(c));
    row.append(h('div', 'tl-track-name', t.label), lane);
    tracksEl.appendChild(row);
  }
  updatePlayhead();
}

export function updatePlayhead() {
  const x = LABEL_W + state.playhead * pps;
  headEl.style.transform = `translateX(${x}px)`;
  if (state.playing) {
    const vr = scroll.scrollLeft, vw = scroll.clientWidth;
    if (x > vr + vw - 30 || x < vr + LABEL_W) scroll.scrollLeft = Math.max(0, x - LABEL_W - 40);
  }
}

// ---------------------------------------------------------------- zoom
export function setZoom(newPps, anchorClientX) {
  const sr = scroll.getBoundingClientRect();
  const ax = anchorClientX ?? sr.left + sr.width / 2;
  const tAt = xToTime(ax);
  pps = clamp(newPps, 8, 500);
  zoomEl.value = (100 * Math.log(pps / 8)) / Math.log(500 / 8);
  render();
  scroll.scrollLeft = Math.max(0, LABEL_W + tAt * pps - (ax - sr.left));
}
export function zoomFit() {
  const D = Math.max(projectDuration(), 5);
  setZoom((scroll.clientWidth - LABEL_W - 40) / D);
  scroll.scrollLeft = 0;
}
export const zoomBy = (f) => setZoom(pps * f);
zoomEl.addEventListener('input', () => setZoom(8 * Math.pow(500 / 8, zoomEl.value / 100)));
scroll.addEventListener('wheel', (e) => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  setZoom(pps * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX);
}, { passive: false });

// ---------------------------------------------------------------- przewijanie głowicy
function startScrub(e) {
  seek(xToTime(e.clientX));
  const move = (ev) => seek(xToTime(ev.clientX));
  const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
  document.addEventListener('mousemove', move);
  document.addEventListener('mouseup', up);
}
$('#tl-ruler').addEventListener('mousedown', (e) => { if (e.button === 0) startScrub(e); });

// ---------------------------------------------------------------- przeciąganie klipów
const rowAtY = (y) => {
  for (const r of tracksEl.children) {
    const b = r.getBoundingClientRect();
    if (y >= b.top && y < b.bottom) return r.dataset.track;
  }
  return null;
};

function startDrag(e, c, mode) {
  const orig = { ...c };
  const sp = c.speed || 1;
  const sx = e.clientX, sy = e.clientY;
  const d0 = clipDur(c);
  const end0 = c.start + d0;
  const m = getMedia(c.mediaId);
  const mediaLimit = (c.type === 'video' || c.type === 'audio') && m ? m.duration : Infinity;
  const others = state.project.clips.filter((x) => x.id !== c.id);
  const sameTrack = others.filter((x) => x.track === c.track);
  const prevEnd = sameTrack.reduce((v, x) => (clipEnd(x) <= orig.start + 1e-6 ? Math.max(v, clipEnd(x)) : v), 0);
  const nextStart = sameTrack.reduce((v, x) => (x.start >= end0 - 1e-6 ? Math.min(v, x.start) : v), Infinity);
  const pts = [0, state.playhead, ...others.flatMap((x) => [x.start, clipEnd(x)])];
  const snap = (t) => {
    let best = t, bd = 8 / pps;
    for (const p of pts) { const dd = Math.abs(p - t); if (dd < bd) { bd = dd; best = p; } }
    return best;
  };
  let started = false;

  const move = (ev) => {
    const dx = ev.clientX - sx;
    if (!started) {
      if (Math.abs(dx) < 3 && Math.abs(ev.clientY - sy) < 3) return;
      started = true;
      beginEdit();
    }
    if (mode === 'move') {
      let ns = orig.start + dx / pps;
      const s1 = snap(ns), s2 = snap(ns + d0) - d0;
      const d1 = Math.abs(s1 - ns), d2 = Math.abs(s2 - ns);
      if (d1 > 0 && (d2 === 0 || d1 <= d2)) ns = s1; else if (d2 > 0) ns = s2;
      const row = rowAtY(ev.clientY);
      if (row && trackKind(row) === kindForType(c.type)) c.track = row;
      c.start = findFreeStart(c.track, ns, d0, c.id);
    } else if (mode === 'trim-l') {
      const lo = Math.max(prevEnd, orig.start - orig.in / sp);
      const ns = clamp(snap(orig.start + dx / pps), lo, Math.max(lo, end0 - 0.1));
      c.in = orig.in + (ns - orig.start) * sp;
      c.start = ns;
    } else {
      const hi = Math.min(nextStart, mediaLimit === Infinity ? Infinity : orig.start + (mediaLimit - orig.in) / sp);
      const ne = clamp(snap(end0 + dx / pps), orig.start + 0.1, Math.max(orig.start + 0.1, hi));
      c.out = orig.in + (ne - orig.start) * sp;
    }
    state.dirty = true;
    emit('project', { src: 'timeline' });
  };
  const up = () => {
    document.removeEventListener('mousemove', move);
    document.removeEventListener('mouseup', up);
    endEdit();
  };
  document.addEventListener('mousemove', move);
  document.addEventListener('mouseup', up);
}

tracksEl.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  const node = e.target.closest('.tl-clip');
  if (!node) {
    if (e.target.closest('.tl-lane')) { setSelected(null); startScrub(e); }
    return;
  }
  const c = state.project.clips.find((x) => x.id === node.dataset.id);
  if (!c) return;
  const mode = e.target.classList.contains('l') ? 'trim-l' : e.target.classList.contains('r') ? 'trim-r' : 'move';
  setSelected(c.id);
  startDrag(e, c, mode);
});

// ---------------------------------------------------------------- upuszczanie z biblioteki
tracksEl.addEventListener('dragover', (e) => {
  if (e.dataTransfer.types.includes('text/kadr-media')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }
});
tracksEl.addEventListener('drop', (e) => {
  const id = e.dataTransfer.getData('text/kadr-media');
  const lane = e.target.closest('.tl-lane');
  if (!id || !lane) return;
  e.preventDefault();
  addClipFromMedia(id, lane.dataset.track, xToTime(e.clientX));
});

on((type, info) => {
  if (type === 'project' || type === 'select') render();
  else if (type === 'time') updatePlayhead();
});
