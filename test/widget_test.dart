// Базовый smoke-тест: модель партитуры сериализуется без потерь.

import 'package:flutter_test/flutter_test.dart';
import 'package:scoreflow/models/palette.dart';
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

  test('Multi-key chord round-trips through JSON', () {
    final now = DateTime(2026, 1, 1);
    final score = Score.create(
      id: 'chord-id',
      title: 'Аккорд',
      instrument: InstrumentType.piano,
      now: now,
    );
    score.measures.first.voice('treble').add(
          MusicNote(keys: ['c/4', 'e/4', 'g/4'], duration: 'h'),
        );
    // Многозвучное ударное событие: бочка + крэш одновременно.
    final drums = Score.create(
      id: 'drum-id',
      title: 'Сбивка',
      instrument: InstrumentType.drums,
      now: now,
    );
    drums.measures.first.voice('perc').add(
          MusicNote(keys: ['f/4', 'a/5/x2'], duration: 'q'),
        );

    expect(Score.decode(score.encode()).measures.first.voice('treble').first.keys,
        ['c/4', 'e/4', 'g/4']);
    expect(Score.decode(drums.encode()).measures.first.voice('perc').first.keys,
        ['f/4', 'a/5/x2']);
  });

  test('keyPitchRank orders chord heads low→high and ignores drum head', () {
    // Аккорд C-E-G: c/4 < e/4 < g/4.
    expect(keyPitchRank('c/4') < keyPitchRank('e/4'), isTrue);
    expect(keyPitchRank('e/4') < keyPitchRank('g/4'), isTrue);
    // Диез выше натуральной, октава доминирует.
    expect(keyPitchRank('c#/4') > keyPitchRank('c/4'), isTrue);
    expect(keyPitchRank('c/5') > keyPitchRank('b/4'), isTrue);
    // Головка (3-й сегмент) не влияет: ранг по линии стана.
    expect(keyPitchRank('g/5/x2'), keyPitchRank('g/5'));
  });
}
