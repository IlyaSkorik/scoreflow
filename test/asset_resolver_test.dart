import 'package:flutter_test/flutter_test.dart';
import 'package:scoreflow/engine/engine_assets.dart';

void main() {
  // VM / mobile conditional import uses the localhost resolver.
  test('resolveAsset builds mobile engine URLs', () {
    expect(
      resolveAsset('piano/A0.mp3'),
      'http://localhost:8080/assets/www/piano/A0.mp3',
    );
    expect(
      resolveAsset('drums/manifest.json'),
      'http://localhost:8080/assets/www/drums/manifest.json',
    );
    expect(engineIndexUrl(), 'http://localhost:8080/assets/www/index.html');
    expect(engineBaseUrl(), 'http://localhost:8080/assets/www/');
  });

  test('engineAssetConfigJs exposes baseUrl to the engine', () {
    expect(
      engineAssetConfigJs(),
      contains("baseUrl:'http://localhost:8080/assets/www/'"),
    );
  });
}
