'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const { buildExportArgs, canvasSize } = require('./exportGraph');

// Binarki w spakowanej aplikacji leżą w app.asar.unpacked (patrz "asarUnpack" w package.json)
const unpack = (p) => p.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
const FFMPEG = process.env.FFMPEG_PATH || unpack(require('ffmpeg-static'));
const FFPROBE = process.env.FFPROBE_PATH || unpack(require('ffprobe-static').path);

const IMG_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif']);
const MEDIA_EXT = [
  'mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v', 'wmv', 'mts', 'm2ts', 'flv',
  'mp3', 'wav', 'aac', 'm4a', 'ogg', 'flac', 'wma',
  'jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif',
];

// Uwaga: flagi --no-sandbox nie da się ustawić stąd (Chromium sprawdza piaskownicę wcześniej).
// Na Linuksie robi to skrypt startowy build/linux/launcher.sh.

let win = null;
let ff = null; // aktywny proces eksportu
let ffCancelled = false;

function createWindow() {
  win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#121316',
    title: 'Kadr Studio',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  if (!app.isPackaged) {
    win.webContents.on('before-input-event', (_e, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') win.webContents.toggleDevTools();
    });
  }
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});
app.on('window-all-closed', () => {
  if (ff) ff.kill();
  app.quit();
});

// ---------------------------------------------------------------- narzędzia
const run = (bin, args) =>
  new Promise((resolve, reject) =>
    execFile(bin, args, { maxBuffer: 32 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) =>
      err ? reject(new Error(String(stderr || err.message).slice(-600))) : resolve(stdout)
    )
  );

async function probe(file) {
  const j = JSON.parse(await run(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]));
  const streams = j.streams || [];
  const v = streams.find((s) => s.codec_type === 'video' && !(s.disposition && s.disposition.attached_pic));
  const a = streams.find((s) => s.codec_type === 'audio');
  const isImage = IMG_EXT.has(path.extname(file).toLowerCase());
  const kind = isImage ? 'image' : v ? 'video' : a ? 'audio' : null;
  if (!kind) throw new Error('Nieobsługiwany format pliku');
  let fps = 0;
  if (v && v.r_frame_rate) {
    const [x, y] = v.r_frame_rate.split('/').map(Number);
    fps = y ? x / y : x;
  }
  return {
    path: file,
    name: path.basename(file),
    kind,
    duration: kind === 'image' ? 5 : parseFloat(j.format.duration) || parseFloat(v && v.duration) || 0,
    width: v ? v.width : 0,
    height: v ? v.height : 0,
    fps,
    hasAudio: kind !== 'image' && !!a,
  };
}

async function makeThumb(info) {
  if (info.kind === 'image') return info.path;
  if (info.kind !== 'video') return null;
  try {
    const dir = path.join(app.getPath('temp'), 'kadr-thumbs');
    fs.mkdirSync(dir, { recursive: true });
    const out = path.join(dir, crypto.createHash('md5').update(info.path).digest('hex') + '.jpg');
    if (!fs.existsSync(out)) {
      await run(FFMPEG, ['-v', 'error', '-ss', String(Math.min(1, info.duration / 2)), '-i', info.path, '-frames:v', '1', '-vf', 'scale=240:-2', '-y', out]);
    }
    return out;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- IPC: media
ipcMain.handle('media:pick', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Importuj pliki',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Wideo, audio i obrazy', extensions: MEDIA_EXT },
      { name: 'Wszystkie pliki', extensions: ['*'] },
    ],
  });
  return r.canceled ? [] : r.filePaths;
});

ipcMain.handle('media:import', async (_e, paths) => {
  const items = [];
  const errors = [];
  for (const p of paths) {
    try {
      const info = await probe(p);
      info.thumb = await makeThumb(info);
      items.push(info);
    } catch (err) {
      errors.push({ path: p, error: err.message });
    }
  }
  return { items, errors };
});

