import 'engine_assets.dart';

/// Loopback origin for [InAppLocalhostServer] (Android/iOS).
const String kEngineLocalhostOrigin = 'http://localhost:8080';

String engineBaseUrl() => '$kEngineLocalhostOrigin/$kEngineAssetRoot/';

String resolveAsset(String relativePath) {
  final rel = relativePath.startsWith('/')
      ? relativePath.substring(1)
      : relativePath;
  return '${engineBaseUrl()}$rel';
}
