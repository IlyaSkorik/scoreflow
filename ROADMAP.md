# ScoreFlow Roadmap

> Single source of truth for the project's state. Completed items are verified
> against the actual codebase, not aspirations.
>
> Last reviewed: **2026-07-01** · Flutter 3.44.3 · Material 3 · VexFlow 4.2.2 · ES Modules.
> Latest: professional Tempo Changes System (absolute ♩ = N at any rhythmic
> position — first-class notation objects; playback timing is now compiler-driven
> via a single beats→seconds tempo map resolved once, shared screen/PDF engraving
> above the staff; scheduler stays notation-agnostic and never computes tempo).

---

# Vision

A mobile-first professional music notation editor that musicians can comfortably
**create, edit, play back, print, and share** scores directly on a phone.

Primary focus:

* Piano (grand staff)
* Drum notation

Secondary goals:

* Professional engraving
* Accurate playback
* Full offline workflow
* MusicXML interoperability

---

# Architecture

* **Flutter shell** — UI, editor, storage, transport controls.
* **Modular VexFlow Engine** (`assets/www/js/`) running inside WebView.
* **Bridge** — Flutter ↔ JavaScript communication via Base64 JSON.
* **Storage** — Offline-first JSON files (`ScoreRepository`).
* **Playback** — Web Audio look-ahead scheduler with sampled piano/drums and synth fallback.
* **Rendering** — Shared engraving pipeline for screen and PDF.

---

# Completed

## Core

* [x] Offline-first local storage
* [x] Flutter + Material 3
* [x] VexFlow WebView engine
* [x] Modular ES-module architecture (18 JS modules)
* [x] Local HTTP asset server
* [x] PDF export
* [x] Professional A4 pagination
* [x] Android build modernization

  * AGP 8.11.1
  * Gradle 8.14
  * Kotlin 2.2.20
  * Flutter 3.44.3 compatible
* [x] Release build pipeline

---

## Notation

### General

* [x] Grand staff (treble + bass)
* [x] Percussion staff
* [x] Chord mode
* [x] Multi-note chords
* [x] Canonical measure completion
* [x] Professional beaming
* [x] Cross-system ligatures

### Rhythm

* [x] Dotted notes
* [x] Dotted rests
* [x] 32nd notes
* [x] 64th notes
* [x] Universal tuplets

  * Triplets
  * Quintuplets
  * Sextuplets
  * Septuplets
  * Custom ratios

### Musical Symbols

* [x] Key signatures

  * Initial key
  * Mid-score key changes (per measure)
  * Automatic courtesy naturals
  * Local accidental normalization on key change
  * Playback updates after key change
  * Reflow-safe positional anchor
* [x] Time signatures

  * Initial meter
  * Mid-score meter changes (per measure)
  * Per-measure measure capacity (no global meter)
  * Meter-aware reflow (overflow/fill preserve notes, ties, tuplets, dynamics)
  * Per-measure professional beaming
  * Compound & irregular meters (6/8, 7/8, 9/8, 12/8, 5/8 …)
  * Playback meter grid + per-measure metronome accents
  * Reflow-safe positional anchor
* [x] Barlines

  * First-class notation object (per measure-boundary `_bar`)
  * Normal (single)
  * Double
  * Final
  * Dashed
  * Dotted
  * Tick
  * Short
  * Invisible (occupies layout, draws nothing)
  * Automatic final barline at the end of the score (positional default)
  * Single spanning barline across the grand-staff accolade
  * Native VexFlow engraving where available (single/double/final/invisible)
  * Custom professional engraving where not (dashed/dotted/tick/short)
  * Shared screen/PDF rendering (visually identical)
  * Reflow-safe positional anchor (by measure index)
  * Shared boundary architecture used by the Repeat System
* [x] Professional Repeat System

  * First-class repeat notation object (per measure-boundary `_repeat`)
  * Repeat Start (`|:`)
  * Repeat End (`:|`)
  * Repeat Both (`:|:`)
  * Native VexFlow repeat barlines where available
  * Shared screen/PDF repeat rendering through the barline renderer
  * Compiler-resolved playback expansion
  * Missing start repeat plays from the beginning
  * Missing end repeat plays normally
  * Deterministic playback order with no infinite loops
  * Scheduler remains repeat-agnostic
  * Undo / Redo
  * Serialization, legacy loading, autosave
  * Reflow-safe positional anchor (by measure index)
  * Architectural foundation for Repeat Counts, Voltas, D.C., D.S., Fine, Segno, Coda
