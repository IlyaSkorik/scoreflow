# Changelog

All notable changes to this project will be documented in this file.

The format is based on **Keep a Changelog** and this project follows **Semantic Versioning**.

---

## [Unreleased]

_Nothing yet._

---

## [0.5.0] - 2026-07-01

Professional notation engine milestone (Release Candidate).

### Added

* Per-notehead accidentals (♯ ♭ ♮ 𝄪 𝄫) with courtesy naturals
* Key signatures and mid-score key changes
* Time signatures and mid-score meter changes
* Barlines (double / final / dashed / dotted / tick / short / invisible)
* Repeats (start / end / both) with deterministic playback expansion
* Voltas (first / second / multi endings) integrated with repeats
* Hairpins (crescendo / diminuendo) with interpolated playback velocity
* Articulations (staccato / staccatissimo / accent / marcato / tenuto)
* Tempo marks (♩ = N) with per-measure placement and tempo map
* Navigation system (Segno, Coda, To Coda, Fine, D.C./D.S. and al Fine / al Coda variants)
* Ties and slurs, including across system breaks
* Tuplets (triplets, quintuplets, …)

### Fixed

* Tie across a barline into a repeated section or a first ending no longer drops
  or over-sustains a note on later passes (tie-merge now runs after playback
  order expansion).

### Technical

* Shared engraving pipeline for screen and PDF
* Playback compiler as the single authority: linear → repeats → voltas →
  navigation → tempo → events → scheduler (scheduler is notation-agnostic)
* Standalone Node test suite for the JavaScript engine

---

## [0.4.0] - 2026-06-27

### Added

* Professional project documentation
* English and Russian README
* Piano notation
* Drum notation
* Web Audio playback
* PDF export
* Offline-first architecture
* Project roadmap
* Contributing guidelines

### Improved

* GitHub repository presentation
* Documentation structure
* Repository branding

### Technical

* Flutter
* VexFlow
* Web Audio API
* Local JSON storage
