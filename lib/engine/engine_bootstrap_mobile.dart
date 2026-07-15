import 'package:flutter/foundation.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';

/// Shared local HTTP server that serves bundled engine assets offline.
///
/// Used only on Android/iOS. Flutter Web must never import this library.
final InAppLocalhostServer _localhostServer =
    InAppLocalhostServer(shared: true);

/// Starts [InAppLocalhostServer] so relative paths in `assets/www` resolve.
Future<void> bootstrapEngine() async {
  try {
    if (!_localhostServer.isRunning()) {
      await _localhostServer.start().timeout(const Duration(seconds: 5));
    }
  } catch (e) {
    debugPrint('InAppLocalhostServer start failed: $e');
  }
}
