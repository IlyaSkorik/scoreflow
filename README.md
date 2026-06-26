# ScoreFlow 🎼

**English** · [Русский](README.ru.md)

**Mobile-first music notation editor built with Flutter and VexFlow.**

ScoreFlow lets you create, edit, play back, and print sheet music directly on a
phone — focused on **piano** (grand staff) and **drum** notation. It runs a
VexFlow rendering engine inside a WebView with a Web Audio playback engine, and
works **fully offline**: no account, no backend, scores stored as local files.

Unlike guitar-tab-oriented apps, ScoreFlow targets keyboard and percussion
parts and produces clean, page-based **A4 PDF** output without clipped bars.

> Status: **active development** — see [ROADMAP.md](ROADMAP.md).

---

## Features

### Notation
- Piano notation (treble + bass grand staff)
- Drum notation (percussion clef, articulations by notehead)
- Chords / multi-key notes
- Dotted notes & dotted rests
- 32nd and 64th notes
- Ties (duration) and slurs (phrasing)
- Tuplets — universal `actual:normal` (triplets, quintuplets, sextuplets, septuplets, custom)
- Accidentals (♯ ♭ ♮ 𝄪 𝄫) — per-notehead model; playback pitch = key signature + accidental + measure rules
- Key signatures & time signatures (incl. custom meters)
- Professional beaming (beat groups, compound/irregular meters)
- Automatic measure completion (canonical rest fill)

### Playback
- Web Audio engine (look-ahead scheduler)
- Sampled piano (Salamander Grand) with synth fallback
- Sampled drum kit with synth fallback
- Metronome
- Tempo control (BPM)
- Follow Playback (auto-scroll to the active system)
- Note-synced playhead + active-note highlight
- Sustain (damper) pedal

### Editing
- Smart insert (fills rests / inserts after cursor)
- Smart delete (note → rest in place)
- Undo / Redo (snapshot history)
- Chord input mode
- Range selection (for slurs and tuplets)
- Tap-to-select notes on the score

### Export
- A4 pagination (system/page layout with justification)
- PDF export via the system print dialog

### Storage
- Offline-first local storage (one JSON file per score)
- Score library (create, open, rename, delete)

---

## Architecture

```
Flutter (UI, state, files, transport)
   │  base64 JSON over evaluateJavascript / callHandler
   ▼
WebView (flutter_inappwebview)
   │  assets served by a local HTTP server (offline)
   ▼
VexFlow (notation rendering, SVG)
   +
Web Audio API (sampled playback + scheduler)
```

- **Localhost server** — `InAppLocalhostServer` serves the engine assets over
  `http://localhost`, so relative paths (`js/vexflow.js`, samples) resolve.
- **Offline assets** — the VexFlow engine and audio samples are bundled; the app
  needs no network at runtime.
- **JSON transport** — scores are serialized to base64 JSON and passed to the
  engine; taps and playback events are reported back through a JS bridge.

---

## Development Status

**Active development.** Implemented and planned work is tracked in
[ROADMAP.md](ROADMAP.md), which is the single source of truth for project state.

---

## Roadmap

Next priorities (details in [ROADMAP.md](ROADMAP.md)):

- Dynamics (pp–ff) and crescendo / diminuendo
- Copy / paste measures and multi-selection
- MusicXML import
- Articulations (staccato, accent, tenuto, …)

---

## Getting Started

### Requirements
- Flutter SDK (Dart `>=3.12.2`)
- Android SDK 34+ (or an iOS toolchain)

### Run
```bash
git clone <repo-url>
cd scoreflow
flutter pub get
# AGP dependency validation is skipped intentionally (see ROADMAP tech debt)
flutter run --android-skip-build-dependency-validation
```

### Tests
```bash
flutter analyze
flutter test
```

### Audio samples (optional)
Piano and drum samples are included in the repository, so playback works out of
the box. To (re)generate or replace them, run the one-shot fetch scripts
(network required **only** when preparing assets):

```bash
node tools/fetch_salamander.mjs   # piano  -> assets/www/piano/
node tools/fetch_drums.mjs        # drums  -> assets/www/drums/
```

If samples are missing, the engine automatically falls back to synthesis.

---

## License

Released under the [MIT License](LICENSE).
