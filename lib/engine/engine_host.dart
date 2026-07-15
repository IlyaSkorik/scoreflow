import 'package:flutter/widgets.dart';

import 'engine_host_stub.dart'
    if (dart.library.io) 'engine_host_mobile.dart'
    if (dart.library.js_interop) 'engine_host_web.dart' as impl;

/// Callbacks from the notation engine (JS → Flutter).
///
/// Names and payloads match the existing InAppWebView handlers so mobile and
/// web keep the same bridge contract (`onNoteTap`, `onRendered`, …).
class EngineHostCallbacks {
  const EngineHostCallbacks({
    this.onReady,
    this.onRendered,
    this.onPlaybackEnded,
    this.onNoteTap,
    this.onTempo,
    this.onError,
  });

  /// Engine document finished loading; Dart may call [EngineHost.render].
  final VoidCallback? onReady;

  /// Score frame painted (`onRendered` from JS).
  final VoidCallback? onRendered;

  /// Playback reached the end of the score.
  final VoidCallback? onPlaybackEnded;

  /// User tapped a note/rest on the notation surface.
  final void Function(int measure, String voice, int index)? onNoteTap;

  /// Effective tempo under the playhead during playback.
  final void Function(int bpm)? onTempo;

  /// Engine load/runtime error (optional UI fallback).
  final void Function(String message)? onError;
}

/// Platform-neutral host for the VexFlow engine (`assets/www`).
///
/// Business logic (editor) talks only to this API — never to InAppWebView,
/// `dart:io`, or browser DOM APIs.
abstract class EngineHost {
  /// Embeddable engine surface (WebView on mobile, iframe on web).
  Widget build();

  /// Whether the engine document is loaded and ready for JS calls.
  bool get isReady;

  /// Renders [payload] (UTF-8 JSON) via `window.ScoreFlow.renderB64`.
  Future<void> render(String payload);

  /// Starts playback of the last rendered score at [tempo] (quarter BPM).
  Future<void> play({required int tempo});

  /// Stops playback.
  Future<void> pause();

  /// Runs arbitrary JS in the engine context (metronome, samples, …).
  Future<void> evaluate(String js);

  /// Runs JS that returns a value (`callAsyncJavaScript` / same-origin eval).
  Future<Object?> callAsync(
    String functionBody, {
    Map<String, Object?> arguments = const {},
  });

  /// Opens the system print dialog for the engine document (PDF export).
  Future<void> printPage();

  /// Releases platform resources (WebView / iframe listeners).
  void dispose();
}

/// Creates the platform-appropriate [EngineHost].
EngineHost createEngineHost({required EngineHostCallbacks callbacks}) =>
    impl.createEngineHost(callbacks: callbacks);
