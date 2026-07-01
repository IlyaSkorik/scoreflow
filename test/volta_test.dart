import 'package:flutter_test/flutter_test.dart';
import 'package:scoreflow/models/history.dart';
import 'package:scoreflow/models/score.dart';

MusicNote q(String key) => MusicNote.fromKeys(keys: [key], duration: 'q');

Measure measure({Volta? volta, RepeatMark? repeat}) => Measure(
      {
        'treble': [q('c/4')],
        'bass': <MusicNote>[],
      },
      volta: volta,
      repeat: repeat,
    );

Score scoreWith(List<Measure> measures) => Score(
      id: 'v1',
      title: 'Voltas',
      instrument: InstrumentType.piano,
      measures: measures,
      createdAt: DateTime(2026),
      updatedAt: DateTime(2026),
    );

void main() {
  group('Volta model', () {
    test('numbers normalize and label formats', () {
      expect(Volta.fromJson({'n': [2, 1, 2]}).numbers, [1, 2]);
      expect(Volta.fromJson({'n': const <int>[]}).numbers, [1]);
      expect(Volta(numbers: [1]).label, '1.');
      expect(Volta(numbers: [2]).label, '2.');
      expect(Volta(numbers: [1, 3]).label, '1, 3.');
      expect(Volta.ending(2).numbers, [2]);
      expect(Volta.ending(1, span: 0).span, 1); // span clamps to >= 1
    });

    test('equality by numbers and span', () {
      expect(Volta(numbers: [1]), Volta(numbers: [1]));
      expect(Volta(numbers: [1], span: 2) == Volta(numbers: [1]), isFalse);
      expect(Volta(numbers: [1]) == Volta(numbers: [2]), isFalse);
    });
  });

  group('serialization', () {
    test('volta serializes only when present; span only when > 1', () {
      final s = scoreWith([
        measure(volta: Volta.ending(1)),
        measure(volta: Volta(numbers: [2], span: 2)),
        measure(),
      ]);
      expect(s.measures[0].toJson()['_volta'], {'n': [1]}); // span omitted
      expect(s.measures[1].toJson()['_volta'], {'n': [2], 'span': 2});
      expect(s.measures[2].toJson().containsKey('_volta'), isFalse);

      final back = Score.decode(s.encode());
      expect(back.measures[0].volta, Volta.ending(1));
      expect(back.measures[1].volta, Volta(numbers: [2], span: 2));
      expect(back.measures[2].volta, isNull);
      // Render-проекция всегда несёт span.
      expect(back.measures[0].toRenderJson()['_volta'], {'n': [1], 'span': 1});
    });

    test('legacy score without _volta loads unchanged', () {
      const legacy = '{"id":"old","title":"Old","composer":"",'
          '"instrument":"piano","keySignature":"C",'
          '"timeSignature":{"beats":4,"beatValue":4},"tempo":120,'
          '"measures":[{"treble":[],"bass":[]}],'
          '"createdAt":"2026-01-01T00:00:00.000",'
          '"updatedAt":"2026-01-01T00:00:00.000"}';
      final s = Score.decode(legacy);
      expect(s.measures.single.volta, isNull);
    });
  });

  group('copy and undo/redo', () {
    test('copy preserves volta independently (deep copy)', () {
      final s = scoreWith([measure(volta: Volta(numbers: [1], span: 2))]);
      final c = s.copy();
      expect(c.measures[0].volta, Volta(numbers: [1], span: 2));
      c.measures[0].volta!.numbers[0] = 9;
      // Мутация копии не задевает оригинал (списки склонированы).
      expect(s.measures[0].volta!.numbers, [1]);
    });

    test('undo restores previous volta', () {
      final history = ScoreHistory();
      final s = scoreWith([measure()]);
      history.record(EditorSnapshot(
          score: s.copy(), measure: 0, voice: 'treble', index: 0));
      s.measures[0].volta = Volta.ending(1);
      final restored = history.undo(EditorSnapshot(
          score: s.copy(), measure: 0, voice: 'treble', index: 0));
      expect(restored!.score.measures[0].volta, isNull);
      final redone = history.redo(EditorSnapshot(
          score: restored.score.copy(), measure: 0, voice: 'treble', index: 0));
      expect(redone!.score.measures[0].volta, Volta.ending(1));
    });
  });

  group('reflow preservation', () {
    test('volta anchors stay on their measure index', () {
      final from = [
        measure(repeat: RepeatMark.end, volta: Volta.ending(1)),
        measure(volta: Volta.ending(2)),
      ];
      final voltaByIndex = from.map((m) => m.volta).toList();
      final to = [
        for (var i = 0; i < 4; i++)
          Measure({'treble': <MusicNote>[], 'bass': <MusicNote>[]},
              volta: i < voltaByIndex.length ? voltaByIndex[i] : null),
      ];
      expect(to[0].volta, Volta.ending(1));
      expect(to[1].volta, Volta.ending(2));
      expect(to[2].volta, isNull);
      expect(to[3].volta, isNull);
    });
  });
}
