import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// Required piano samples from assets/www/piano/manifest.json.
const _pianoFiles = [
  'A0.mp3', 'C1.mp3', 'Ds1.mp3', 'Fs1.mp3', 'A1.mp3', 'C2.mp3', 'Ds2.mp3',
  'Fs2.mp3', 'A2.mp3', 'C3.mp3', 'Ds3.mp3', 'Fs3.mp3', 'A3.mp3', 'C4.mp3',
  'Ds4.mp3', 'Fs4.mp3', 'A4.mp3', 'C5.mp3', 'Ds5.mp3', 'Fs5.mp3', 'A5.mp3',
  'C6.mp3', 'Ds6.mp3', 'Fs6.mp3', 'A6.mp3', 'C7.mp3', 'Ds7.mp3', 'Fs7.mp3',
  'A7.mp3', 'C8.mp3',
];

/// Required drum samples from assets/www/drums/manifest.json.
const _drumFiles = [
  'kick.mp3',
  'snare.mp3',
  'hihat_closed.mp3',
  'crash1.mp3',
  'crash2.mp3',
  'tom_high.mp3',
  'tom_mid.mp3',
  'tom_floor.mp3',
];

void main() {
  test('piano samples exist after fetch-audio pipeline', () {
    for (final name in _pianoFiles) {
      final f = File('assets/www/piano/$name');
      expect(
        f.existsSync(),
        isTrue,
        reason: 'Missing $name — run: npm run fetch-audio',
      );
      expect(f.lengthSync(), greaterThan(512));
    }
  });

  test('drum samples exist after fetch-audio pipeline', () {
    for (final name in _drumFiles) {
      final f = File('assets/www/drums/$name');
      expect(
        f.existsSync(),
        isTrue,
        reason: 'Missing $name — run: npm run fetch-audio',
      );
      expect(f.lengthSync(), greaterThan(512));
    }
  });
}