* [x] Professional Volta System (first & second endings)

  * First-class volta notation object (per-measure `_volta`, range span)
  * First ending / Second ending / custom ending numbers (`numbers` list — future-ready for 3rd/4th/arbitrary)
  * Single-measure and multi-measure endings
  * Professional engraving: horizontal bracket + vertical hooks + ending number
  * Closing hook derived from ending adjacency (last ending open)
  * System-break aware (per-system bracket segments, number only on the first)
  * Grand-staff aware (bracket above the top staff)
  * Shared screen/PDF volta rendering (visually identical)
  * Compiler-resolved playback: repeat + volta expansion in one authority
  * Correct entry into the second ending, inactive endings skipped
  * Deterministic playback with no infinite loops; scheduler remains volta-agnostic
  * Undo / Redo, serialization, legacy loading, autosave
  * Reflow-safe positional anchor (by measure index)
  * Completes the professional repeat architecture
* [x] Accidentals

  * Sharp
  * Flat
  * Natural
  * Double Sharp
  * Double Flat
  * Measure rules
  * Playback resolution
* [x] Ties

  * Rendering
  * Playback merge
  * PDF
* [x] Slurs

  * Rendering
  * PDF
* [x] Dynamics

  * ppp
  * pp
  * p
  * mp
  * mf
  * f
  * ff
  * fff
  * SMuFL rendering
  * PDF
  * Compiler-integrated playback
  * Per-voice timelines
  * Reflow preservation
  * Collision avoidance
* [x] Professional Hairpin System (crescendo / diminuendo)

  * First-class range hairpin notation object (per-measure `_hair`, voice + time-anchored)
  * Crescendo (`<`) / Diminuendo (`>`)
  * Extends the Dynamics architecture — not a separate playback system
  * Compiler-resolved velocity interpolation inside `velocityAt` (resolved once)
  * Ramps between the surrounding dynamic marks; default step when no target
  * Interpolated end velocity holds until the next dynamic
  * Professional wedge engraving on the shared dynamics baseline
  * System-break aware (continuous wedge across line breaks)
  * Shared screen/PDF hairpin rendering (visually identical)
  * Scheduler remains unaware of dynamics and hairpins
  * Editor tool (select start → end; crescendo / diminuendo / remove)
  * Undo / Redo, serialization, legacy loading, autosave
  * Time-anchored reflow (re-anchored by absolute beat, like dynamics)
  * Future-ready for niente, custom wedges, expression, playback curves
* [x] Professional Articulations System

  * Staccato / Staccatissimo / Accent / Marcato / Tenuto
  * First-class per-note articulation (list on the note — multiple per note)
  * Extends the playback compiler — the final expressive layer after dynamics/hairpins
  * Compiler modifies the PlaybackEvent (duration, velocity, attack, release)
  * Effect constants in one place (`domain/articulations`); no duplicated rules
  * Scheduler stays notation-agnostic (reads the same duration/velocity)
  * Professional engraving via VexFlow, placed opposite the stem
  * Chords, grand staff, drum notation supported
  * Shared screen/PDF rendering (`buildVoice`, visually identical)
  * Editor tool (toggle / multiple / remove), Undo / Redo, autosave
  * Serialization, legacy loading; articulations stay attached to their note through reflow
  * Future-ready for fermata, breath mark, caesura and humanized attack/release
* [x] Professional Tempo Changes System

  * Absolute tempo marks (♩ = N) at any rhythmic position (first-class `_tempo`)
  * Playback timing is now compiler-driven — one tempo map converts beats → seconds
  * Tempo resolved exactly once; events carry absolute `startSec`/`durSec`
  * Scheduler is notation-agnostic (reads absolute time, never computes tempo)
  * Mid-measure and multiple tempo changes; deterministic; repeats/voltas re-apply per pass
  * Tempo changes alter playback time only — note durations in beats are unchanged
  * Professional engraving above the staff (notehead + stem + "= N")
  * Shared screen/PDF rendering; sits above voltas, collision-free headroom
  * Editor tool (presets 40–160 + custom BPM, insert / edit / remove)
  * Undo / Redo, serialization, legacy loading; time-anchored reflow
  * Future-ready for rit., accel., a tempo, tempo text, metric modulation, swing

---

## Playback

* [x] Web Audio Engine
* [x] Look-ahead scheduler
* [x] Sampled piano
* [x] Sampled drums
* [x] Synth fallback
* [x] Metronome
* [x] Sustain pedal
* [x] Tempo control
* [x] Follow Playback
* [x] Playhead
* [x] Active note highlighting
* [x] Compiler-resolved accidentals
* [x] Compiler-resolved dynamics
* [x] Compiler-resolved repeats
* [x] Compiler-resolved voltas
* [x] Compiler-resolved hairpins (velocity interpolation)
* [x] Compiler-resolved articulations (duration / velocity / attack)
* [x] Compiler-driven tempo mapping (beats → absolute time)
* [x] Shared perceptual velocity curve
* [x] Unified velocity → gain pipeline

---

## Rendering

* [x] Professional screen rendering
* [x] Professional PDF rendering
* [x] Shared engraving algorithms
* [x] Dynamics collision avoidance
* [x] Shared screen/PDF dynamics placement