// ---------------------------------------------------------------- IPC: projekt
ipcMain.handle('project:save', async (_e, { data, path: p, saveAs }) => {
  let target = p;
  if (!target || saveAs) {
    const r = await dialog.showSaveDialog(win, {
      title: 'Zapisz projekt',
      defaultPath: 'projekt.kadr',
      filters: [{ name: 'Projekt Kadr', extensions: ['kadr'] }],
    });
    if (r.canceled) return null;
    target = r.filePath;
  }
  fs.writeFileSync(target, JSON.stringify(data, null, 1), 'utf8');
  return target;
});

ipcMain.handle('project:open', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Otwórz projekt',
    properties: ['openFile'],
    filters: [{ name: 'Projekt Kadr', extensions: ['kadr'] }],
  });
  if (r.canceled) return null;
  const file = r.filePaths[0];
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const missing = (data.media || []).filter((m) => !fs.existsSync(m.path)).map((m) => m.name);
  return { path: file, data, missing };
});

ipcMain.handle('shell:reveal', (_e, p) => shell.showItemInFolder(p));

// ---------------------------------------------------------------- IPC: eksport
const send = (ch, data) => win && !win.isDestroyed() && win.webContents.send(ch, data);

ipcMain.handle('export:start', async (_e, { project, settings, textImages }) => {
  if (ff) return { error: 'Eksport już trwa.' };
  const r = await dialog.showSaveDialog(win, {
    title: 'Eksportuj wideo',
    defaultPath: 'film.mp4',
    filters: [{ name: 'Wideo MP4', extensions: ['mp4'] }],
  });
  if (r.canceled) return { canceled: true };

  const { w, h } = canvasSize(settings.aspect, settings.shortSide);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kadr-'));
  let built;
  try {
    const textPaths = {};
    for (const [id, b64] of Object.entries(textImages || {})) {
      const f = path.join(tmpDir, `text_${id.replace(/[^\w-]/g, '')}.png`);
      fs.writeFileSync(f, Buffer.from(b64, 'base64'));
      textPaths[id] = f;
    }
    built = buildExportArgs(project, {
      width: w, height: h, fps: settings.fps, crf: settings.crf, preset: settings.preset,
      outPath: r.filePath, tmpDir, textImages: textPaths,
    });
    for (const f of built.files) fs.writeFileSync(f.path, f.content, 'utf8');
  } catch (err) {
    return { error: err.message };
  }

  ffCancelled = false;
  let errBuf = '';
  let outBuf = '';
  const cleanup = () => fs.rm(tmpDir, { recursive: true, force: true }, () => {});

  ff = spawn(FFMPEG, built.args, { windowsHide: true });
  ff.stdout.on('data', (d) => {
    outBuf += d;
    const lines = outBuf.split(/\r?\n/);
    outBuf = lines.pop();
    for (const line of lines) {
      const m = line.match(/^out_time_(?:us|ms)=(\d+)/); // w obu przypadkach to mikrosekundy
      if (m) send('export:progress', { pct: Math.min(1, parseInt(m[1], 10) / 1e6 / built.duration) });
    }
  });
  ff.stderr.on('data', (d) => { errBuf = (errBuf + d).slice(-3000); });
  ff.on('error', (err) => {
    ff = null; cleanup();
    send('export:done', { ok: false, error: 'Nie można uruchomić FFmpeg: ' + err.message });
  });
  ff.on('close', (code) => {
    const cancelled = ffCancelled;
    ff = null; cleanup();
    if (cancelled) {
      fs.rm(r.filePath, { force: true }, () => {});
      send('export:done', { canceled: true });
    } else if (code === 0) {
      send('export:done', { ok: true, path: r.filePath });
    } else {
      send('export:done', { ok: false, error: errBuf.trim() || `FFmpeg zakończył się kodem ${code}` });
    }
  });
  return { started: true, duration: built.duration, width: w, height: h };
});

ipcMain.handle('export:cancel', () => {
  if (ff) { ffCancelled = true; ff.kill(); }
});
