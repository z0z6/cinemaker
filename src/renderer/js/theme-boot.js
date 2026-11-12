// Ładowany synchronicznie w <head>, zanim pojawi się CSS: ustawia motyw bez mignięcia domyślnych kolorów.
// Pełna obsługa (lista, zmiana, śledzenie motywu systemu) jest w theme.js.
(function () {
  try {
    var t = localStorage.getItem('kadr.theme') || 'system';
    if (t === 'system') t = matchMedia('(prefers-color-scheme: light)').matches ? 'jasny' : 'grafit';
    document.documentElement.setAttribute('data-theme', t);
  } catch (e) { /* zostaje motyw domyślny z :root */ }
})();
