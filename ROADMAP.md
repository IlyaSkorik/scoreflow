# ScoreFlow Roadmap

> Single source of truth for the project's state. Completed items are verified
> against the actual codebase, not aspirations.
>
> Last reviewed: **2026-06-29** · Flutter 3.44.3 · Material 3 · VexFlow 4.2.2 · ES Modules.
> Latest: professional Barline System (8 types — first-class per-measure notation
> object, native VexFlow + custom engraving, shared screen/PDF, reflow-safe;
> architectural foundation for the Repeat System).

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

> Builds directly on the completed **Professional Repeat System**. Repeat
> Counts, Voltas, D.C., D.S., Fine, Segno and Coda are sibling boundary objects
> that extend the same compiler expansion pipeline; scheduler remains unchanged.

* [ ] Repeat Count
* [ ] First ending (volta)
* [ ] Second ending (volta)
* [ ] D.C. al Fine
* [ ] D.S. al Coda
* [ ] Segno
* [ ] Coda
* [ ] Fine
* [ ] Playback support

---

### Tempo

* [ ] Tempo markings
* [ ] Mid-score tempo changes
* [ ] Accelerando
* [ ] Ritardando
* [ ] A tempo
* [ ] Playback support

---

### Articulations

* [ ] Staccato
* [ ] Accent
* [ ] Tenuto
* [ ] Marcato
* [ ] Staccatissimo
* [ ] Fermata
* [ ] Playback support

---

### Hairpins

* [ ] Crescendo
* [ ] Diminuendo
* [ ] Playback interpolation

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
