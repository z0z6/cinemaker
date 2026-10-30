# Kadr Studio

Prosty edytor wideo na **Windows (instalator + portable) i Linux (AppImage)** w stylu Movie Makera / CapCuta: oś czasu z wieloma torami, podgląd na żywo,
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
npm install          # pobiera też Electrona oraz FFmpeg/FFprobe (ffmpeg-static, ffprobe-static)
npm start            # uruchamia aplikację (F12 = narzędzia deweloperskie)
npm run test:graph   # test silnika eksportu na prawdziwym FFmpeg
npm run dist:win     # build Windows (NSIS + portable) → dist/   (uruchamiaj na Windowsie)
npm run dist:linux   # build Linux AppImage → dist/              (uruchamiaj na Linuksie)
```

## Build w GitHub Actions

`.github/workflows/build.yml` buduje obie platformy równolegle (macierz): `windows-latest` oraz `ubuntu-22.04`
(starsza glibc, więc AppImage działa także na starszych dystrybucjach). Kroki: `npm ci` → test silnika eksportu → `electron-builder` → artefakty w zakładce **Actions**:

- `Kadr Studio-Setup-x.y.z.exe`, `Kadr Studio-Portable-x.y.z.exe`
- `Kadr-Studio-x.y.z-x86_64.AppImage`

Wypchnięcie tagu `v*` (np. `git tag v0.1.0 && git push --tags`) dodatkowo tworzy **GitHub Release** z tymi plikami.
Instalator Windows nie jest podpisany certyfikatem, więc SmartScreen pokaże ostrzeżenie (podpisywanie: `CSC_LINK` / `CSC_KEY_PASSWORD` w sekretach).
Ikony są w `build/` (`icon.png` dla Linuksa, `icon.ico` dla Windows); podmień je na własne.

## Linux (AppImage)

```bash
chmod +x Kadr-Studio-*-x86_64.AppImage
./Kadr-Studio-*-x86_64.AppImage
```

- **FUSE:** na Ubuntu 22.04+ AppImage wymaga `libfuse2` (`sudo apt install libfuse2`; na 24.04: `libfuse2t64`).
  Bez FUSE uruchom: `./Kadr-Studio-*.AppImage --appimage-extract-and-run`.
- **Piaskownica Chromium:** na systemach, które ograniczają user namespaces (np. Ubuntu 23.10+ z AppArmor), aplikacja sama
  dodaje `--no-sandbox` (tylko w AppImage i tylko gdy system blokuje piaskownicę). Interfejs ładuje wyłącznie lokalne pliki aplikacji.
  Wymuszenie ręczne: `KADR_NO_SANDBOX=1`.
- Obsługiwana architektura: **x86_64**. (`ffprobe-static` nie ma binarki dla ARM64.)
- Wbudowany FFmpeg (`ffmpeg-static`) jest statyczny, więc nie trzeba niczego instalować w systemie.
- Pliki projektu `.kadr` zawierają bezwzględne ścieżki do materiałów, więc projekt przeniesiony między Windows a Linuksem
  wymaga ponownego podpięcia plików (aplikacja pokaże, których brakuje).

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
src/renderer/js/textRaster.js napisy → PNG (canvas Chromium) na potrzeby eksportu
src/renderer/js/app.js        spięcie: biblioteka, projekty, skróty, dialog eksportu
```

Model klipu: `start` (pozycja na osi), `in`/`out` (zakres w pliku źródłowym), `speed`. Długość na osi = `(out − in) / speed`.
Podział klipu to po prostu rozcięcie zakresu `in/out`, a przycięcie krawędzi zmienia `start`/`in`/`out`.

Eksport składa jeden graf FFmpeg: czarne tło → nakładanie klipów wideo/obrazów (V1, potem V2) → napisy (PNG wyrenderowane przez Chromium, więc bez filtra `drawtext` i bez zależności od czcionek systemowych);
dźwięk z klipów jest opóźniany (`adelay`), skalowany tempem (`atempo`) i miksowany (`amix`) z cichą bazą.

## Znane ograniczenia (i pomysły na rozwój)

- **Podgląd ≠ eksport co do piksela.** Podgląd to CSS (`brightness()` mnoży jasność, FFmpeg `eq` ją dodaje),
  więc drobne różnice w odcieniach są normalne. Eksport jest tym, co zostaje w pliku.
- Podgląd korzysta z dekodera Chromium: **H.264/AAC/VP9/MP3** działają, ale np. **HEVC/H.265 może się nie odtwarzać w podglądzie**
  (eksport z FFmpeg zadziała). Rozwiązanie na później: generowanie proxy 720p przy imporcie.
- Podgląd ogranicza głośność do 100 %; wzmocnienie powyżej słychać po eksporcie.
- Brak przejść między klipami (xfade), kluczowania, animacji klatek kluczowych, napisów automatycznych, fali dźwięku na klipach audio.
- Napisy używają kroju Arial (na Linuksie Liberation Sans/DejaVu, zależnie od systemu); wybór czcionki to prosty następny krok.
- Eksport działa na CPU (libx264). Akceleracja sprzętowa (`h264_nvenc`, `h264_qsv`, `h264_amf`) wymaga innej binarki FFmpeg.
- Licencje: `ffmpeg-static` dostarcza build GPL (z x264). Jeśli dystrybuujesz aplikację publicznie, zapoznaj się z licencją FFmpeg/x264.

## Dlaczego Electron, a nie Tauri?

Tauri dałby mniejszy instalator, ale wymaga toolchaina Rusta w CI oraz obsługi FFmpeg jako sidecara,
a podgląd w WebView2 zależy od runtime'u zainstalowanego w systemie użytkownika.
Electron przynosi własnego Chromium (identyczny podgląd na każdej maszynie) i prosty pakiet `ffmpeg-static`, co upraszcza i podgląd, i eksport.
