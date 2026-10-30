import {
  state, on, newProject, setProject, markSaved, addMedia, removeMedia, addClipFromMedia, addText, removeClip,
  splitAtPlayhead, undo, redo, canUndo, canRedo, projectDuration, fmtTime, setSelected, fileUrl, kindForType, canvasSize,
} from './store.js';
import { $, $$, h, toast } from './dom.js';
import * as preview from './preview.js';
import * as timeline from './timeline.js';
import * as inspector from './inspector.js';
import { rasterizeText } from './textRaster.js';

const api = window.kadr;

// ---------------------------------------------------------------- biblioteka
async function importPaths(paths) {
  if (!paths || !paths.length) return;
  toast('Importowanie…');
  const { items, errors } = await api.importMedia(paths);
  if (items.length) { addMedia(items); toast(`Zaimportowano: ${items.length}`); }
  if (errors.length) toast(`Nie można odczytać: ${errors.map((e) => e.path.split(/[\\/]/).pop()).join(', ')}`, 'error');
}

function renderLibrary() {
  const list = $('#lib');
  list.textContent = '';
  $('.library').classList.toggle('is-empty', state.project.media.length === 0);
  for (const m of state.project.media) {
    const item = h('div', 'lib-item');
    item.draggable = true;
    item.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/kadr-media', m.id);
      e.dataTransfer.effectAllowed = 'copy';
    });
    item.addEventListener('dblclick', () => {
      const track = kindForType(m.kind) === 'audio' ? 'A1' : 'V1';
      addClipFromMedia(m.id, track, state.playhead);
    });
    const th = h('div', 'lib-thumb' + (m.kind === 'audio' ? ' audio' : ''));
    if (m.thumb) th.style.backgroundImage = `url("${fileUrl(m.thumb)}")`;
    else th.textContent = m.kind === 'audio' ? '♪' : '▣';
    const meta = h('div');
    meta.append(
      h('div', 'lib-name', m.name),
      h('div', 'lib-meta', `${{ video: 'Wideo', audio: 'Audio', image: 'Obraz' }[m.kind]} · ${m.kind === 'image' ? m.width + '×' + m.height : fmtTime(m.duration, 1)}`)
    );
    const rm = h('button', 'remove', '×');
    rm.title = 'Usuń z projektu';
    rm.addEventListener('click', (e) => {
      e.stopPropagation();
      const used = state.project.clips.some((c) => c.mediaId === m.id);
      if (!used || confirm(`„${m.name}” jest użyty na osi czasu. Usunąć plik razem z jego klipami?`)) removeMedia(m.id);
    });
    item.append(th, meta, rm);
    list.appendChild(item);
  }
}
$('#btn-import').onclick = async () => importPaths(await api.pickMedia());
$('#btn-add-text').onclick = () => addText(state.playhead);

// przeciąganie plików z Eksploratora
window.addEventListener('dragover', (e) => {
  if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); document.body.classList.add('drag-over'); }
});
window.addEventListener('dragleave', (e) => { if (!e.relatedTarget) document.body.classList.remove('drag-over'); });
window.addEventListener('drop', (e) => {
  document.body.classList.remove('drag-over');
  if (!e.dataTransfer.files.length) return;
  e.preventDefault();
  importPaths([...e.dataTransfer.files].map((f) => api.pathForFile(f)).filter(Boolean));
});

// ---------------------------------------------------------------- projekt
const confirmDiscard = () => !state.dirty || confirm('Masz niezapisane zmiany. Kontynuować bez zapisywania?');

async function save(saveAs = false) {
  const p = await api.saveProject(state.project, state.filePath, saveAs);
  if (p) { markSaved(p); toast('Projekt zapisany'); }
}
$('#btn-new').onclick = () => { if (confirmDiscard()) { preview.pause(); setProject(newProject()); } };
$('#btn-open').onclick = async () => {
  if (!confirmDiscard()) return;
  const r = await api.openProject();
  if (!r) return;
  preview.pause();
  setProject(r.data, r.path);
  if (r.missing.length) toast(`Brak plików źródłowych: ${r.missing.join(', ')}`, 'error');
};
$('#btn-save').onclick = () => save(false);

$('#btn-undo').onclick = undo;
$('#btn-redo').onclick = redo;

// ---------------------------------------------------------------- transport / edycja
$('#btn-play').onclick = preview.toggle;
$('#btn-start').onclick = () => preview.seek(0);
$('#btn-end').onclick = () => preview.seek(projectDuration());
$('#btn-split').onclick = () => { if (!splitAtPlayhead()) toast('Ustaw głowicę nad klipem, który chcesz podzielić'); };
$('#btn-delete').onclick = () => state.selectedId && removeClip(state.selectedId);
$('#btn-ripple').onclick = () => state.selectedId && removeClip(state.selectedId, true);
$('#btn-fit').onclick = timeline.zoomFit;

// ---------------------------------------------------------------- skróty klawiszowe
document.addEventListener('keydown', (e) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) && e.target.type !== 'range' && e.target.type !== 'checkbox';
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();

  if (mod && k === 's') { e.preventDefault(); save(e.shiftKey); return; }
  if (mod && k === 'o') { e.preventDefault(); $('#btn-open').click(); return; }
  if (mod && k === 'e') { e.preventDefault(); openExport(); return; }
  if (typing) return;
  if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && k === 'y') { e.preventDefault(); redo(); return; }
  if (mod && (k === '=' || k === '+')) { e.preventDefault(); timeline.zoomBy(1.25); return; }
  if (mod && k === '-') { e.preventDefault(); timeline.zoomBy(0.8); return; }
  if (mod) return;

  const frame = 1 / (state.project.settings.fps || 30);
  switch (e.key) {
    case ' ': e.preventDefault(); preview.toggle(); break;
    case 's': case 'S': splitAtPlayhead(); break;
    case 't': case 'T': addText(state.playhead); break;
    case 'Delete': case 'Backspace': if (state.selectedId) { e.preventDefault(); removeClip(state.selectedId, e.shiftKey); } break;
    case 'Home': preview.seek(0); break;
    case 'End': preview.seek(projectDuration()); break;
    case 'ArrowLeft': e.preventDefault(); preview.seek(state.playhead - (e.shiftKey ? 1 : frame)); break;
    case 'ArrowRight': e.preventDefault(); preview.seek(state.playhead + (e.shiftKey ? 1 : frame)); break;
    case 'Escape': setSelected(null); break;
    default: break;
  }
});
document.addEventListener('click', (e) => { if (e.target.tagName === 'BUTTON') e.target.blur(); });

