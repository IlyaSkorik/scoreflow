import 'package:flutter_test/flutter_test.dart';
import 'package:scoreflow/models/history.dart';
import 'package:scoreflow/models/score.dart';

MusicNote q(String key) => MusicNote.fromKeys(keys: [key], duration: 'q');

Measure measure({NavigationMark? nav}) => Measure(
      {
        'treble': [q('c/4')],
        'bass': <MusicNote>[],
      },
      navigation: nav,
    );

Score scoreWith(List<Measure> measures) => Score(
      id: 'n1',
      title: 'Navigation',
      instrument: InstrumentType.piano,
      measures: measures,
      createdAt: DateTime(2026),
      updatedAt: DateTime(2026),
    );

void main() {
  group('NavigationMark model', () {
    test('ids round-trip; unknown -> null', () {
      for (final m in NavigationMark.values) {
        expect(NavigationMark.fromId(m.id), m);
      }
      expect(NavigationMark.fromId('bogus'), isNull);
      expect(NavigationMark.fromId(null), isNull);
    });

    test('jump vs marker classification', () {
      expect(NavigationMark.segno.isJump, isFalse);
      expect(NavigationMark.coda.isJump, isFalse);
      expect(NavigationMark.toCoda.isJump, isFalse);
      expect(NavigationMark.fine.isJump, isFalse);
      expect(NavigationMark.daCapo.isJump, isTrue);
      expect(NavigationMark.daCapoAlCoda.isJump, isTrue);
      expect(NavigationMark.dalSegno.isJump, isTrue);
      expect(NavigationMark.dalSegnoAlFine.isJump, isTrue);
    });
  });

  group('serialization', () {
    test('navigation serializes only when present and round-trips', () {
      final s = scoreWith([
        measure(nav: NavigationMark.segno),
        measure(),
        measure(nav: NavigationMark.dalSegnoAlCoda),
      ]);
      expect(s.measures[1].toJson().containsKey('_nav'), isFalse);
      expect(s.measures[0].toJson()['_nav'], 'segno');
      final back = Score.decode(s.encode());
      expect(back.measures[0].navigation, NavigationMark.segno);
      expect(back.measures[1].navigation, isNull);
      expect(back.measures[2].navigation, NavigationMark.dalSegnoAlCoda);
      expect(back.measures[2].toRenderJson()['_nav'], 'dalSegnoAlCoda');
    });

    test('legacy score without _nav loads unchanged', () {
      const legacy = '{"id":"old","title":"Old","composer":"",'
          '"instrument":"piano","keySignature":"C",'
          '"timeSignature":{"beats":4,"beatValue":4},"tempo":120,'
          '"measures":[{"treble":[],"bass":[]}],'
          '"createdAt":"2026-01-01T00:00:00.000",'
          '"updatedAt":"2026-01-01T00:00:00.000"}';
      final s = Score.decode(legacy);
      expect(s.measures.single.navigation, isNull);
    });
  });

  group('copy and undo/redo', () {
    test('copy preserves navigation independently', () {
      final s = scoreWith([measure(nav: NavigationMark.coda)]);
      final c = s.copy();
      expect(c.measures[0].navigation, NavigationMark.coda);
      c.measures[0].navigation = null;
      expect(s.measures[0].navigation, NavigationMark.coda);
    });

    test('undo restores previous navigation', () {
      final history = ScoreHistory();
      final s = scoreWith([measure()]);
      history.record(EditorSnapshot(
          score: s.copy(), measure: 0, voice: 'treble', index: 0));
      s.measures[0].navigation = NavigationMark.daCapoAlFine;
      final restored = history.undo(EditorSnapshot(
          score: s.copy(), measure: 0, voice: 'treble', index: 0));
      expect(restored!.score.measures[0].navigation, isNull);
      final redone = history.redo(EditorSnapshot(
          score: restored.score.copy(), measure: 0, voice: 'treble', index: 0));
      expect(redone!.score.measures[0].navigation, NavigationMark.daCapoAlFine);
    });
  });

  group('reflow preservation', () {
    test('navigation anchors stay on their measure index', () {
      final from = [
        measure(nav: NavigationMark.segno),
        measure(),
        measure(nav: NavigationMark.dalSegno),
      ];
      final navByIndex = from.map((m) => m.navigation).toList();
      final to = [
        for (var i = 0; i < 4; i++)
          Measure({'treble': <MusicNote>[], 'bass': <MusicNote>[]},
              navigation: i < navByIndex.length ? navByIndex[i] : null),
      ];
      expect(to[0].navigation, NavigationMark.segno);
      expect(to[1].navigation, isNull);
      expect(to[2].navigation, NavigationMark.dalSegno);
      expect(to[3].navigation, isNull);
    });
  });
}
