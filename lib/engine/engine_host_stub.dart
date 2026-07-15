import 'engine_host.dart';

/// Stub used when neither `dart:io` nor `dart:js_interop` is available.
EngineHost createEngineHost({required EngineHostCallbacks callbacks}) {
  throw UnsupportedError(
    'EngineHost is not available on this platform.',
  );
}
