import 'package:flutter_test/flutter_test.dart';
import 'package:scoreflow/models/history.dart';
import 'package:scoreflow/models/reflow.dart';
import 'package:scoreflow/models/score.dart';

MusicNote q(String key) => MusicNote.fromKeys(keys: [key], duration: 'q');

Measure measure({List<TempoMark>? tempos}) => Measure(
      {
        'treble': [q('c/4'), q('d/4'), q('e/4'), q('f/4')],
        'bass': <MusicNote>[],
      },
      tempos: tempos,
    );

Score scoreWith(List<Measure> measures) => Score(
      id: 't1',
      title: 'Tempo',
      instrument: InstrumentType.piano,
      measures: measures,
      createdAt: DateTime(2026),
      updatedAt: DateTime(2026),
    );

void main() {
  group('TempoMark model', () {
    test('fields, withBpm, equality', () {
      const t = TempoMark(bpm: 60);
      expect(t.bpm, 60);
      expect(t.beatUnit, 1);
      expect(t.beat, 0);
      expect(t.withBpm(120).bpm, 120);
      expect(const TempoMark(bpm: 80, beat: 2), const TempoMark(bpm: 80, beat: 2));
      expect(const TempoMark(bpm: 80) == const TempoMark(bpm: 90), isFalse);
    });
  });

  group('serialization', () {
    test('tempos serialize only when present; unit only when != 1', () {
      final s = scoreWith([
        measure(tempos: [const TempoMark(bpm: 60, beat: 0)]),
        measure(),
      ]);
      expect(s.measures[0].toJson()['_tempo'], [
        {'bpm': 60, 'beat': 0.0},
      ]);
      expect(s.measures[1].toJson().containsKey('_tempo'), isFalse);
      final back = Score.decode(s.encode());
      expect(back.measures[0].tempos.single, const TempoMark(bpm: 60));
      expect(back.measures[1].tempos, isEmpty);
      // Render-проекция несёт то же.
      expect(back.measures[0].toRenderJson()['_tempo'].first['bpm'], 60);
    });

    test('half-note beat unit round-trips', () {
      final s = scoreWith([
        measure(tempos: [const TempoMark(bpm: 60, beatUnit: 2, beat: 1)]),
      ]);
      expect(s.measures[0].toJson()['_tempo'].first['unit'], 2.0);
      final back = Score.decode(s.encode());
      expect(back.measures[0].tempos.single,
          const TempoMark(bpm: 60, beatUnit: 2, beat: 1));
    });

    test('legacy score without _tempo loads unchanged', () {
      const legacy = '{"id":"old","title":"Old","composer":"",'
          '"instrument":"piano","keySignature":"C",'
          '"timeSignature":{"beats":4,"beatValue":4},"tempo":120,'
          '"measures":[{"treble":[],"bass":[]}],'
          '"createdAt":"2026-01-01T00:00:00.000",'
          '"updatedAt":"2026-01-01T00:00:00.000"}';
      final s = Score.decode(legacy);
      expect(s.measures.single.tempos, isEmpty);
    });
  });

  group('copy and undo/redo', () {
    test('copy is deep and independent', () {
      final s = scoreWith([measure(tempos: [const TempoMark(bpm: 80)])]);
      final c = s.copy();
      expect(c.measures[0].tempos.single, const TempoMark(bpm: 80));
      c.measures[0].tempos.clear();
      expect(s.measures[0].tempos.single, const TempoMark(bpm: 80));
    });

    test('undo restores previous tempo marks', () {
      final history = ScoreHistory();
      final s = scoreWith([measure()]);
      history.record(EditorSnapshot(
          score: s.copy(), measure: 0, voice: 'treble', index: 0));
      s.measures[0].tempos.add(const TempoMark(bpm: 60));
      final restored = history.undo(EditorSnapshot(
          score: s.copy(), measure: 0, voice: 'treble', index: 0));
      expect(restored!.score.measures[0].tempos, isEmpty);
      final redone = history.redo(EditorSnapshot(
          score: restored.score.copy(), measure: 0, voice: 'treble', index: 0));
      expect(redone!.score.measures[0].tempos.single, const TempoMark(bpm: 60));
    });
  });

  group('reflow preservation', () {
    test('tempo re-anchors to absolute beat across relayout', () {
      // from: 3 measures of 4/4; tempo at measure 2 beat 0 (abs 8).
      final from = [
        measure(),
        measure(),
        measure(tempos: [const TempoMark(bpm: 60, beat: 0)]),
      ];
      final to = [
        for (var i = 0; i < 6; i++)
          Measure({'treble': <MusicNote>[], 'bass': <MusicNote>[]}),
      ];
      reflowTemposVariable(from, to, (_) => 4.0);
      // abs 8 with 4 q/measure -> measure 2 beat 0.
      expect(to[2].tempos.single, const TempoMark(bpm: 60, beat: 0));
      var count = 0;
      for (final m in to) {
        count += m.tempos.length;
      }
      expect(count, 1);
    });

    test('score.tempo is the implicit initial tempo (single source)', () {
      // Начальный темп пьесы = Score.tempo; отдельной метки `_tempo` в (0,0) нет.
      final s = scoreWith([measure(tempos: [const TempoMark(bpm: 60, beat: 2)])]);
      s.tempo = 90;
      final back = Score.decode(s.encode());
      expect(back.tempo, 90); // начальный темп
      // В такте 0 только СЕРЕДИННАЯ смена (доля 2), не начало.
      expect(back.measures[0].tempos.map((t) => t.beat).toList(), [2.0]);
      expect(back.measures[0].tempos.any((t) => t.beat == 0), isFalse);
    });

    test('mid-measure tempo keeps its musical position', () {
      // from: 2 measures; tempo at measure 1 beat 2 (abs 6).
      final from = [
        measure(),
        measure(tempos: [const TempoMark(bpm: 100, beat: 2)]),
      ];
      final to = [
        for (var i = 0; i < 4; i++)
          Measure({'treble': <MusicNote>[], 'bass': <MusicNote>[]}),
      ];
      reflowTemposVariable(from, to, (_) => 4.0);
      // abs 6 -> measure 1 beat 2 (starts [0,4,8,12,16]).
      expect(to[1].tempos.single, const TempoMark(bpm: 100, beat: 2));
    });
  });
}
