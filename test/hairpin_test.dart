import 'package:flutter_test/flutter_test.dart';
import 'package:scoreflow/models/history.dart';
import 'package:scoreflow/models/reflow.dart';
import 'package:scoreflow/models/score.dart';

MusicNote q(String key) => MusicNote.fromKeys(keys: [key], duration: 'q');

Measure measure({List<Hairpin>? hairpins}) => Measure(
      {
        'treble': [q('c/4'), q('d/4'), q('e/4'), q('f/4')],
        'bass': <MusicNote>[],
      },
      hairpins: hairpins,
    );

Score scoreWith(List<Measure> measures) => Score(
      id: 'h1',
      title: 'Hairpins',
      instrument: InstrumentType.piano,
      measures: measures,
      createdAt: DateTime(2026),
      updatedAt: DateTime(2026),
    );

Hairpin cresc({double sb = 0, int em = 1, double eb = 0}) => Hairpin(
    type: HairpinType.crescendo, voice: 'treble', startBeat: sb, endMeasure: em, endBeat: eb);

void main() {
  group('Hairpin model', () {
    test('type ids round-trip', () {
      expect(HairpinType.fromId('crescendo'), HairpinType.crescendo);
      expect(HairpinType.fromId('diminuendo'), HairpinType.diminuendo);
      expect(HairpinType.fromId(null), HairpinType.crescendo);
      expect(HairpinType.crescendo.id, 'crescendo');
    });

    test('equality by all fields', () {
      expect(cresc(), cresc());
      expect(cresc(eb: 2) == cresc(eb: 0), isFalse);
      expect(cresc() == const Hairpin(
          type: HairpinType.diminuendo, voice: 'treble',
          startBeat: 0, endMeasure: 1, endBeat: 0), isFalse);
    });
  });

  group('serialization', () {
    test('hairpins serialize only when present and round-trip', () {
      final s = scoreWith([
        measure(hairpins: [cresc(em: 1, eb: 0)]),
        measure(),
      ]);
      expect(s.measures[1].toJson().containsKey('_hair'), isFalse);
      expect(s.measures[0].toJson()['_hair'], [
        {'type': 'crescendo', 'voice': 'treble', 'sb': 0.0, 'em': 1, 'eb': 0.0},
      ]);
      final back = Score.decode(s.encode());
      expect(back.measures[0].hairpins.single, cresc(em: 1, eb: 0));
      expect(back.measures[1].hairpins, isEmpty);
      // Render-проекция совпадает с persistence.
      expect(back.measures[0].toRenderJson()['_hair'].first['type'], 'crescendo');
    });

    test('legacy score without _hair loads unchanged', () {
      const legacy = '{"id":"old","title":"Old","composer":"",'
          '"instrument":"piano","keySignature":"C",'
          '"timeSignature":{"beats":4,"beatValue":4},"tempo":120,'
          '"measures":[{"treble":[],"bass":[]}],'
          '"createdAt":"2026-01-01T00:00:00.000",'
          '"updatedAt":"2026-01-01T00:00:00.000"}';
      final s = Score.decode(legacy);
      expect(s.measures.single.hairpins, isEmpty);
    });
  });

  group('copy and undo/redo', () {
    test('copy is deep and independent', () {
      final s = scoreWith([measure(hairpins: [cresc(em: 1, eb: 0)])]);
      final c = s.copy();
      expect(c.measures[0].hairpins.single, cresc(em: 1, eb: 0));
      c.measures[0].hairpins.clear();
      expect(s.measures[0].hairpins.single, cresc(em: 1, eb: 0));
    });

    test('undo restores previous hairpins', () {
      final history = ScoreHistory();
      final s = scoreWith([measure(), measure()]);
      history.record(EditorSnapshot(
          score: s.copy(), measure: 0, voice: 'treble', index: 0));
      s.measures[0].hairpins.add(cresc(em: 1, eb: 0));
      final restored = history.undo(EditorSnapshot(
          score: s.copy(), measure: 0, voice: 'treble', index: 0));
      expect(restored!.score.measures[0].hairpins, isEmpty);
      final redone = history.redo(EditorSnapshot(
          score: restored.score.copy(), measure: 0, voice: 'treble', index: 0));
      expect(redone!.score.measures[0].hairpins.single, cresc(em: 1, eb: 0));
    });
  });

  group('reflow preservation', () {
    test('hairpin re-anchors to absolute beats across relayout', () {
      // from: 3 measures of 4/4; hairpin spans m0 b0 -> m2 b0 (abs 0..8).
      final from = [
        measure(hairpins: [
          const Hairpin(type: HairpinType.diminuendo, voice: 'treble',
              startBeat: 0, endMeasure: 2, endBeat: 0),
        ]),
        measure(),
        measure(),
      ];
      // to: 2 measures (notes repacked); same 4/4 capacity by index.
      final to = [
        for (var i = 0; i < 2; i++)
          Measure({'treble': <MusicNote>[], 'bass': <MusicNote>[]}),
      ];
      reflowHairpinsVariable(from, to, (_) => 4.0);
      // absStart 0 -> m0 b0; absEnd 8 -> last measure (idx 1) b4.
      expect(to[0].hairpins.single.type, HairpinType.diminuendo);
      expect(to[0].hairpins.single.startBeat, 0.0);
      expect(to[0].hairpins.single.endMeasure, 1);
      expect(to[0].hairpins.single.endBeat, 4.0);
      expect(to[1].hairpins, isEmpty);
    });

    test('reflow clears destination and preserves musical time', () {
      // from: 2 measures; hairpin m1 b1 -> m1 b3 (abs 5..7).
      final from = [
        measure(),
        measure(hairpins: [cresc(sb: 1, em: 1, eb: 3)]),
      ];
      final to = [
        for (var i = 0; i < 4; i++)
          Measure({'treble': <MusicNote>[], 'bass': <MusicNote>[]}),
      ];
      reflowHairpinsVariable(from, to, (_) => 4.0);
      // abs 5 -> m1 (starts [0,4,8,12,16]) b1 ; abs 7 -> m1 b3.
      expect(to[1].hairpins.single, cresc(sb: 1, em: 1, eb: 3));
      var count = 0;
      for (final m in to) {
        count += m.hairpins.length;
      }
      expect(count, 1);
    });
  });
}
