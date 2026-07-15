import 'engine_bootstrap_stub.dart'
    if (dart.library.io) 'engine_bootstrap_mobile.dart'
    if (dart.library.js_interop) 'engine_bootstrap_web.dart' as impl;

/// Platform bootstrap for the notation engine (localhost on mobile, no-op on web).
Future<void> bootstrapEngine() => impl.bootstrapEngine();
