'use strict';
/**
 * Katalog formatów eksportu. Czysty moduł (bez Electrona): używa go exportGraph.js,
 * proces główny (dialog zapisu) i – przez IPC – okno eksportu (lista formatów i widoczne pola).
 *
 * kind:
 *   av        – film (obraz + dźwięk)
 *   audio     – sam dźwięk
 *   still     – jedna klatka z pozycji głowicy
 *   sequence  – seria klatek co N sekund (plik_0001.png, plik_0002.png…)
 *   anim      – animacja bez dźwięku (GIF, WebP)
 *   slides    – prezentacja: klatki → PPTX / PDF (składane po renderze w main.js)
 * ui: pola widoczne w oknie eksportu: res, fps, quality, interval, slides
 * res: 'video' (720p–4K) albo 'small' (240p–720p, dla animacji)
 */

const Q = ['high', 'standard', 'small']; // poziomy jakości z okna eksportu

const GROUPS = [
  { id: 'video', label: 'Wideo' },
  { id: 'audio', label: 'Audio' },
  { id: 'image', label: 'Grafika' },
  { id: 'slides', label: 'Prezentacja' },
];

const pick = (q, values) => values[Math.max(0, Q.indexOf(q))] ?? values[1];

const FORMATS = {
  // ---------------------------------------------------------------- wideo
  mp4: {
    group: 'video', kind: 'av', label: 'MP4 – H.264 + AAC', ext: 'mp4', name: 'film',
    desc: 'Najbardziej uniwersalny: telefony, YouTube, komunikatory.',
    ui: ['res', 'fps', 'quality'], res: 'video', vfmt: 'yuv420p',
    codec: (q, o) => ['-c:v', 'libx264', '-preset', o.preset || 'medium', '-crf', String(o.crf ?? pick(q, [18, 21, 25])),
      '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart'],
  },
  'mp4-hevc': {
    group: 'video', kind: 'av', label: 'MP4 – H.265/HEVC + AAC', ext: 'mp4', name: 'film',
    desc: 'O ok. 40% mniejszy plik przy tej samej jakości; wolniejszy eksport, starsze urządzenia mogą go nie odtworzyć.',
    ui: ['res', 'fps', 'quality'], res: 'video', vfmt: 'yuv420p',
    codec: (q) => ['-c:v', 'libx265', '-preset', 'medium', '-crf', String(pick(q, [20, 24, 28])), '-x265-params', 'log-level=error',
      '-tag:v', 'hvc1', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart'],
  },
  webm: {
    group: 'video', kind: 'av', label: 'WebM – VP9 + Opus', ext: 'webm', name: 'film',
    desc: 'Otwarty format do stron WWW i przeglądarek.',
    ui: ['res', 'fps', 'quality'], res: 'video', vfmt: 'yuv420p',
    codec: (q) => ['-c:v', 'libvpx-vp9', '-crf', String(pick(q, [24, 31, 37])), '-b:v', '0', '-row-mt', '1',
      '-deadline', 'good', '-cpu-used', '4', '-pix_fmt', 'yuv420p', '-c:a', 'libopus', '-b:a', '160k', '-ar', '48000'],
  },
  mkv: {
    group: 'video', kind: 'av', label: 'MKV – H.264 + FLAC', ext: 'mkv', name: 'film',
    desc: 'Kontener Matroska z bezstratnym dźwiękiem; dobry do archiwum.',
    ui: ['res', 'fps', 'quality'], res: 'video', vfmt: 'yuv420p',
    codec: (q) => ['-c:v', 'libx264', '-preset', 'medium', '-crf', String(pick(q, [18, 21, 25])), '-pix_fmt', 'yuv420p',
      '-c:a', 'flac', '-ar', '48000'],
  },
  mov: {
    group: 'video', kind: 'av', label: 'MOV – Apple ProRes 422', ext: 'mov', name: 'film',
    desc: 'Format montażowy do dalszej obróbki (Premiere, DaVinci, Final Cut). Bardzo duże pliki.',
    ui: ['res', 'fps', 'quality'], res: 'video', vfmt: 'yuv422p10le',
    // profil 3 = 422 HQ, 2 = 422, 1 = 422 LT
    codec: (q) => ['-c:v', 'prores_ks', '-profile:v', String(pick(q, [3, 2, 1])), '-vendor', 'apl0', '-pix_fmt', 'yuv422p10le',
      '-c:a', 'pcm_s16le', '-ar', '48000'],
  },
  avi: {
    group: 'video', kind: 'av', label: 'AVI – MPEG-4 (Xvid) + MP3', ext: 'avi', name: 'film',
    desc: 'Dla starszych odtwarzaczy DVD/TV i starych programów.',
    ui: ['res', 'fps', 'quality'], res: 'video', vfmt: 'yuv420p',
    codec: (q) => ['-c:v', 'mpeg4', '-q:v', String(pick(q, [2, 4, 7])), '-tag:v', 'XVID', '-pix_fmt', 'yuv420p',
      '-c:a', 'libmp3lame', '-b:a', '192k', '-ar', '48000'],
  },

  // ---------------------------------------------------------------- audio
  mp3: {
    group: 'audio', kind: 'audio', label: 'MP3', ext: 'mp3', name: 'dzwiek',
    desc: 'Ścieżka dźwiękowa projektu (muzyka, lektor, dźwięk z klipów wideo).',
    ui: ['quality'], qualityLabels: ['Wysoka – 320 kb/s', 'Standardowa – 192 kb/s', 'Mała – 128 kb/s'],
    codec: (q) => ['-c:a', 'libmp3lame', '-b:a', pick(q, ['320k', '192k', '128k']), '-ar', '44100'],
  },
  m4a: {
    group: 'audio', kind: 'audio', label: 'M4A – AAC', ext: 'm4a', name: 'dzwiek',
    desc: 'Dobra jakość przy małym rozmiarze; iPhone, iTunes, większość odtwarzaczy.',
    ui: ['quality'], qualityLabels: ['Wysoka – 256 kb/s', 'Standardowa – 192 kb/s', 'Mała – 128 kb/s'],
    codec: (q) => ['-c:a', 'aac', '-b:a', pick(q, ['256k', '192k', '128k']), '-ar', '48000', '-movflags', '+faststart'],
  },
  ogg: {
    group: 'audio', kind: 'audio', label: 'OGG – Vorbis', ext: 'ogg', name: 'dzwiek',
    desc: 'Otwarty format; gry, Linux, Wikipedia.',
    ui: ['quality'], qualityLabels: ['Wysoka – ok. 256 kb/s', 'Standardowa – ok. 192 kb/s', 'Mała – ok. 128 kb/s'],
    codec: (q) => ['-c:a', 'libvorbis', '-q:a', String(pick(q, [8, 6, 4])), '-ar', '48000'],
  },
  opus: {
    group: 'audio', kind: 'audio', label: 'Opus', ext: 'opus', name: 'dzwiek',
    desc: 'Najlepsza jakość przy małym rozmiarze; przeglądarki, komunikatory.',
    ui: ['quality'], qualityLabels: ['Wysoka – 192 kb/s', 'Standardowa – 128 kb/s', 'Mała – 96 kb/s'],
    codec: (q) => ['-c:a', 'libopus', '-b:a', pick(q, ['192k', '128k', '96k']), '-ar', '48000'],
  },
  wav: {
    group: 'audio', kind: 'audio', label: 'WAV – bez kompresji', ext: 'wav', name: 'dzwiek',
    desc: 'PCM 16 bit / 48 kHz: do dalszej obróbki w programach audio. Duży plik.',
    ui: [], codec: () => ['-c:a', 'pcm_s16le', '-ar', '48000'],
  },
  flac: {
    group: 'audio', kind: 'audio', label: 'FLAC – bezstratny', ext: 'flac', name: 'dzwiek',
    desc: 'Jakość jak WAV, plik ok. dwa razy mniejszy.',
    ui: [], codec: () => ['-c:a', 'flac', '-compression_level', '8', '-ar', '48000'],
  },

  // ---------------------------------------------------------------- grafika
  png: {
    group: 'image', kind: 'still', label: 'PNG – klatka z głowicy', ext: 'png', name: 'kadr',
    desc: 'Bezstratny obraz klatki w miejscu głowicy.', ui: ['res'], res: 'video', vfmt: 'rgb24',
    codec: () => ['-c:v', 'png'],
  },
  jpg: {
    group: 'image', kind: 'still', label: 'JPG – klatka z głowicy', ext: 'jpg', name: 'kadr',
    desc: 'Mniejszy plik, do zdjęć i miniatur.', ui: ['res', 'quality'], res: 'video', vfmt: 'yuvj444p',
    codec: (q) => ['-c:v', 'mjpeg', '-q:v', String(pick(q, [2, 4, 7]))],
  },
  webp: {
    group: 'image', kind: 'still', label: 'WebP – klatka z głowicy', ext: 'webp', name: 'kadr',
    desc: 'Nowoczesny format do stron WWW.', ui: ['res', 'quality'], res: 'video', vfmt: 'yuv420p',
    codec: (q) => ['-c:v', 'libwebp', '-quality', String(pick(q, [92, 80, 65]))],
  },
  'png-seq': {
    group: 'image', kind: 'sequence', label: 'Seria klatek PNG', ext: 'png', name: 'kadry',
    desc: 'Klatka co wybraną liczbę sekund; pliki nazwa_0001.png, nazwa_0002.png…', ui: ['res', 'interval'], res: 'video', vfmt: 'rgb24',
    codec: () => ['-c:v', 'png'],
  },
  'jpg-seq': {
    group: 'image', kind: 'sequence', label: 'Seria klatek JPG', ext: 'jpg', name: 'kadry',
    desc: 'Klatka co wybraną liczbę sekund; pliki nazwa_0001.jpg, nazwa_0002.jpg…', ui: ['res', 'quality', 'interval'], res: 'video', vfmt: 'yuvj444p',
    codec: (q) => ['-c:v', 'mjpeg', '-q:v', String(pick(q, [2, 4, 7]))],
  },
  gif: {
    group: 'image', kind: 'anim', label: 'GIF animowany', ext: 'gif', name: 'animacja',
    desc: 'Krótka animacja bez dźwięku (memy, czaty). Przy długich projektach plik szybko rośnie.',
    ui: ['res', 'fps'], res: 'small', fpsList: [10, 12, 15, 20], fpsDefault: 15,
    codec: () => ['-loop', '0'],
  },
  'webp-anim': {
    group: 'image', kind: 'anim', label: 'WebP animowany', ext: 'webp', name: 'animacja',
    desc: 'Jak GIF, ale pełne kolory i zwykle kilka razy mniejszy plik.',
    ui: ['res', 'fps', 'quality'], res: 'small', fpsList: [10, 12, 15, 20, 24], fpsDefault: 15, vfmt: 'yuv420p',
    codec: (q) => ['-c:v', 'libwebp_anim', '-loop', '0', '-quality', String(pick(q, [85, 70, 55])), '-compression_level', '4'],
  },

  // ---------------------------------------------------------------- prezentacja
  pptx: {
    group: 'slides', kind: 'slides', label: 'PowerPoint (PPTX)', ext: 'pptx', name: 'prezentacja',
    desc: 'Każdy slajd to kadr z filmu; napisy z toru Tekst trafiają do notatek prelegenta. Otworzysz w PowerPoincie, Keynote, Google Slides i LibreOffice.',
    ui: ['res', 'slides', 'interval'], res: 'video',
  },
  pdf: {
    group: 'slides', kind: 'slides', label: 'PDF – pokaz slajdów', ext: 'pdf', name: 'prezentacja',
    desc: 'Kadry jako strony PDF w proporcjach projektu: do wysłania, wydruku lub pokazu w trybie pełnoekranowym.',
    ui: ['res', 'slides', 'interval'], res: 'video',
  },
};

const RES = {
  video: [
    { v: 720, label: 'HD – 720p' }, { v: 1080, label: 'Full HD – 1080p', def: true },
    { v: 1440, label: 'QHD – 1440p' }, { v: 2160, label: '4K – 2160p' },
  ],
  small: [
    { v: 240, label: '240p' }, { v: 360, label: '360p' }, { v: 480, label: '480p', def: true }, { v: 720, label: '720p' },
  ],
};

/** Wersja bez funkcji – do przesłania przez IPC do okna eksportu. */
function publicCatalog() {
  return {
    groups: GROUPS,
    resolutions: RES,
    formats: Object.entries(FORMATS).map(([id, f]) => ({
      id, group: f.group, kind: f.kind, label: f.label, ext: f.ext, desc: f.desc, ui: f.ui, res: f.res || null,
      fpsList: f.fpsList || null, fpsDefault: f.fpsDefault || null, qualityLabels: f.qualityLabels || null,
    })),
  };
}

module.exports = { FORMATS, GROUPS, RES, publicCatalog };
