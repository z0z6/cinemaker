import {
  state, on, getClip, getMedia, updateClip, beginEdit, endEdit, checkpoint, removeClip, splitAtPlayhead,
  setSettings, clipDur, fmtTime, ASPECTS,
} from './store.js';
import { $, h } from './dom.js';

const root = $('#inspector');

const PRESETS = [
  { name: 'Oryginał', v: { brightness: 0, contrast: 1, saturation: 1, blur: 0, sepia: false } },
  { name: 'Czarno-białe', v: { brightness: 0, contrast: 1.1, saturation: 0, blur: 0, sepia: false } },
  { name: 'Sepia', v: { brightness: 0, contrast: 1, saturation: 1, blur: 0, sepia: true } },
  { name: 'Żywe', v: { brightness: 0.02, contrast: 1.12, saturation: 1.5, blur: 0, sepia: false } },
  { name: 'Matowe', v: { brightness: 0.05, contrast: 0.88, saturation: 0.8, blur: 0, sepia: false } },
  { name: 'Dramatyczne', v: { brightness: -0.05, contrast: 1.3, saturation: 0.75, blur: 0, sepia: false } },
];

function section(title) {
  const s = h('section', 'sec');
  s.appendChild(h('h3', null, title));
  root.appendChild(s);
  return s;
}

/** o: { key, label, type: range|number|color|check|text, min, max, step, scale, dec, unit } */
function field(parent, c, o) {
  const wrap = h('div', 'field' + (o.type === 'text' ? ' col' : ''));
  const label = h('label', null, o.label);
  wrap.appendChild(label);
  const scale = o.scale || 1;
  const show = (v) => (+(v * scale).toFixed(o.dec ?? 0)) + (o.unit || '');

  if (o.type === 'range') {
    const input = h('input');
    Object.assign(input, { type: 'range', min: o.min, max: o.max, step: o.step, value: c[o.key] * scale });
    const out = h('output', null, show(c[o.key]));
    input.addEventListener('input', () => {
      const v = parseFloat(input.value) / scale;
      beginEdit();
      updateClip(c.id, { [o.key]: v }, 'inspector');
      out.textContent = show(v);
      durLabel();
    });
    input.addEventListener('change', endEdit);
    input.addEventListener('dblclick', () => { // dwuklik = wartość domyślna
      if (o.def === undefined) return;
      checkpoint();
      updateClip(c.id, { [o.key]: o.def }, 'inspector');
      render();
    });
    wrap.append(input, out);
  } else if (o.type === 'number') {
    const input = h('input');
    Object.assign(input, { type: 'number', min: o.min, max: o.max, step: o.step, value: +c[o.key].toFixed(2) });
    input.addEventListener('change', () => {
      const v = parseFloat(input.value);
      if (Number.isNaN(v)) return;
      checkpoint();
      updateClip(c.id, { [o.key]: v }, 'inspector');
      render();
    });
    wrap.append(input);
  } else if (o.type === 'color') {
    const input = h('input');
    Object.assign(input, { type: 'color', value: c[o.key] });
    input.addEventListener('input', () => { beginEdit(); updateClip(c.id, { [o.key]: input.value }, 'inspector'); });
    input.addEventListener('change', endEdit);
    wrap.append(input);
  } else if (o.type === 'check') {
    const input = h('input');
    Object.assign(input, { type: 'checkbox', checked: !!c[o.key] });
    input.addEventListener('change', () => { checkpoint(); updateClip(c.id, { [o.key]: input.checked }, 'inspector'); });
    wrap.append(input);
  } else if (o.type === 'text') {
    const input = h('textarea');
    input.rows = 3;
    input.value = c[o.key];
    input.addEventListener('input', () => { beginEdit(); updateClip(c.id, { [o.key]: input.value }, 'inspector'); });
    input.addEventListener('change', endEdit);
    wrap.append(input);
  }
  parent.appendChild(wrap);
}

let durOut = null;
function durLabel() {
  const c = getClip(state.selectedId);
  if (durOut && c) durOut.textContent = fmtTime(clipDur(c), 2);
}

