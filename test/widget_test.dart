// Базовый smoke-тест: модель партитуры сериализуется без потерь.

import 'package:flutter_test/flutter_test.dart';
import 'package:scoreflow/models/score.dart';

void main() {
  test('Score round-trips through JSON', () {
    final now = DateTime(2026, 1, 1);
    final score = Score.create(
      id: 'test-id',
      title: 'Этюд',
      instrument: InstrumentType.piano,
      now: now,
    );
    score.measures.first.voice('treble').add(
          MusicNote(keys: ['c/4'], duration: 'q'),
        );

    final restored = Score.decode(score.encode());

    expect(restored.id, 'test-id');
    expect(restored.title, 'Этюд');
    expect(restored.instrument, InstrumentType.piano);
    expect(restored.measures.first.voice('treble').first.keys, ['c/4']);
  });
}
