# Kadr Studio

Prosty edytor wideo na Windows (w stylu Movie Makera / CapCuta): oś czasu z wieloma torami, podgląd na żywo,
napisy, filtry, tempo, głośność, eksport do MP4. Electron + HTML/CSS/JS, eksport przez FFmpeg (spakowany z aplikacją).

## Funkcje

- **Oś czasu**: 2 tory wideo (nakładki / obraz w obrazie), tor tekstu, 2 tory audio; przeciąganie, przycinanie krawędzi,
  przyciąganie do krawędzi klipów i głowicy, powiększanie (Ctrl + kółko), dzielenie klipów, usuwanie (także z zamknięciem luki).
- **Biblioteka plików**: wideo, audio, obrazy; import przyciskiem lub przeciągnięciem z Eksploratora; miniatury.
- **Właściwości klipu**: tempo 25–400 %, głośność 0–200 %, wejście/wyjście (fade), skala, położenie, krycie,
  jasność, kontrast, nasycenie, rozmycie, sepia + gotowe filtry.
- **Napisy**: treść, rozmiar, kolor, pogrubienie, tło, położenie, animacja wejścia/wyjścia.
- **Formaty kadru**: 16:9, 9:16, 1:1, 4:3, 21:9; 24–60 kl./s.
- **Eksport**: MP4 (H.264 + AAC), 720p–4K, trzy poziomy jakości, pasek postępu, możliwość przerwania.
- **Projekty** `.kadr` (JSON), cofnij/ponów (100 kroków).

## Uruchomienie lokalnie

```bash
npm install        # pobiera też Electrona oraz FFmpeg/FFprobe (ffmpeg-static, ffprobe-static)
npm start          # uruchamia aplikację (F12 = narzędzia deweloperskie)
npm run test:graph # test silnika eksportu na prawdziwym FFmpeg
npm run dist       # lokalny build Windows → katalog dist/
```

## Build w GitHub Actions

Plik `.github/workflows/build.yml` buduje aplikację na `windows-latest`:

1. `npm ci` → 2. test silnika eksportu → 3. `electron-builder` → 4. artefakty w zakładce **Actions**
(`Kadr Studio-Setup-x.y.z.exe` oraz `Kadr Studio-Portable-x.y.z.exe`).

Wypchnięcie tagu `v*` (np. `git tag v0.1.0 && git push --tags`) dodatkowo tworzy **GitHub Release** z tymi plikami.
Instalator nie jest podpisany certyfikatem, więc SmartScreen pokaże ostrzeżenie. Podpisywanie kodu wymaga
własnego certyfikatu (zmienne `CSC_LINK` / `CSC_KEY_PASSWORD` w sekretach repozytorium).

**Ikona:** dodaj `build/icon.ico` (min. 256×256), a electron-builder użyje go automatycznie.

## Skróty klawiszowe

| Klawisz | Akcja |
|---|---|
| Spacja | odtwarzaj / pauza |
| S | podziel klip w miejscu głowicy |
| T | dodaj napis |
| Delete / Shift+Delete | usuń klip / usuń i zamknij lukę |
| ← → / Shift+← → | klatka / sekunda |
| Home / End | początek / koniec |
| Ctrl+Z / Ctrl+Y | cofnij / ponów |
| Ctrl+S / Ctrl+O / Ctrl+E | zapisz / otwórz / eksportuj |
| Ctrl + kółko, Ctrl +/− | powiększenie osi czasu |

## Architektura

```
src/main/main.js         proces główny: okno, IPC, ffprobe, miniatury, zapis projektów, uruchomienie FFmpeg
src/main/exportGraph.js  model projektu → argumenty FFmpeg (filter_complex); czysty moduł, testowany w Node
src/main/preload.js      bezpieczny most IPC (contextIsolation + sandbox)
src/renderer/js/store.js model, operacje na klipach, historia undo/redo (bez DOM)
src/renderer/js/preview.js    podgląd: warstwy DOM zsynchronizowane z zegarem osi czasu
src/renderer/js/timeline.js   oś czasu: rysowanie, drag/trim/snap, zoom
src/renderer/js/inspector.js  panel właściwości
src/renderer/js/app.js        spięcie: biblioteka, projekty, skróty, dialog eksportu
```

Model klipu: `start` (pozycja na osi), `in`/`out` (zakres w pliku źródłowym), `speed`. Długość na osi = `(out − in) / speed`.
Podział klipu to po prostu rozcięcie zakresu `in/out`, a przycięcie krawędzi zmienia `start`/`in`/`out`.

Eksport składa jeden graf FFmpeg: czarne tło → nakładanie klipów wideo/obrazów (V1, potem V2) → `drawtext` dla napisów;
dźwięk z klipów jest opóźniany (`adelay`), skalowany tempem (`atempo`) i miksowany (`amix`) z cichą bazą.

## Znane ograniczenia (i pomysły na rozwój)

- **Podgląd ≠ eksport co do piksela.** Podgląd to CSS (`brightness()` mnoży jasność, FFmpeg `eq` ją dodaje; krój napisów to Arial),
  więc drobne różnice w odcieniach są normalne. Eksport jest tym, co zostaje w pliku.
- Podgląd korzysta z dekodera Chromium: **H.264/AAC/VP9/MP3** działają, ale np. **HEVC/H.265 może się nie odtwarzać w podglądzie**
  (eksport z FFmpeg zadziała). Rozwiązanie na później: generowanie proxy 720p przy imporcie.
- Podgląd ogranicza głośność do 100 %; wzmocnienie powyżej słychać po eksporcie.
- Brak przejść między klipami (xfade), kluczowania, animacji klatek kluczowych, napisów automatycznych, fali dźwięku na klipach audio.
- Napisy używają czcionek Arial (Windows); wybór czcionki to prosty następny krok (lista z `C:\Windows\Fonts`).
- Eksport działa na CPU (libx264). Akceleracja sprzętowa (`h264_nvenc`, `h264_qsv`, `h264_amf`) wymaga innej binarki FFmpeg.
- Licencje: `ffmpeg-static` dostarcza build GPL (z x264). Jeśli dystrybuujesz aplikację publicznie, zapoznaj się z licencją FFmpeg/x264.

## Dlaczego Electron, a nie Tauri?

Tauri dałby mniejszy instalator, ale wymaga toolchaina Rusta w CI oraz obsługi FFmpeg jako sidecara,
a podgląd w WebView2 zależy od runtime'u zainstalowanego w systemie użytkownika.
Electron przynosi własnego Chromium (identyczny podgląd na każdej maszynie) i prosty pakiet `ffmpeg-static`, co upraszcza i podgląd, i eksport.
