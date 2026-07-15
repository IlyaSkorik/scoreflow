import 'dart:async';
import 'dart:convert';
import 'dart:js_interop';
import 'dart:js_interop_unsafe';
import 'dart:ui_web' as ui_web;

import 'package:flutter/widgets.dart';
import 'package:web/web.dart' as web;

import 'engine_assets.dart';
import 'engine_host.dart';

/// Web engine host: same-origin iframe over Flutter assets — no localhost,
/// no flutter_inappwebview, no dart:io.
EngineHost createEngineHost({required EngineHostCallbacks callbacks}) =>
    WebEngineHost(callbacks: callbacks);

class WebEngineHost implements EngineHost {
  WebEngineHost({required this.callbacks}) {
    _viewType = 'scoreflow-engine-${_nextViewId++}';
    _iframe = web.HTMLIFrameElement()
      ..src = engineIndexUrl()
      ..style.border = 'none'
      ..style.width = '100%'
      ..style.height = '100%'
      ..style.display = 'block'
      ..allow = 'autoplay';

    // Same-origin contentWindow: inject callHandler polyfill after load so
    // existing JS (`window.flutter_inappwebview.callHandler`) keeps working.
    _iframe.onLoad.listen((_) => _onIFrameLoad());

    ui_web.platformViewRegistry.registerViewFactory(
      _viewType,
      (int viewId) => _iframe,
    );

    _messageListener = (web.Event e) {
      final event = e as web.MessageEvent;
      _onMessage(event);
    }.toJS;
    web.window.addEventListener('message', _messageListener);
  }

  static int _nextViewId = 0;

  final EngineHostCallbacks callbacks;
  late final String _viewType;
  late final web.HTMLIFrameElement _iframe;
  late final JSFunction _messageListener;

  bool _ready = false;
  bool _disposed = false;
  bool _parentGestureBound = false;
  int _asyncId = 0;
  final Map<int, Completer<Object?>> _pending = {};

  @override
  bool get isReady => _ready;

  /// Create/resume AudioContext on the Flutter host page (not the iframe).
  /// Safari iOS only unlocks audio from a gesture in the same document as the
  /// AudioContext; Flutter touches happen here, engine runs in the iframe.
  void _unlockParentAudio() {
    web.window.eval(r'''
(function () {
  var AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  if (!window.__scoreflowAudioCtx) {
    window.__scoreflowAudioCtx = new AC();
  }
  var ctx = window.__scoreflowAudioCtx;
  if (ctx.state === 'suspended' || ctx.state === 'interrupted') {
    try { ctx.resume(); } catch (e) {}
  }
  try {
    var b = ctx.createBuffer(1, 1, ctx.sampleRate || 22050);
    var s = ctx.createBufferSource();
    s.buffer = b;
    s.connect(ctx.destination);
    s.start(0);
  } catch (e) {}
  try {
    if (!window.__scoreflowSilentAudio) {
      var a = new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=');
      a.setAttribute('playsinline', 'true');
      a.volume = 0.01;
      window.__scoreflowSilentAudio = a;
    }
    var p = window.__scoreflowSilentAudio.play();
    if (p && p.then) {
      p.then(function () {
        try { window.__scoreflowSilentAudio.pause(); } catch (e) {}
      }).catch(function () {});
    }
  } catch (e) {}
})();
''');
    // Also unlock inside the iframe + kick background sample warm-up.
    final win = _contentWindow;
    if (win != null && _ready) {
      win.eval(
        'window.ScoreFlow && window.ScoreFlow.unlockAudio && '
        'window.ScoreFlow.unlockAudio();',
      );
    }
  }

  void _onIFrameLoad() {
    if (_disposed) return;
    try {
      _installBridgePolyfill();
      _installParentGestureUnlock();
      _ready = true;
      callbacks.onReady?.call();
    } catch (e) {
      debugPrint('WebEngineHost load failed: $e');
      callbacks.onError?.call(e.toString());
      callbacks.onRendered?.call();
    }
  }

  /// Polyfill `flutter_inappwebview.callHandler` → parent `postMessage`.
  /// Existing engine JS keeps calling the same API unchanged.
  void _installBridgePolyfill() {
    final win = _iframe.contentWindow;
    if (win == null) return;

    win.eval('''
(function () {
  ${engineAssetConfigJs()}
  if (window.flutter_inappwebview && window.flutter_inappwebview.callHandler) {
    return;
  }
  window.flutter_inappwebview = {
    callHandler: function (name) {
      var args = Array.prototype.slice.call(arguments, 1);
      window.parent.postMessage({
        source: 'scoreflow-engine',
        handler: name,
        args: args
      }, '*');
      return Promise.resolve(null);
    }
  };
  window.addEventListener('message', function (ev) {
    var data = ev.data;
    if (!data || data.source !== 'scoreflow-host') return;
    if (data.type === 'eval') {
      Promise.resolve().then(function () {
        return (0, eval)(data.expression);
      }).then(function (result) {
        return Promise.resolve(result);
      }).then(function (result) {
        window.parent.postMessage({
          source: 'scoreflow-engine',
          type: 'eval-result',
          id: data.id,
          result: result,
          error: null
        }, '*');
      }).catch(function (e) {
        window.parent.postMessage({
          source: 'scoreflow-engine',
          type: 'eval-result',
          id: data.id,
          result: null,
          error: String(e && e.message ? e.message : e)
        }, '*');
      });
    }
  });
})();
''');
  }

