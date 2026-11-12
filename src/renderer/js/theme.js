// Motywy kolorystyczne interfejsu. Kolory są zdefiniowane w styles.css (:root[data-theme="…"]),
// tu tylko wybór, zapamiętanie (localStorage) i tryb „Systemowy”, który podąża za ustawieniem systemu.

export const THEMES = [
  { id: 'system', label: 'Systemowy' },
  { id: 'grafit', label: 'Grafit' },
  { id: 'jasny', label: 'Jasny' },
  { id: 'polnoc', label: 'Północ' },
  { id: 'bursztyn', label: 'Bursztyn' },
  { id: 'las', label: 'Las' },
  { id: 'kontrast', label: 'Wysoki kontrast' },
];

const KEY = 'kadr.theme';
const lightMq = window.matchMedia('(prefers-color-scheme: light)');
const stored = () => { try { return localStorage.getItem(KEY) || 'system'; } catch { return 'system'; } };
const resolve = (id) => (id === 'system' ? (lightMq.matches ? 'jasny' : 'grafit') : id);

function toHex(color) {
  const m = color.match(/\d+(\.\d+)?/g);
  if (!m || m.length < 3) return null;
  return '#' + m.slice(0, 3).map((v) => Math.round(+v).toString(16).padStart(2, '0')).join('');
}

export function applyTheme(id) {
  if (!THEMES.some((t) => t.id === id)) id = 'system';
  document.documentElement.dataset.theme = resolve(id);
  try { localStorage.setItem(KEY, id); } catch { /* tryb prywatny itp. */ }
  // tło natywnego okna (widoczne przy starcie i zmianie rozmiaru) w kolorze motywu
  const bg = toHex(getComputedStyle(document.body).backgroundColor);
  if (bg && window.kadr && window.kadr.setTheme) window.kadr.setTheme(id, bg);
}

/** Wypełnia <select> motywów i podpina zmiany. */
export function initThemePicker(select) {
  for (const t of THEMES) {
    const o = document.createElement('option');
    o.value = t.id;
    o.textContent = t.label;
    select.appendChild(o);
  }
  select.value = stored();
  select.addEventListener('change', () => { applyTheme(select.value); select.blur(); });
  lightMq.addEventListener('change', () => { if (stored() === 'system') applyTheme('system'); });
  applyTheme(select.value);
}
