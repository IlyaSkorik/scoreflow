# ScoreFlow 🎼

<p align="center">
  <img src="docs/images/logo.png" width="180" alt="ScoreFlow Logo">
</p>

<p align="center">
  <strong>Open-source cross-platform sheet music notation editor built with Flutter and VexFlow.</strong>
</p>

<p align="center">
  <a href="README.ru.md">Русский</a> •
  <a href="ROADMAP.md">Roadmap</a> •
  <a href="LICENSE">MIT License</a>
</p>

<p align="center">
  <a href="LICENSE">
    <img src="https://img.shields.io/github/license/IlyaSkorik/scoreflow" alt="License">
  </a>
  <img src="https://img.shields.io/github/stars/IlyaSkorik/scoreflow" alt="Stars">
  <img src="https://img.shields.io/github/issues/IlyaSkorik/scoreflow" alt="Issues">
  <img src="https://img.shields.io/github/v/release/IlyaSkorik/scoreflow" alt="Release">
  <img src="https://img.shields.io/badge/Flutter-3.x-blue" alt="Flutter">
  <img src="https://img.shields.io/badge/Platforms-Android%20%7C%20iOS%20%7C%20Desktop-success" alt="Platforms">
</p>

---

> **ScoreFlow** is a modern **offline-first music notation editor** focused on **piano** and **drum** notation.
>
> Built with **Flutter**, **VexFlow**, and the **Web Audio API**, ScoreFlow allows musicians to create, edit, play back, and print sheet music entirely on their device — without requiring an account, cloud storage, or an internet connection.

Unlike traditional desktop-first notation software, ScoreFlow is designed with a **mobile-first workflow**, while remaining fully cross-platform.

---

# ✨ Why ScoreFlow?

* 🎼 Professional music engraving powered by **VexFlow**
* 📱 Designed for touch devices from day one
* ⚡ Fully offline — no backend or cloud required
* 🎹 Real-time piano playback
* 🥁 Native drum notation support
* 📄 High-quality printable A4 sheet music
* 🌍 Cross-platform architecture
* 🟢 Open-source under the MIT License

---

# 📸 Screenshots

| Library                      | Editor                      |
| ---------------------------- | --------------------------- |
| ![](docs/images/library.png) | ![](docs/images/editor.png) |

| Playback                      | Print Preview            |
| ----------------------------- | ------------------------ |
| ![](docs/images/playback.png) | ![](docs/images/pdf.png) |

---

# 🚀 Features

| Feature                | Status |
| ---------------------- | :----: |
| Piano notation         |    ✅   |
| Drum notation          |    ✅   |
| Grand staff            |    ✅   |
| Chords                 |    ✅   |
| Multiple voices        |    ✅   |
| Tuplets                |    ✅   |
| Ties & slurs           |    ✅   |
| Accidentals            |    ✅   |
| Dynamics               |    ✅   |
| Hairpins (cresc/dim)   |    ✅   |
| Articulations          |    ✅   |
| Tempo changes (♩ = N)  |    ✅   |
| Key signatures         |    ✅   |
| Mid-score key changes  |    ✅   |
| Courtesy naturals      |    ✅   |
| Time signatures        |    ✅   |
| Mid-score meter changes|    ✅   |
| Barlines (8 types)     |    ✅   |
| Repeats                |    ✅   |
| Voltas (1st/2nd ending)|    ✅   |
| Professional beaming   |    ✅   |
| Automatic rest filling |    ✅   |
| Undo / Redo            |    ✅   |
| Smart insertion        |    ✅   |
| Smart deletion         |    ✅   |
| Range selection        |    ✅   |
| Tap-to-select editing  |    ✅   |
| Sampled piano playback |    ✅   |
| Sampled drum playback  |    ✅   |
| Tempo control          |    ✅   |
| Metronome              |    ✅   |
| Follow Playback        |    ✅   |
| PDF export             |    ✅   |
| Offline storage        |    ✅   |
| MusicXML import        |   🚧   |
| MIDI export            |   🚧   |
| Cloud synchronization  |   📋   |

---

# 🏗 Architecture

```text
                  Flutter

        UI • State • Local Storage

                  │
                  ▼

        JSON Bridge (Base64)

                  │
                  ▼

      flutter_inappwebview

                  │

       InAppLocalhostServer

                  │

      ┌────────────────────────────┐
      │          VexFlow           │
      │                            │
      │       SVG Rendering        │
      │                            │
      │       Web Audio API        │
      │                            │
      │   Sample Playback Engine   │
      └────────────────────────────┘
```

---

# 🛠 Technology Stack

| Layer           | Technology           |
| --------------- | -------------------- |
| UI              | Flutter              |
| Language        | Dart                 |
| Music Rendering | VexFlow              |
| Playback        | Web Audio API        |
| Communication   | JavaScript Bridge    |
| Storage         | Local JSON Files     |
| Assets          | InAppLocalhostServer |
| Architecture    | Offline-first        |

---

# 💾 Offline First

ScoreFlow is designed to work completely offline.

* No account required
* No backend
* No cloud dependency
* No telemetry
* Local JSON storage
* Bundled rendering engine
* Bundled audio samples

Your scores always remain on your device.

---

# 📄 Export

ScoreFlow supports professional page layout for printing.

Current capabilities:

* A4 page layout
* Automatic system justification
* High-quality SVG rendering
* PDF export via the system print dialog

---

# 🎹 Playback

The playback engine includes:

* Sampled Salamander Grand piano
* Sampled drum kit
* Web Audio scheduler
* Active note highlighting
* Follow Playback
* Tempo control
* Metronome
* Sustain pedal support

If samples are unavailable, ScoreFlow automatically falls back to software synthesis.

---

# 📁 Project Structure

```text
lib/
assets/
docs/
test/
tools/

assets/www/
├── js/
├── piano/
└── drums/

lib/
├── models/
├── repository/
├── screens/
├── services/
└── widgets/
```

---

# 🚀 Getting Started

## Requirements

* Flutter SDK
* Dart >= 3.12
* Android SDK 34+ (or Xcode for iOS)

## Clone

```bash
git clone https://github.com/IlyaSkorik/scoreflow.git
cd scoreflow
```

## Install

```bash
flutter pub get
```

## Run

```bash
flutter run
```

## Analyze

```bash
flutter analyze
```

## Tests

```bash
flutter test
```

---

# 🔊 Audio Samples

ScoreFlow ships with bundled piano and drum samples.

To regenerate or replace them:

```bash
node tools/fetch_salamander.mjs
node tools/fetch_drums.mjs
```

If audio samples are unavailable, the playback engine automatically falls back to software synthesis.

---

# 🗺 Roadmap

Current priorities include:

* Crescendo / Diminuendo
* MusicXML Import
* MIDI Export
* Copy & Paste
* Multi-selection
* Articulations
* Cloud Synchronization

For the complete roadmap, see **ROADMAP.md**.

---

# 🤝 Contributing

Contributions are welcome and greatly appreciated.

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push your branch
5. Open a Pull Request

Before submitting, please ensure that:

* Code is properly formatted
* `flutter analyze` passes successfully
* All tests pass

---

# ⭐ Support the Project

If you find ScoreFlow useful, consider giving the repository a ⭐.

It helps more people discover the project and supports future development.

---

# 📄 License

ScoreFlow is released under the **MIT License**.

See the [LICENSE](LICENSE) file for details.

---

<p align="center">
Built with ❤️ by the ScoreFlow contributors using Flutter, VexFlow and the Web Audio API.
</p>
