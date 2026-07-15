import 'engine_assets_stub.dart'
    if (dart.library.io) 'engine_assets_mobile.dart'
    if (dart.library.js_interop) 'engine_assets_web.dart' as impl;

/// Pubspec / project path to the bundled notation engine (offline assets).
const String kEngineAssetRoot = 'assets/www';

/// Resolves a path relative to the engine root into a fetchable URL.
///
/// [relativePath] is relative to [kEngineAssetRoot], e.g. `piano/A0.mp3`,
/// `piano/manifest.json`, `index.html`.
///
/// Mobile: `http://localhost:8080/assets/www/piano/A0.mp3`
/// Web: `/assets/www/piano/A0.mp3`
String resolveAsset(String relativePath) => impl.resolveAsset(relativePath);

/// Absolute URL of the engine entry document for the current platform.
String engineIndexUrl() => resolveAsset('index.html');

/// Base URL of the engine asset tree, with trailing slash.
String engineBaseUrl() => impl.engineBaseUrl();

/// JavaScript snippet that configures engine asset URLs in the WebView/iframe.
String engineAssetConfigJs() =>
    "window.ScoreFlowAssetConfig={baseUrl:'${_escapeJs(engineBaseUrl())}'};";

String _escapeJs(String value) =>
    value.replaceAll(r'\', r'\\').replaceAll("'", r"\'");
