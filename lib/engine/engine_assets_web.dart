import 'engine_assets.dart';

/// Flutter Web serves static engine files from `web/assets/www/` at this URL
/// prefix (single `/assets/` — no duplicated `assets/` segment).
String engineBaseUrl() => '/$kEngineAssetRoot/';

String resolveAsset(String relativePath) {
  final rel = relativePath.startsWith('/')
      ? relativePath.substring(1)
      : relativePath;
  return '${engineBaseUrl()}$rel';
}
