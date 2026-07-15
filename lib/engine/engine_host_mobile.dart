import 'dart:convert';

import 'package:flutter/widgets.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';

import 'engine_assets.dart';
import 'engine_host.dart';

/// Mobile (Android/iOS) engine host: InAppWebView + InAppLocalhostServer.
EngineHost createEngineHost({required EngineHostCallbacks callbacks}) =>
    MobileEngineHost(callbacks: callbacks);

class MobileEngineHost implements EngineHost {
  MobileEngineHost({required this.callbacks});

  final EngineHostCallbacks callbacks;
  InAppWebViewController? _controller;
  bool _ready = false;

  @override
  bool get isReady => _ready;

  @override
  Widget build() {
    return InAppWebView(
      initialUrlRequest: URLRequest(url: WebUri(engineIndexUrl())),
      initialSettings: InAppWebViewSettings(
        javaScriptEnabled: true,
        transparentBackground: false,
        supportZoom: false,
        // Allow Web Audio without a direct DOM gesture (playback via bridge).
        mediaPlaybackRequiresUserGesture: false,
      ),
      onWebViewCreated: (controller) {
        _controller = controller;
        controller.addJavaScriptHandler(
          handlerName: 'onNoteTap',
          callback: (args) {
            if (args.isEmpty || args.first is! Map) return;
            final data = args.first as Map;
            callbacks.onNoteTap?.call(
              (data['measure'] as num).toInt(),
              data['voice'] as String,
              (data['index'] as num).toInt(),
            );
          },
        );
        controller.addJavaScriptHandler(
          handlerName: 'onPlaybackEnded',
          callback: (args) => callbacks.onPlaybackEnded?.call(),
        );
        controller.addJavaScriptHandler(
          handlerName: 'onTempo',
          callback: (args) {
            if (args.isEmpty) return;
            final bpm = (args.first as num?)?.toInt();
            if (bpm != null) callbacks.onTempo?.call(bpm);
          },
        );
        controller.addJavaScriptHandler(
          handlerName: 'onRendered',
          callback: (args) => callbacks.onRendered?.call(),
        );
      },
      onLoadStop: (controller, url) async {
        await controller.evaluateJavascript(source: engineAssetConfigJs());
        _ready = true;
        callbacks.onReady?.call();
      },
      onReceivedError: (controller, request, error) {
        debugPrint(
          'WebView error: ${error.type} ${error.description} (${request.url})',
        );
        callbacks.onError?.call(error.description);
        // Allow editor overlay fail-safe / show WebView fallback.
        callbacks.onRendered?.call();
      },
      onConsoleMessage: (controller, msg) =>
          debugPrint('JS: ${msg.message}'),
    );
  }

  @override
  Future<void> render(String payload) async {
    final b64 = base64Encode(utf8.encode(payload));
    await evaluate(
      "window.ScoreFlow && window.ScoreFlow.renderB64('$b64');",
    );
  }

  @override
  Future<void> play({required int tempo}) => evaluate(
        "window.handlePlaybackCommand('PLAY', $tempo);",
      );

  @override
  Future<void> pause() => evaluate(
        "window.handlePlaybackCommand('PAUSE', 0);",
      );

  @override
  Future<void> evaluate(String js) async {
    await _controller?.evaluateJavascript(source: js);
  }

  @override
  Future<Object?> callAsync(
    String functionBody, {
    Map<String, Object?> arguments = const {},
  }) async {
    final controller = _controller;
    if (controller == null) return null;
    final res = await controller.callAsyncJavaScript(
      functionBody: functionBody,
      arguments: arguments,
    );
    return res?.value;
  }

  @override
  Future<void> printPage() async {
    await _controller?.printCurrentPage();
  }

  @override
  void dispose() {
    _controller = null;
    _ready = false;
  }
}
