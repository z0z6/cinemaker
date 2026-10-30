// Stan aplikacji + operacje na projekcie. Bez zależności od DOM (łatwo testować).

export const TRACKS = [
  { id: 'T1', kind: 'text', label: 'Tekst' },
  { id: 'V2', kind: 'video', label: 'Wideo 2' },
  { id: 'V1', kind: 'video', label: 'Wideo 1' },
  { id: 'A1', kind: 'audio', label: 'Audio 1' },
  { id: 'A2', kind: 'audio', label: 'Audio 2' },
];
export const ASPECTS = { '16:9': [16, 9], '9:16': [9, 16], '1:1': [1, 1], '4:3': [4, 3], '21:9': [21, 9] };

export const TEXT_FONT = 'Arial, "Liberation Sans", "Segoe UI", "DejaVu Sans", sans-serif';

/** Rozmiar kadru eksportu; shortSide = krótszy bok (720, 1080, 1440, 2160). Musi zgadzać się z src/main/exportGraph.js */
export function canvasSize(aspect, shortSide) {
  const [a, b] = ASPECTS[aspect] || ASPECTS['16:9'];
  const even = (v) => Math.max(2, Math.round(v / 2) * 2);
  return a >= b
    ? { w: even((shortSide * a) / b), h: even(shortSide) }
    : { w: even(shortSide), h: even((shortSide * b) / a) };
}

export const trackKind = (id) => (TRACKS.find((t) => t.id === id) || {}).kind;
export const kindForType = (type) => (type === 'text' ? 'text' : type === 'audio' ? 'audio' : 'video');
export const uid = () => Math.random().toString(36).slice(2, 9);
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export const VISUAL_DEFAULTS = { scale: 1, x: 0, y: 0, opacity: 1, brightness: 0, contrast: 1, saturation: 1, blur: 0, sepia: false };

export const newProject = () => ({ version: 1, settings: { aspect: '16:9', fps: 30 }, media: [], clips: [] });

export const state = {
  project: newProject(),
  selectedId: null,
  playhead: 0,
  playing: false,
  filePath: null,
  dirty: false,
};

// ---------------------------------------------------------------- zdarzenia
const listeners = new Set();
export const on = (fn) => (listeners.add(fn), () => listeners.delete(fn));
export const emit = (type, info) => listeners.forEach((f) => f(type, info));

// ---------------------------------------------------------------- pomocnicze
export const getClip = (id) => state.project.clips.find((c) => c.id === id);
export const getMedia = (id) => state.project.media.find((m) => m.id === id);
export const clipDur = (c) => (c.out - c.in) / (c.speed || 1);
export const clipEnd = (c) => c.start + clipDur(c);
export const projectDuration = () => state.project.clips.reduce((d, c) => Math.max(d, clipEnd(c)), 0);

