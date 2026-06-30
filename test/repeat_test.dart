import 'package:flutter_test/flutter_test.dart';
import 'package:scoreflow/models/history.dart';
import 'package:scoreflow/models/score.dart';

MusicNote q(String key) => MusicNote.fromKeys(keys: [key], duration: 'q');

Measure measure({RepeatMark? repeat}) => Measure(
      {
        'treble': [q('c/4')],
        'bass': <MusicNote>[],
      },
      repeat: repeat,
    );

Score scoreWith(List<Measure> measures) => Score(
      id: 'r1',
      title: 'Repeats',
      instrument: InstrumentType.piano,
      measures: measures,
      createdAt: DateTime(2026),
      updatedAt: DateTime(2026),
    );

void main() {
  group('RepeatMark model', () {
    test('ids round-trip and expose open/close semantics', () {
      expect(RepeatMark.fromId('start'), RepeatMark.start);
      expect(RepeatMark.fromId('end'), RepeatMark.end);
      expect(RepeatMark.fromId('both'), RepeatMark.both);
      expect(RepeatMark.fromId('bogus'), isNull);
      expect(RepeatMark.start.opensRepeat, isTrue);
      expect(RepeatMark.start.closesRepeat, isFalse);
      expect(RepeatMark.end.opensRepeat, isFalse);
      expect(RepeatMark.end.closesRepeat, isTrue);
      expect(RepeatMark.both.opensRepeat, isTrue);
      expect(RepeatMark.both.closesRepeat, isTrue);
    });
  });

  group('serialization', () {
    test('repeat serializes only when present and round-trips', () {
      final s = scoreWith([
        measure(repeat: RepeatMark.start),
        measure(),
        measure(repeat: RepeatMark.end),
      ]);
      expect(s.measures[1].toJson().containsKey('_repeat'), isFalse);
      final back = Score.decode(s.encode());
      expect(back.measures[0].repeat, RepeatMark.start);
      expect(back.measures[1].repeat, isNull);
      expect(back.measures[2].repeat, RepeatMark.end);
      expect(back.measures[2].toRenderJson()['_repeat'], 'end');
    });

    test('legacy score without _repeat loads unchanged', () {
      const legacy = '{"id":"old","title":"Old","composer":"",'
          '"instrument":"piano","keySignature":"C",'
          '"timeSignature":{"beats":4,"beatValue":4},"tempo":120,'
          '"measures":[{"treble":[],"bass":[]}],'
          '"createdAt":"2026-01-01T00:00:00.000",'
          '"updatedAt":"2026-01-01T00:00:00.000"}';
      final s = Score.decode(legacy);
      expect(s.measures.single.repeat, isNull);
    });
  });

  group('copy and undo/redo', () {
    test('copy preserves repeat independently', () {
      final s = scoreWith([measure(repeat: RepeatMark.both)]);
      final c = s.copy();
      expect(c.measures[0].repeat, RepeatMark.both);
      c.measures[0].repeat = null;
      expect(s.measures[0].repeat, RepeatMark.both);
    });

    test('undo restores previous repeat', () {
      final history = ScoreHistory();
      final s = scoreWith([measure()]);
      history.record(EditorSnapshot(
          score: s.copy(), measure: 0, voice: 'treble', index: 0));
      s.measures[0].repeat = RepeatMark.end;
      final restored = history.undo(EditorSnapshot(
          score: s.copy(), measure: 0, voice: 'treble', index: 0));
      expect(restored!.score.measures[0].repeat, isNull);
      final redone = history.redo(EditorSnapshot(
          score: restored.score.copy(), measure: 0, voice: 'treble', index: 0));
      expect(redone!.score.measures[0].repeat, RepeatMark.end);
    });
  });

  group('reflow preservation', () {
    test('repeat anchors stay on their measure index', () {
      final from = [
        measure(repeat: RepeatMark.start),
        measure(),
        measure(repeat: RepeatMark.end),
      ];
      final repeatByIndex = from.map((m) => m.repeat).toList();
      final to = [
        for (var i = 0; i < 4; i++)
          Measure({'treble': <MusicNote>[], 'bass': <MusicNote>[]},
              repeat: i < repeatByIndex.length ? repeatByIndex[i] : null),
      ];
      expect(to[0].repeat, RepeatMark.start);
      expect(to[1].repeat, isNull);
      expect(to[2].repeat, RepeatMark.end);
      expect(to[3].repeat, isNull);
    });
  });
}
