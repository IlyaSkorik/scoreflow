# Contributing to ScoreFlow 🎼

First of all, thank you for your interest in contributing to **ScoreFlow**!

Whether you're fixing a bug, improving the documentation, implementing a new feature, or suggesting an idea, your contribution is greatly appreciated.

---

# Before You Start

Please check the following before opening a Pull Request:

* Search existing Issues to avoid duplicates.
* Read the project Roadmap (`ROADMAP.md`).
* Keep Pull Requests focused on a single change.
* Make sure your changes don't break existing functionality.

---

# Development Setup

## Requirements

* Flutter SDK
* Dart >= 3.12
* Android SDK (or Xcode for iOS)
* Git

Clone the repository:

```bash
git clone https://github.com/IlyaSkorik/scoreflow.git

cd scoreflow
```

Install dependencies:

```bash
flutter pub get
```

Run the application:

```bash
flutter run
```

---

# Code Style

Please follow these guidelines:

* Use the official Dart formatting style.
* Keep code readable and consistent.
* Prefer descriptive variable and method names.
* Avoid unnecessary complexity.
* Write comments only when they improve understanding.

Format the project before committing:

```bash
dart format .
```

---

# Static Analysis

Before opening a Pull Request, ensure that the analyzer reports no issues:

```bash
flutter analyze
```

---

# Tests

All existing tests should pass.

Run:

```bash
flutter test
```

If your change introduces new functionality, please consider adding tests where appropriate.

---

# Commit Messages

Use clear and descriptive commit messages.

Examples:

```text
feat: add tuplet editor

fix: correct beaming in 7/8

docs: improve README

refactor: simplify playback scheduler
```

---

# Pull Requests

When creating a Pull Request:

* Explain what has changed.
* Describe why the change is needed.
* Include screenshots for UI changes whenever possible.
* Keep the PR focused on a single topic.

Smaller Pull Requests are easier to review and merge.

---

# Reporting Bugs

When reporting a bug, please include:

* Operating system
* Device (if applicable)
* Flutter version
* Steps to reproduce
* Expected behavior
* Actual behavior
* Screenshots or screen recordings (if possible)

---

# Feature Requests

Feature ideas are always welcome.

When opening a feature request, try to explain:

* The problem you're trying to solve
* Your proposed solution
* Alternative approaches (if any)

---

# Project Goals

ScoreFlow aims to provide a modern, open-source music notation editor that is:

* Mobile-first
* Cross-platform
* Offline-first
* Fast and intuitive
* Suitable for professional music notation

Every contribution should help move the project toward these goals.

---

# Thank You ❤️

Thank you for helping make ScoreFlow better!

Every contribution—large or small—is appreciated.
