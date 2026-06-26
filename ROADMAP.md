# ScoreFlow Roadmap

> Single source of truth for the project's state. Completed items are verified
> against the actual codebase, not aspirations.
>
> Last reviewed: 2026-06-24 · Flutter + Material 3 · VexFlow 4.2.2 in WebView.

## Vision

A mobile-first music notation editor that musicians can comfortably use to
**create, edit, play back, and share** scores directly on a phone — with
print-grade output (clean A4 PDF, no clipped bars). Primary focus: keyboard
(grand staff) and drum notation. Fully offline, no backend.

---

## Architecture (orientation)

- **Flutter shell** — UI, state, file storage, transport controls.
- **VexFlow engine** in `assets/www/index.html`, served over a local HTTP
  server (`InAppLocalhostServer`) inside `flutter_inappwebview` — offline.
- **Bridge** — score serialized to base64 JSON → `ScoreFlow.renderB64`; taps and
  playback events flow back via `callHandler`.
- **Storage** — one JSON file per score under app documents (`ScoreRepository`).
- **Playback** — Web Audio scheduler (look-ahead), sampled piano/drums with
  synth fallback.

---

## Completed

### Core
- [x] Offline-first local storage (per-score JSON via `path_provider`)
- [x] Flutter + Material 3 (`useMaterial3`, dark seed theme)
- [x] VexFlow WebView engine (local HTTP server, offline asset resolution)
- [x] PDF export (system print → "Save as PDF")
- [x] A4 pagination (system/page layout with justification)
- [x] Modular ES-module engine (`assets/www/js`: utils/domain/audio/playback/render/bridge; `index.html` is a thin entry point)
- [x] Modern Android build (AGP 8.11.1 / Gradle 8.14 / Kotlin 2.2.20; no `--android-skip-build-dependency-validation`)

### Notation
- [x] Piano notation (grand staff: treble + bass, brace)
- [x] Drum notation (percussion clef, x-heads, articulations by notehead)
- [x] Dotted notes (1 dot in UI; model supports N dots)
- [x] Dotted rests (canonical, beat-aligned auto-fill)
- [x] 32nd notes
- [x] 64th notes
- [x] Chord mode (explicit stack toggle)
- [x] Multi-key notes (chords, drum stacks)
- [x] **Tie** (duration ligature — model, rendering, **playback merge**, PDF)
- [x] **Slur** (phrasing ligature — model, rendering, PDF) — _playback unaffected by design (stage 1)_
- [x] **Tuplets** (universal `actual:normal` — triplets, quintuplets, sextuplets, septuplets, custom; model, rendering, playback timing, reflow-atomic, PDF)
- [x] Auto measure completion (reflow + canonical rest fill)
- [x] Professional beaming (beat-group beams, compound/irregular meters)
- [x] Partial ligature arcs across row/system breaks
- [x] Key signature & time signature (incl. custom meters)
- [x] **Accidentals** (♯ ♭ ♮ 𝄪 𝄫 — dedicated `Accidental`/`Pitch` model, per-notehead; editor tool, rendering, PDF; **playback pitch resolved once** = key signature + accidental + measure rules: carry-to-end-of-measure, per step+octave, natural cancels, auto-reset next measure; extensible to microtones)

### Playback
- [x] Audio Engine (Web Audio, look-ahead scheduler, "two clocks")
- [x] Sampled Piano (Salamander samples present in repo; synth fallback)
- [x] Drum samples (kit MP3s present in repo; synth fallback)
- [x] Metronome (accent on downbeat)
- [x] Follow Playback (vertical auto-scroll to active system)
- [x] Note-synced playhead + active-note highlight
- [x] Sustain (damper) pedal for piano
- [x] Tempo control (BPM)

### Editor
- [x] Undo / Redo (snapshot-based history)
- [x] Smart insert (fills rests / inserts after cursor)
- [x] Smart delete (note → rest in place, ligatures cleared)
- [x] Cursor navigation (arrows + tap-to-select on score)
- [x] Chord input mode
- [x] Slur input via range selection (anchor → cursor)
- [x] Score library (create, list, delete, rename)

---

## In Progress

_Nothing in active development right now._

---

## Next Priorities

### High Priority
- [ ] Copy / Paste measures
- [ ] Multi-selection
- [ ] Dynamics (pp, p, mp, mf, f, ff)
- [ ] Crescendo / Diminuendo

### Medium Priority
- [ ] Slur playback (legato shaping) — _rendering/model already done_
- [ ] In-app Page View (A4) toggle — _A4 layout currently lives only in PDF export_
- [ ] MusicXML Import
- [ ] MIDI Import
- [ ] Articulations (staccato, accent, tenuto, …)
- [ ] Tempo changes (mid-score)

### Low Priority
- [ ] Additional instruments
- [ ] Cloud sync
- [ ] Collaboration

---

## Technical Debt

- [ ] WebView rendering performance (full SVG rebuild on every edit)
- [ ] Ligature rendering in compressed measures (`sx<1`): tail extents are
      approximate; ties/slurs are drawn inside the measure's scale transform
- [ ] Playback profiling (scheduler under dense scores)
- [ ] Large score optimization (layout passes scale with measure count)
- [ ] Broader JS-side test harness (node ESM test exists for the pitch resolver — `test/js/accidental_resolver.test.mjs`; wider engine coverage still TBD, not wired into `flutter test`)

---

## Future Vision

_Ideas without commitment._

- MusicXML export
- MIDI export
- Plugin system
- AI-assisted transcription
- Desktop version
- Tablet-optimized layout

---

## Notes & Discrepancies (code vs. the requested roadmap)

Findings from scanning the repo, so this file stays the source of truth:

1. **Slur is already implemented** (model + rendering + PDF), not a future item.
   It was requested under *Next → Medium*; moved to **Completed**. Only its
   **playback** is intentionally deferred (kept as a Medium item).
2. **Features present in code but absent from the requested list** (added to
   Completed): key/time signature selection (incl. custom meters), tempo,
   sustain pedal, score library (CRUD + rename), tap-to-select, synth fallback,
   partial cross-system ligature arcs.
3. **"Dual-View" (Line/Page) from the README is not fully realized in-app.** The
   editor renders **Line View only**; the A4 (Page) layout exists **only in the
   PDF export path**, not as an interactive in-editor toggle. Tracked under
   *Next → Medium*.
4. **Easter egg** ("Sasha's kidney") described in `.clauderules` / `README` is
   **not implemented** in code (no references outside docs).
5. **Samples in repo:** the README states binary samples are not committed, but
   `assets/www/piano/*.mp3` and `assets/www/drums/*.mp3` are **present** in the
   working tree. (Doc nuance, not a functional gap.)