function clipPanel(c) {
  const m = getMedia(c.mediaId);
  const head = h('div', 'insp-head');
  head.appendChild(h('strong', null, c.type === 'text' ? 'Tekst' : m ? m.name : 'Klip'));
  const dur = h('span', 'mono');
  durOut = dur;
  durLabel();
  head.appendChild(dur);
  root.appendChild(head);

  const acts = h('div', 'row-actions');
  const split = h('button', null, 'Podziel');
  split.title = 'Podziel w miejscu głowicy (S)';
  split.onclick = splitAtPlayhead;
  const del = h('button', 'danger', 'Usuń');
  del.title = 'Usuń (Delete)';
  del.onclick = () => removeClip(c.id);
  acts.append(split, del);
  root.appendChild(acts);

  const time = section('Czas');
  field(time, c, { key: 'start', label: 'Początek (s)', type: 'number', min: 0, step: 0.1 });
  if (c.type === 'video' || c.type === 'audio') field(time, c, { key: 'speed', label: 'Tempo', type: 'range', min: 25, max: 400, step: 5, scale: 100, unit: '%', def: 1 });
  field(time, c, { key: 'fadeIn', label: 'Wejście', type: 'range', min: 0, max: 5, step: 0.1, dec: 1, unit: ' s', def: 0 });
  field(time, c, { key: 'fadeOut', label: 'Wyjście', type: 'range', min: 0, max: 5, step: 0.1, dec: 1, unit: ' s', def: 0 });

  if (c.type === 'text') {
    const s = section('Tekst');
    field(s, c, { key: 'text', label: 'Treść', type: 'text' });
    field(s, c, { key: 'fontSize', label: 'Rozmiar', type: 'range', min: 2, max: 30, step: 0.5, dec: 1, unit: '%', def: 8 });
    field(s, c, { key: 'color', label: 'Kolor', type: 'color' });
    field(s, c, { key: 'bold', label: 'Pogrubienie', type: 'check' });
    field(s, c, { key: 'box', label: 'Tło pod tekstem', type: 'check' });
  }

  if (c.type !== 'audio') {
    const s = section('Położenie');
    if (c.type !== 'text') field(s, c, { key: 'scale', label: 'Skala', type: 'range', min: 10, max: 300, step: 1, scale: 100, unit: '%', def: 1 });
    field(s, c, { key: 'x', label: 'Poziomo', type: 'range', min: -100, max: 100, step: 1, unit: '%', def: 0 });
    field(s, c, { key: 'y', label: 'Pionowo', type: 'range', min: -100, max: 100, step: 1, unit: '%', def: 0 });
    if (c.type !== 'text') field(s, c, { key: 'opacity', label: 'Krycie', type: 'range', min: 0, max: 100, step: 1, scale: 100, unit: '%', def: 1 });
  }

  if (c.type === 'video' || c.type === 'audio') {
    const s = section('Dźwięk');
    field(s, c, { key: 'volume', label: 'Głośność', type: 'range', min: 0, max: 200, step: 1, scale: 100, unit: '%', def: 1 });
    if (c.volume > 1) s.appendChild(h('p', 'hint', 'Podgląd gra maksymalnie 100%; powyżej wzmocnienie słychać dopiero po eksporcie.'));
  }

  if (c.type === 'video' || c.type === 'image') {
    const s = section('Kolor i filtry');
    const presets = h('div', 'chips');
    for (const p of PRESETS) {
      const b = h('button', 'chip', p.name);
      b.onclick = () => { checkpoint(); updateClip(c.id, p.v, 'inspector'); render(); };
      presets.appendChild(b);
    }
    s.appendChild(presets);
    field(s, c, { key: 'brightness', label: 'Jasność', type: 'range', min: -50, max: 50, step: 1, scale: 100, def: 0 });
    field(s, c, { key: 'contrast', label: 'Kontrast', type: 'range', min: 50, max: 150, step: 1, scale: 100, unit: '%', def: 1 });
    field(s, c, { key: 'saturation', label: 'Nasycenie', type: 'range', min: 0, max: 200, step: 1, scale: 100, unit: '%', def: 1 });
    field(s, c, { key: 'blur', label: 'Rozmycie', type: 'range', min: 0, max: 20, step: 0.5, dec: 1, def: 0 });
    field(s, c, { key: 'sepia', label: 'Sepia', type: 'check' });
    s.appendChild(h('p', 'hint', 'Dwuklik na suwaku przywraca wartość domyślną.'));
  }
}

function projectPanel() {
  durOut = null;
  const s = section('Projekt');
  const aspect = h('div', 'field');
  aspect.appendChild(h('label', null, 'Format kadru'));
  const sel = h('select');
  for (const k of Object.keys(ASPECTS)) {
    const o = h('option', null, k === '9:16' ? '9:16 (pionowe)' : k === '1:1' ? '1:1 (kwadrat)' : k);
    o.value = k;
    sel.appendChild(o);
  }
  sel.value = state.project.settings.aspect;
  sel.onchange = () => setSettings({ aspect: sel.value });
  aspect.appendChild(sel);
  s.appendChild(aspect);

  const fps = h('div', 'field');
  fps.appendChild(h('label', null, 'Klatki na sekundę'));
  const fsel = h('select');
  for (const v of [24, 25, 30, 50, 60]) { const o = h('option', null, String(v)); o.value = v; fsel.appendChild(o); }
  fsel.value = state.project.settings.fps;
  fsel.onchange = () => setSettings({ fps: +fsel.value });
  fps.appendChild(fsel);
  s.appendChild(fps);

  const empty = h('div', 'empty');
  empty.append(
    h('p', null, 'Zaznacz klip na osi czasu, aby edytować jego tempo, położenie, dźwięk i filtry.'),
    h('p', 'hint', 'Przeciągnij pliki z biblioteki na tory. Klawisz S dzieli klip w miejscu głowicy.')
  );
  root.appendChild(empty);
}

export function render() {
  root.textContent = '';
  durOut = null;
  const c = getClip(state.selectedId);
  if (c) clipPanel(c); else projectPanel();
}

on((type, info) => {
  if (type === 'select') render();
  else if (type === 'project') {
    if (info && info.src === 'inspector') { durLabel(); return; }
    render();
  }
});