---

## Editor

* [x] Undo / Redo
* [x] Smart insert
* [x] Smart delete
* [x] Cursor navigation
* [x] Tap selection
* [x] Chord input
* [x] Slur creation
* [x] Dynamics editor
* [x] Repeat editor
* [x] Volta editor
* [x] Hairpin editor
* [x] Articulation editor
* [x] Tempo editor
* [x] Score library

  * Create
  * Rename
  * Delete

---

## Quality

* [x] Flutter analyze clean
* [x] Dart test suite
* [x] JavaScript engine tests
* [x] Android Debug build
* [x] Android Release build
* [x] GitHub Release workflow

---

# In Progress

*Nothing in active development.*

---

# Next Priorities

## 🎼 Musical Core (Highest Priority)

### Repeat Extensions

> Builds directly on the completed **Professional Repeat System** and
> **Professional Volta System**. Repeat Counts, D.C., D.S., Fine, Segno and Coda
> are sibling boundary objects that extend the same compiler expansion pipeline;
> scheduler remains unchanged.

* [ ] Repeat Count
* [ ] D.C. al Fine
* [ ] D.S. al Coda
* [ ] Segno
* [ ] Coda
* [ ] Fine
* [ ] Playback support

---

### Tempo

> Builds on the completed **Professional Tempo Changes System** (absolute ♩ = N,
> compiler-driven timing). Gradual changes extend the tempo map with variable-spq
> segments; a tempo / tempo text are sibling anchors — no redesign.

* [ ] Accelerando
* [ ] Ritardando
* [ ] A tempo
* [ ] Tempo text (Allegro, Andante …)
* [ ] Metric modulation

---

### Articulations

> Builds on the completed **Professional Articulations System** (staccato,
> staccatissimo, accent, marcato, tenuto). Remaining marks are new entries in the
> same `ARTICULATION_SPEC` — no redesign.

* [ ] Fermata
* [ ] Breath mark
* [ ] Caesura

---

### Expressive Dynamics

* [ ] sf
* [ ] sfz
* [ ] fp
* [ ] rfz
* [ ] subito p
* [ ] subito f

---

### Piano

* [ ] Pedal notation (Ped. / *)
* [ ] Ottava (8va / 8vb / 15ma / 15mb)

---

### Ornaments

* [ ] Trill
* [ ] Mordent
* [ ] Turn
* [ ] Inverted Turn

---

### Grace Notes

* [ ] Acciaccatura
* [ ] Appoggiatura

---

### Other Musical Symbols

* [ ] Tremolo
* [ ] Arpeggio
* [ ] Multi-measure rests
* [ ] Chord symbols
* [ ] Lyrics

---

## ✏️ Editor

* [ ] Multi-selection
* [ ] Copy / Paste
* [ ] Drag selection
* [ ] Batch editing

---

## 🎨 Engraving

* [ ] Automatic articulation collision avoidance
* [ ] Hairpin collision avoidance
* [ ] Better horizontal spacing
* [ ] Better vertical spacing
* [ ] System justification improvements
* [ ] Page justification improvements

---

## 📤 Export

* [ ] MusicXML Export
* [ ] MIDI Export
* [ ] PNG Export
* [ ] SVG Export

---

## 📥 Import

* [ ] MusicXML Import
* [ ] MIDI Import

---

## 🌍 Platform

* [ ] Additional instruments
* [ ] Cloud synchronization
* [ ] Collaboration
* [ ] Desktop edition
* [ ] Tablet-optimized layout

---

# Technical Debt

* [ ] Incremental SVG rendering
* [ ] Large-score rendering optimization
* [ ] Scheduler performance profiling
* [ ] Shared screen/PDF engraving utilities
* [ ] Snapshot rendering tests
* [ ] Broader JS engine test coverage
* [ ] Benchmark suite for rendering and playback

---

# Future Vision

Ideas without commitment.

* Plugin API
* AI-assisted transcription
* AI-assisted accompaniment
* Guitar tablature
* Handwriting recognition
* Real-time collaboration
* DAW interoperability
* VST playback
* Mobile MIDI recording

---

# Milestones

## v0.4.x

Professional notation foundation.

* Modular rendering engine
* Professional tuplets
* Professional accidentals
* Professional dynamics
* Modern Android toolchain
* Stable PDF export

---

## v0.5.x

Complete musical notation core.

* Key changes
* Meter changes
* Barlines
* Tempo system
* Articulations
* Hairpins

---

## v0.6.x

Professional playback.

* Expressive playback
* Repeats
* Tempo automation
* Pedal notation
* Ornaments

---

## v0.7.x

Interoperability.

* MusicXML Export
* MIDI Export
* MusicXML Import
* MIDI Import

---

## v1.0.0

First stable release.

* Complete musical notation engine
* Professional engraving
* Stable playback
* Import / Export ecosystem
* Production-ready mobile score editor