export const fileUrl = (p) => {
  const u = encodeURI(p.replace(/\\/g, '/')).replace(/#/g, '%23').replace(/\?/g, '%3F');
  return u.startsWith('/') ? 'file://' + u : 'file:///' + u; // /home/x → file:///home/x, C:/x → file:///C:/x
};

export function fmtTime(t, prec = 1) {
  const k = 10 ** prec;
  t = Math.round(Math.max(0, t) * k) / k;
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(prec)}`;
}

// ---------------------------------------------------------------- historia
const undoStack = [];
const redoStack = [];
let editing = false;
const snap = () => JSON.stringify(state.project);

export function checkpoint() {
  undoStack.push(snap());
  if (undoStack.length > 100) undoStack.shift();
  redoStack.length = 0;
  state.dirty = true;
}
/** Gest (przeciąganie, suwak): jeden wpis w historii na całą interakcję. */
export function beginEdit() {
  if (!editing) { checkpoint(); editing = true; }
}
export function endEdit() { editing = false; }
export const canUndo = () => undoStack.length > 0;
export const canRedo = () => redoStack.length > 0;

function restore(json) {
  state.project = JSON.parse(json);
  if (state.selectedId && !getClip(state.selectedId)) state.selectedId = null;
  state.dirty = true;
  emit('select');
  emit('project');
}
export function undo() {
  if (!undoStack.length) return;
  redoStack.push(snap());
  restore(undoStack.pop());
}
export function redo() {
  if (!redoStack.length) return;
  undoStack.push(snap());
  restore(redoStack.pop());
}

// ---------------------------------------------------------------- projekt
export function setProject(p, filePath = null) {
  state.project = p;
  state.filePath = filePath;
  state.selectedId = null;
  state.playhead = 0;
  state.dirty = false;
  undoStack.length = 0;
  redoStack.length = 0;
  editing = false;
  emit('select');
  emit('project', { reset: true });
  emit('time');
}
export const markSaved = (filePath) => { state.filePath = filePath; state.dirty = false; emit('project', { src: 'meta' }); };

export function setSelected(id) {
  if (state.selectedId === id) return;
  state.selectedId = id;
  emit('select');
}

export function setSettings(patch) {
  checkpoint();
  Object.assign(state.project.settings, patch);
  emit('project', { src: 'settings' });
}

// ---------------------------------------------------------------- biblioteka mediów
export function addMedia(items) {
  const ids = [];
  for (const it of items) {
    let m = state.project.media.find((x) => x.path === it.path);
    if (!m) {
      m = { id: uid(), ...it };
      state.project.media.push(m);
      state.dirty = true;
    }
    ids.push(m.id);
  }
  emit('library');
  return ids;
}

export function removeMedia(id) {
  checkpoint();
  state.project.clips = state.project.clips.filter((c) => c.mediaId !== id);
  state.project.media = state.project.media.filter((m) => m.id !== id);
  if (state.selectedId && !getClip(state.selectedId)) state.selectedId = null;
  emit('library');
  emit('select');
  emit('project');
}

// ---------------------------------------------------------------- układanie klipów
/** Najbliższa wolna pozycja startu na torze (klipy na jednym torze nie mogą się nakładać). */
export function findFreeStart(trackId, desired, dur, ignoreId) {
  const others = state.project.clips.filter((c) => c.track === trackId && c.id !== ignoreId);
  const ok = (s) => s >= -1e-6 && others.every((o) => s + dur <= o.start + 1e-6 || s >= clipEnd(o) - 1e-6);
  desired = Math.max(0, desired);
  if (ok(desired)) return desired;
  const cands = [0, ...others.flatMap((o) => [clipEnd(o), o.start - dur])].filter(ok);
  return cands.length ? cands.reduce((b, c) => (Math.abs(c - desired) < Math.abs(b - desired) ? c : b)) : desired;
}

export function addClipFromMedia(mediaId, trackId, start) {
  const m = getMedia(mediaId);
  if (!m) return null;
  const type = m.kind; // 'video' | 'image' | 'audio'
  const wanted = kindForType(type);
  const track = trackKind(trackId) === wanted ? trackId : wanted === 'audio' ? 'A1' : 'V1';
  const d = type === 'image' ? 5 : m.duration;
  checkpoint();
  const clip = {
    id: uid(), track, type, mediaId,
    start: findFreeStart(track, start, d),
    in: 0, out: d, speed: 1, volume: 1, fadeIn: 0, fadeOut: 0,
    ...(type === 'audio' ? {} : VISUAL_DEFAULTS),
  };
  state.project.clips.push(clip);
  state.selectedId = clip.id;
  emit('select');
  emit('project');
  return clip;
}

export function addText(start) {
  checkpoint();
  const d = 3;
  const clip = {
    id: uid(), track: 'T1', type: 'text', mediaId: null,
    start: findFreeStart('T1', start, d),
    in: 0, out: d, speed: 1, volume: 1, fadeIn: 0.2, fadeOut: 0.2,
    text: 'Twój tekst', fontSize: 8, color: '#ffffff', bold: true, box: false, x: 0, y: 0,
  };
  state.project.clips.push(clip);
  state.selectedId = clip.id;
  emit('select');
  emit('project');
  return clip;
}

/** src: 'inspector' | 'timeline' – informuje widoki, czy mają się przerysować. */
export function updateClip(id, patch, src) {
  const c = getClip(id);
  if (!c) return;
  Object.assign(c, patch);
  if ('speed' in patch) c.start = findFreeStart(c.track, c.start, clipDur(c), c.id); // zmiana tempa zmienia długość
  if ('start' in patch) c.start = findFreeStart(c.track, Math.max(0, c.start), clipDur(c), c.id);
  state.dirty = true;
  emit('project', { src });
}

export function removeClip(id, ripple = false) {
  const c = getClip(id);
  if (!c) return;
  checkpoint();
  const d = clipDur(c), end = clipEnd(c);
  state.project.clips = state.project.clips.filter((x) => x.id !== id);
  if (ripple) {
    for (const o of state.project.clips) if (o.track === c.track && o.start >= end - 1e-6) o.start = Math.max(0, o.start - d);
  }
  if (state.selectedId === id) state.selectedId = null;
  emit('select');
  emit('project');
}

/** Dzieli zaznaczony klip (jeśli pod głowicą) albo wszystkie klipy pod głowicą. */
export function splitAtPlayhead() {
  const t = state.playhead;
  const hit = (c) => t > c.start + 0.05 && t < clipEnd(c) - 0.05;
  const sel = getClip(state.selectedId);
  const targets = sel && hit(sel) ? [sel] : state.project.clips.filter(hit);
  if (!targets.length) return false;
  checkpoint();
  let last = null;
  for (const c of targets) {
    const cut = c.in + (t - c.start) * (c.speed || 1);
    const b = { ...c, id: uid(), start: t, in: cut, fadeIn: 0 };
    c.out = cut;
    c.fadeOut = 0;
    state.project.clips.push(b);
    last = b;
  }
  state.selectedId = last.id;
  emit('select');
  emit('project');
  return true;
}
