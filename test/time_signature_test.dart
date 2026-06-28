import 'package:flutter_test/flutter_test.dart';
import 'package:scoreflow/models/history.dart';
import 'package:scoreflow/models/reflow.dart';
import 'package:scoreflow/models/score.dart';

/// Тесты профессиональных смен РАЗМЕРА по партитуре (модель/сериализация/copy/
/// история/reflow/ёмкость такта/семантика операций редактора). Реальный тайминг
/// и глифы — в движке (JS-тесты); здесь — контракт Dart-модели и reflow.
MusicNote q(String key) => MusicNote.fromKeys(keys: [key], duration: 'q');

Score scoreWith(List<Measure> measures, {TimeSignature? ts}) => Score(
      id: 's1',
      title: 'T',
      instrument: InstrumentType.piano,
      timeSignature: ts ?? TimeSignature.common,
      measures: measures,
      createdAt: DateTime(2026),
      updatedAt: DateTime(2026),
    );

Measure measure({TimeSignature? ts, List<MusicNote>? treble}) => Measure(
      {'treble': treble ?? [q('c/4')], 'bass': <MusicNote>[]},
      timeSignature: ts,
    );

void main() {
  group('TimeSignature value semantics', () {
    test('capacity is fraction of a whole note', () {
      expect(const TimeSignature(4, 4).capacity, 1.0);
      expect(const TimeSignature(3, 4).capacity, 0.75);
      expect(const TimeSignature(5, 8).capacity, 0.625);
      expect(const TimeSignature(7, 8).capacity, 0.875);
      expect(const TimeSignature(12, 8).capacity, 1.5);
    });

    test('equality + hashCode by beats/beatValue', () {
      expect(const TimeSignature(3, 4), const TimeSignature(3, 4));
      expect(const TimeSignature(3, 4) == const TimeSignature(6, 8), isFalse);
      expect(const TimeSignature(3, 4).hashCode,
          const TimeSignature(3, 4).hashCode);
    });

    test('parse round-trips vex', () {
      expect(TimeSignature.parse('7/8').vex, '7/8');
      expect(TimeSignature.parse('bad'), TimeSignature.common);
    });
  });

  group('serialization', () {
    test('per-measure time signature round-trips through JSON', () {
      final s = scoreWith(
          [measure(), measure(ts: const TimeSignature(3, 4)), measure()]);
      final back = Score.decode(s.encode());
      expect(back.measures[0].timeSignature, isNull);
      expect(back.measures[1].timeSignature, const TimeSignature(3, 4));
      expect(back.measures[2].timeSignature, isNull);
      expect(back.timeSignature, TimeSignature.common);
    });

    test('measure without _ts encodes no field (lean JSON)', () {
      expect(measure().toJson().containsKey('_ts'), isFalse);
      expect(measure(ts: const TimeSignature(5, 8)).toJson()['_ts'], '5/8');
    });

    test('legacy score without _ts loads (backward compatible)', () {
      const legacy = '{"id":"old","title":"Old","composer":"",'
          '"instrument":"piano","keySignature":"C",'
          '"timeSignature":{"beats":3,"beatValue":4},"tempo":120,'
          '"measures":[{"treble":[],"bass":[]}],'
          '"createdAt":"2026-01-01T00:00:00.000",'
          '"updatedAt":"2026-01-01T00:00:00.000"}';
      final s = Score.decode(legacy);
      expect(s.timeSignature, const TimeSignature(3, 4));
      expect(s.measures.single.timeSignature, isNull);
      expect(s.effectiveTimeSignatureAt(0), const TimeSignature(3, 4));
    });

    test('render projection carries _ts', () {
      expect(measure(ts: const TimeSignature(6, 8)).toRenderJson()['_ts'], '6/8');
    });
  });

  group('copy()', () {
    test('deep copy preserves per-measure time signature and is independent', () {
      final s = scoreWith([measure(), measure(ts: const TimeSignature(7, 8))]);
      final c = s.copy();
      expect(c.measures[1].timeSignature, const TimeSignature(7, 8));
      c.measures[1].timeSignature = const TimeSignature(2, 4);
      expect(s.measures[1].timeSignature, const TimeSignature(7, 8));
    });
  });

  group('effectiveTimeSignatureAt', () {
    test('carries last change forward', () {
      final s = scoreWith([
        measure(),
        measure(ts: const TimeSignature(3, 4)),
        measure(),
        measure(ts: const TimeSignature(7, 8)),
      ]);
      expect(s.effectiveTimeSignatureAt(0), TimeSignature.common);
      expect(s.effectiveTimeSignatureAt(1), const TimeSignature(3, 4));
      expect(s.effectiveTimeSignatureAt(2), const TimeSignature(3, 4));
      expect(s.effectiveTimeSignatureAt(3), const TimeSignature(7, 8));
    });

    test('measure 0 own size overrides the start size', () {
      final s = scoreWith([measure(ts: const TimeSignature(3, 4)), measure()],
          ts: TimeSignature.common);
      expect(s.effectiveTimeSignatureAt(0), const TimeSignature(3, 4));
      expect(s.effectiveTimeSignatureAt(1), const TimeSignature(3, 4));
    });

    test('index past the end clamps to the last measure', () {
      final s = scoreWith([measure(), measure(ts: const TimeSignature(5, 8))]);
      expect(s.effectiveTimeSignatureAt(99), const TimeSignature(5, 8));
    });
  });

  group('undo/redo (snapshot copy)', () {
    test('undo restores the previous time signature', () {
      final history = ScoreHistory();
      final s = scoreWith([measure(), measure()]);
      final before = EditorSnapshot(
          score: s.copy(), measure: 1, voice: 'treble', index: 0);
      history.record(before);
      s.measures[1].timeSignature = const TimeSignature(3, 4);
      final restored = history.undo(EditorSnapshot(
          score: s.copy(), measure: 1, voice: 'treble', index: 0));
      expect(restored!.score.measures[1].timeSignature, isNull);
      final redone = history.redo(EditorSnapshot(
          score: restored.score.copy(),
          measure: 1,
          voice: 'treble',
          index: 0));
      expect(redone!.score.measures[1].timeSignature, const TimeSignature(3, 4));
    });
  });

  group('measure capacity / packing (meter-aware reflow)', () {
    test('packVoiceVariable: 4/4 then 3/4 changes capacity per bin', () {
      // Поток из 7 четвертей. Такт 0 = 4/4 (4 четверти), такт 1+ = 3/4 (3).
      double capAt(int i) => i == 0 ? 1.0 : 0.75; // доля от целой
      final notes = [for (var i = 0; i < 7; i++) q('c/4')];
      final bins = packVoiceVariable(notes, capAt);
      expect(bins[0].length, 4); // 4/4
      expect(bins[1].length, 3); // 3/4
      expect(bins.length, 2);
    });

    test('packVoice (uniform wrapper) still behaves as before', () {
      final bins = packVoice([for (var i = 0; i < 5; i++) q('c/4')], 1.0);
      expect(bins.length, 2);
      expect(bins[0].length, 4);
      expect(bins[1].length, 1);
    });

    test('shrinking meter pushes overflow forward (no notes lost)', () {
      // Один такт 4/4 с 4 четвертями, затем смена на 2/4: ёмкость 0.5 целой.
      double capAt(int i) => 0.5; // 2/4 everywhere
      final bins = packVoiceVariable([for (var i = 0; i < 4; i++) q('c/4')], capAt);
      final total = bins.fold<int>(0, (s, b) => s + b.length);
      expect(total, 4); // ни одна нота не исчезла
      expect(bins.every((b) => b.length <= 2), isTrue);
    });
  });

  group('measureStarts / measureIndexAtBeat', () {
    test('cumulative starts respect per-measure capacity', () {
      // 4/4 (4q), 3/4 (3q), 7/8 (3.5q) -> starts 0,4,7,10.5
      double mq(int i) => [4.0, 3.0, 3.5][i];
      final starts = measureStarts(3, mq);
      expect(starts, [0.0, 4.0, 7.0, 10.5]);
      expect(measureIndexAtBeat(starts, 0), 0);
      expect(measureIndexAtBeat(starts, 4), 1);
      expect(measureIndexAtBeat(starts, 6.9), 1);
      expect(measureIndexAtBeat(starts, 7), 2);
      expect(measureIndexAtBeat(starts, 100), 2); // clamps
    });
  });

  group('reflowDynamicsVariable (positional anchor across meters)', () {
    test('dynamic keeps absolute beat when meter shrinks', () {
      // from: один такт 4/4, оттенок на доле 2 (третья четверть).
      final from = [
        Measure({'treble': [q('c/4')]}, dynamics: {
          'treble': [const Dynamic(mark: DynamicMark.f, voice: 'treble', beat: 2)]
        })
      ];
      // to: два такта по 2/4 (measureQ=2). abs=2 -> такт 1, локально 0.
      final to = [
        Measure({'treble': <MusicNote>[]}),
        Measure({'treble': <MusicNote>[]}),
      ];
      reflowDynamicsVariable(from, to, (_) => 2.0);
      expect(to[0].dynamicsOf('treble'), isEmpty);
      expect(to[1].dynamicsOf('treble').single.beat, 0);
      expect(to[1].dynamicsOf('treble').single.mark, DynamicMark.f);
    });
  });

  group('editor operation semantics (mirror of _setMeasureTimeSignature)', () {
    void setMeasureTs(Score s, int m, String? ts) {
      if (m == 0) {
        s.timeSignature =
            ts == null ? TimeSignature.common : TimeSignature.parse(ts);
        s.measures[0].timeSignature = null;
      } else if (ts == null) {
        s.measures[m].timeSignature = null;
      } else {
        final prev = s.effectiveTimeSignatureAt(m - 1);
        final parsed = TimeSignature.parse(ts);
        s.measures[m].timeSignature = (parsed == prev) ? null : parsed;
      }
    }

    test('measure 0 sets the initial size, not a per-measure change', () {
      final s = scoreWith([measure(), measure()]);
      setMeasureTs(s, 0, '3/4');
      expect(s.timeSignature, const TimeSignature(3, 4));
      expect(s.measures[0].timeSignature, isNull);
      expect(s.effectiveTimeSignatureAt(0), const TimeSignature(3, 4));
    });

    test('insert + remove a size change on a later measure', () {
      final s = scoreWith([measure(), measure(), measure()]);
      setMeasureTs(s, 1, '7/8');
      expect(s.measures[1].timeSignature, const TimeSignature(7, 8));
      expect(s.effectiveTimeSignatureAt(2), const TimeSignature(7, 8));
      setMeasureTs(s, 1, null);
      expect(s.measures[1].timeSignature, isNull);
      expect(s.effectiveTimeSignatureAt(2), TimeSignature.common);
    });

    test('redundant change (equals previous effective) collapses to null', () {
      final s =
          scoreWith([measure(), measure(ts: const TimeSignature(3, 4)), measure()]);
      setMeasureTs(s, 2, '3/4'); // уже 3/4 -> не смена
      expect(s.measures[2].timeSignature, isNull);
      setMeasureTs(s, 2, '6/8'); // реальная смена
      expect(s.measures[2].timeSignature, const TimeSignature(6, 8));
    });
  });
}