  /// Unlock parent AudioContext on the first real touch/click anywhere.
  void _installParentGestureUnlock() {
    if (_parentGestureBound) return;
    _parentGestureBound = true;
    final unlock = ((web.Event _) {
      _unlockParentAudio();
    }).toJS;
    for (final type in ['touchstart', 'touchend', 'pointerdown', 'mousedown', 'click']) {
      web.document.addEventListener(type, unlock, true.toJS);
    }
  }

  void _onMessage(web.MessageEvent event) {
    if (_disposed) return;
    final data = event.data;
    if (data == null || data.typeofEquals('string')) return;

    final map = _jsObjectToMap(data);
    if (map == null || map['source'] != 'scoreflow-engine') return;

    final type = map['type'];
    if (type == 'eval-result') {
      final id = (map['id'] as num?)?.toInt();
      if (id == null) return;
      final completer = _pending.remove(id);
      if (completer == null || completer.isCompleted) return;
      final error = map['error'];
      if (error != null) {
        completer.completeError(Exception(error.toString()));
      } else {
        completer.complete(map['result']);
      }
      return;
    }

    final handler = map['handler'] as String?;
    if (handler == null) return;
    final args = map['args'];
    final list = args is List ? args : const <Object?>[];

    switch (handler) {
      case 'onNoteTap':
        if (list.isEmpty || list.first is! Map) return;
        final m = Map<String, dynamic>.from(list.first as Map);
        callbacks.onNoteTap?.call(
          (m['measure'] as num).toInt(),
          m['voice'] as String,
          (m['index'] as num).toInt(),
        );
      case 'onPlaybackEnded':
        callbacks.onPlaybackEnded?.call();
      case 'onTempo':
        if (list.isEmpty) return;
        final bpm = (list.first as num?)?.toInt();
        if (bpm != null) callbacks.onTempo?.call(bpm);
      case 'onRendered':
        callbacks.onRendered?.call();
    }
  }

  /// Best-effort conversion of a JS object/array into Dart maps/lists.
  Map<String, dynamic>? _jsObjectToMap(JSAny? data) {
    if (data == null) return null;
    try {
      final decoded = data.dartify();
      if (decoded is Map<String, dynamic>) return decoded;
      if (decoded is Map) return Map<String, dynamic>.from(decoded);
    } catch (_) {}
    return null;
  }

  web.Window? get _contentWindow => _iframe.contentWindow;

  @override
  Widget build() {
    return HtmlElementView(viewType: _viewType);
  }

  @override
  Future<void> render(String payload) async {
    final b64 = base64Encode(utf8.encode(payload));
    await evaluate(
      "window.ScoreFlow && window.ScoreFlow.renderB64('$b64');",
    );
  }

  @override
  Future<void> play({required int tempo}) async {
    final win = _contentWindow;
    if (win == null || !_ready) return;
    // Unlock in the parent document first (Safari iOS user-gesture rule).
    _unlockParentAudio();
    // Start immediately — Playback.start awaits resume only (not sample I/O).
    win.eval("window.handlePlaybackCommand('PLAY', $tempo);");
  }

  @override
  Future<void> pause() => evaluate(
        "window.handlePlaybackCommand('PAUSE', 0);",
      );

  @override
  Future<void> evaluate(String js) async {
    final win = _contentWindow;
    if (win == null || !_ready) return;
    win.eval(js);
  }

  @override
  Future<Object?> callAsync(
    String functionBody, {
    Map<String, Object?> arguments = const {},
  }) async {
    final win = _contentWindow;
    if (win == null || !_ready) return null;

    // Wrap like InAppWebView callAsyncJavaScript: args become locals.
    // Use async IIFE so `await` inside functionBody works (export / unlock).
    final decls = StringBuffer();
    arguments.forEach((key, value) {
      decls.writeln('var $key = ${jsonEncode(value)};');
    });
    final expression =
        '(async function(){ $decls $functionBody })()';

    final id = ++_asyncId;
    final completer = Completer<Object?>();
    _pending[id] = completer;

    win.postMessage(
      {
        'source': 'scoreflow-host',
        'type': 'eval',
        'id': id,
        'expression': expression,
      }.jsify(),
      '*'.toJS,
    );

    return completer.future.timeout(
      const Duration(seconds: 15),
      onTimeout: () {
        _pending.remove(id);
        throw TimeoutException('EngineHost.callAsync timed out');
      },
    );
  }

  @override
  Future<void> printPage() async {
    final win = _contentWindow;
    if (win == null || !_ready) return;
    // Start export synchronously in the Flutter button gesture stack so
    // Safari iOS accepts navigator.share(). Desktop falls through to print().
    win.eval('''
(function () {
  if (window.ScoreFlow && window.ScoreFlow.exportPrint) {
    window.ScoreFlow.exportPrint();
  } else {
    window.print();
  }
})();
''');
  }

  @override
  void dispose() {
    _disposed = true;
    _ready = false;
    web.window.removeEventListener('message', _messageListener);
    for (final c in _pending.values) {
      if (!c.isCompleted) {
        c.completeError(StateError('EngineHost disposed'));
      }
    }
    _pending.clear();
    _iframe.src = 'about:blank';
  }
}

extension on web.Window {
  /// Same-origin script evaluation (engine iframe / host page).
  void eval(String source) {
    (this as JSObject).callMethod('eval'.toJS, source.toJS);
  }
}