// ---------------------------------------------------------------- eksport
const dlg = $('#export-dlg');
let exporting = false;

function exportUI(mode, msg) {
  $('#ex-form').hidden = mode !== 'idle';
  $('#ex-run').hidden = mode !== 'running';
  $('#ex-start').hidden = mode !== 'idle' && mode !== 'error';
  $('#ex-cancel').hidden = mode !== 'running';
  $('#ex-reveal').hidden = mode !== 'done';
  $('#ex-close').hidden = mode === 'running';
  const err = $('#ex-error');
  err.hidden = mode !== 'error';
  if (mode === 'error') err.textContent = msg;
  if (mode === 'done') { $('#ex-run').hidden = false; $('#ex-status').textContent = 'Gotowe: ' + msg; $('#ex-bar').value = 1; }
  if (mode === 'error') $('#ex-form').hidden = false;
}

dlg.addEventListener('cancel', (e) => { if (exporting) e.preventDefault(); }); // Esc nie zamyka dialogu w trakcie eksportu

function openExport() {
  if (exporting) { exportUI('running'); if (!dlg.open) dlg.showModal(); return; }
  if (projectDuration() <= 0) { toast('Dodaj klipy na oś czasu przed eksportem'); return; }
  preview.pause();
  $('#ex-fps').value = String(state.project.settings.fps);
  $('#ex-info').textContent = `Format ${state.project.settings.aspect}, długość ${fmtTime(projectDuration(), 1)}. Plik zapisze się jako MP4 (H.264 + AAC).`;
  exportUI('idle');
  if (!dlg.open) dlg.showModal();
}
$('#btn-export').onclick = openExport;
$('#ex-close').onclick = () => dlg.close();
$('#ex-cancel').onclick = () => api.cancelExport();

let lastOut = null;
$('#ex-start').onclick = async () => {
  const settings = {
    aspect: state.project.settings.aspect,
    fps: +$('#ex-fps').value,
    shortSide: +$('#ex-res').value,
    crf: +$('#ex-q').value,
    preset: 'medium',
  };
  // napisy → PNG w rozdzielczości eksportu (FFmpeg tylko je nakłada)
  const { h: H } = canvasSize(settings.aspect, settings.shortSide);
  const textImages = {};
  for (const c of state.project.clips) if (c.type === 'text' && String(c.text || '').trim()) textImages[c.id] = rasterizeText(c, H);
  const r = await api.startExport({ project: JSON.parse(JSON.stringify(state.project)), settings, textImages });
  if (r.canceled) return;
  if (r.error) { exportUI('error', r.error); return; }
  exporting = true;
  $('#ex-bar').value = 0;
  $('#ex-status').textContent = 'Renderowanie… 0%';
  exportUI('running');
};
$('#ex-reveal').onclick = () => lastOut && api.reveal(lastOut);

api.onExportProgress(({ pct }) => {
  $('#ex-bar').value = pct;
  $('#ex-status').textContent = `Renderowanie… ${Math.round(pct * 100)}%`;
});
api.onExportDone((d) => {
  exporting = false;
  if (d.ok) { lastOut = d.path; exportUI('done', d.path); toast('Eksport zakończony'); }
  else if (d.canceled) { exportUI('idle'); toast('Eksport przerwany'); }
  else exportUI('error', d.error);
});

// ---------------------------------------------------------------- odświeżanie widoków
let lastAspect = null;
let libSig = '';
function refreshChrome() {
  $('#btn-undo').disabled = !canUndo();
  $('#btn-redo').disabled = !canRedo();
  const name = state.filePath ? state.filePath.split(/[\\/]/).pop() : 'Nowy projekt';
  $('#project-name').textContent = name + (state.dirty ? ' •' : '');
  document.title = `${name}${state.dirty ? ' •' : ''} – Kadr Studio`;
  $('#time-total').textContent = fmtTime(projectDuration(), 1);
}
function refreshTime() {
  $('#time-now').textContent = fmtTime(state.playhead, 1);
}

on((type, info) => {
  if (type === 'project') {
    if (state.playhead > projectDuration() + 0.001 && !state.playing) state.playhead = projectDuration();
    if (state.project.settings.aspect !== lastAspect) { lastAspect = state.project.settings.aspect; preview.fit(); }
    else preview.render();
    const sig = state.project.media.map((m) => m.id).join(',');
    if (sig !== libSig) { libSig = sig; renderLibrary(); }
    refreshChrome();
    refreshTime();
  } else if (type === 'library') {
    libSig = state.project.media.map((m) => m.id).join(',');
    renderLibrary();
    refreshChrome();
  } else if (type === 'time') {
    refreshTime();
  } else if (type === 'transport') {
    $('#btn-play').textContent = state.playing ? '❚❚' : '▶';
  }
});

// start
lastAspect = state.project.settings.aspect;
preview.fit();
timeline.setZoom(80);
timeline.render();
inspector.render();
renderLibrary();
refreshChrome();
refreshTime();
