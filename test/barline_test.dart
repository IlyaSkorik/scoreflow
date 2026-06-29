import 'package:flutter_test/flutter_test.dart';
import 'package:scoreflow/models/history.dart';
import 'package:scoreflow/models/reflow.dart';
import 'package:scoreflow/models/score.dart';

/// Тесты профессиональной системы тактовых черт (модель/сериализация/copy/
/// история/reflow/семантика операций редактора). Реальная гравировка (нативный
/// тип VexFlow vs кастомная отрисовка) — в движке (JS-тесты); здесь — контракт
/// Dart-модели и сохранение черт при reflow. Черта — позиционный якорь правой
/// границы такта, как смены тональности/размера.
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

Measure measure({BarlineType? bar, List<MusicNote>? treble}) => Measure(
      {'treble': treble ?? [q('c/4')], 'bass': <MusicNote>[]},
      barline: bar,
    );

void main() {
  group('BarlineType value semantics', () {
    test('id is stable JSON token (double/final keep clean ids)', () {
      expect(BarlineType.normal.id, 'normal');
      expect(BarlineType.doubleBar.id, 'double');
      expect(BarlineType.finalBar.id, 'final');
      expect(BarlineType.dashed.id, 'dashed');
      expect(BarlineType.invisible.id, 'invisible');
    });

    test('fromId round-trips every type', () {
      for (final t in BarlineType.values) {
        expect(BarlineType.fromId(t.id), t);
      }
    });

    test('fromId unknown/null falls back to normal', () {
      expect(BarlineType.fromId('nope'), BarlineType.normal);
      expect(BarlineType.fromId(null), BarlineType.normal);
    });

    test('only normal is the default', () {
      expect(BarlineType.normal.isDefault, isTrue);
      for (final t in BarlineType.values.where((t) => t != BarlineType.normal)) {
        expect(t.isDefault, isFalse);
      }
    });
  });

  group('serialization', () {
    test('per-measure barline round-trips through JSON', () {
      final s = scoreWith([
        measure(bar: BarlineType.finalBar),
        measure(),
        measure(bar: BarlineType.dashed),
      ]);
      final back = Score.decode(s.encode());
      expect(back.measures[0].barline, BarlineType.finalBar);
      expect(back.measures[1].barline, isNull);
      expect(back.measures[2].barline, BarlineType.dashed);
    });

    test('every type round-trips', () {
      final s = scoreWith([
        for (final t in BarlineType.values) measure(bar: t),
      ]);
      final back = Score.decode(s.encode());
      for (var i = 0; i < BarlineType.values.length; i++) {
        final t = BarlineType.values[i];
        // normal сериализуется как «нет черты» -> null при загрузке.
        expect(back.measures[i].barline, t.isDefault ? isNull : t);
      }
    });

    test('normal/none barline encodes no field (lean JSON)', () {
      expect(measure().toJson().containsKey('_bar'), isFalse);
      expect(measure(bar: BarlineType.normal).toJson().containsKey('_bar'),
          isFalse);
      expect(measure(bar: BarlineType.finalBar).toJson()['_bar'], 'final');
    });

    test('legacy score without _bar loads (backward compatible)', () {
      const legacy = '{"id":"old","title":"Old","composer":"",'
          '"instrument":"piano","keySignature":"C",'
          '"timeSignature":{"beats":4,"beatValue":4},"tempo":120,'
          '"measures":[{"treble":[],"bass":[]}],'
          '"createdAt":"2026-01-01T00:00:00.000",'
          '"updatedAt":"2026-01-01T00:00:00.000"}';
      final s = Score.decode(legacy);
      expect(s.measures.single.barline, isNull);
    });

    test('render projection carries _bar (engine input)', () {
      expect(measure(bar: BarlineType.dotted).toRenderJson()['_bar'], 'dotted');
      expect(measure().toRenderJson().containsKey('_bar'), isFalse);
    });
  });

  group('copy()', () {
    test('deep copy preserves per-measure barline and is independent', () {
      final s = scoreWith([measure(), measure(bar: BarlineType.finalBar)]);
      final c = s.copy();
      expect(c.measures[1].barline, BarlineType.finalBar);
      c.measures[1].barline = BarlineType.invisible;
      expect(s.measures[1].barline, BarlineType.finalBar); // источник не тронут
    });
  });

  group('undo/redo (snapshot copy)', () {
    test('undo restores the previous barline', () {
      final history = ScoreHistory();
      final s = scoreWith([measure(), measure()]);
      final before = EditorSnapshot(
          score: s.copy(), measure: 1, voice: 'treble', index: 0);
      history.record(before);
      s.measures[1].barline = BarlineType.finalBar;
      final restored = history.undo(EditorSnapshot(
          score: s.copy(), measure: 1, voice: 'treble', index: 0));
      expect(restored!.score.measures[1].barline, isNull);
      final redone = history.redo(EditorSnapshot(
          score: restored.score.copy(),
          measure: 1,
          voice: 'treble',
          index: 0));
      expect(redone!.score.measures[1].barline, BarlineType.finalBar);
    });
  });

  group('editor operation semantics (mirror of _setMeasureBarline)', () {
    void setBarline(Score s, int m, BarlineType? type) {
      s.measures[m].barline =
          (type == null || type.isDefault) ? null : type;
    }

    test('set a barline on a measure', () {
      final s = scoreWith([measure(), measure()]);
      setBarline(s, 1, BarlineType.doubleBar);
      expect(s.measures[1].barline, BarlineType.doubleBar);
    });

    test('replace a barline in place', () {
      final s = scoreWith([measure(bar: BarlineType.dashed)]);
      setBarline(s, 0, BarlineType.finalBar);
      expect(s.measures[0].barline, BarlineType.finalBar);
    });

    test('remove (back to normal) clears the override to null', () {
      final s = scoreWith([measure(bar: BarlineType.finalBar)]);
      setBarline(s, 0, BarlineType.normal);
      expect(s.measures[0].barline, isNull);
      setBarline(s, 0, null);
      expect(s.measures[0].barline, isNull);
    });

    test('invisible is an explicit type, not a removal', () {
      final s = scoreWith([measure()]);
      setBarline(s, 0, BarlineType.invisible);
      expect(s.measures[0].barline, BarlineType.invisible);
      expect(s.measures[0].toJson()['_bar'], 'invisible');
    });
  });

  group('reflow preservation (positional anchor by measure index)', () {
    // Зеркало обработки черт в editor `_normalize`: черты снимаются по индексу
    // ДО перепаковки и возвращаются на тот же индекс — независимо от того,
    // что reflow поменял число тактов или содержимое.
    List<Measure> reflowPreserve(List<Measure> from, int newCount) {
      final barByIndex = from.map((m) => m.barline).toList();
      return [
        for (var i = 0; i < newCount; i++)
          Measure({'treble': <MusicNote>[], 'bass': <MusicNote>[]},
              barline: i < barByIndex.length ? barByIndex[i] : null),
      ];
    }

    test('barlines stay on their measure index after a repack', () {
      final from = [
        measure(bar: BarlineType.finalBar),
        measure(),
        measure(bar: BarlineType.dashed),
      ];
      final to = reflowPreserve(from, 4); // reflow добавил такт
      expect(to[0].barline, BarlineType.finalBar);
      expect(to[1].barline, isNull);
      expect(to[2].barline, BarlineType.dashed);
      expect(to[3].barline, isNull); // новый такт — обычная черта
    });

    test('changing notes never drops a custom barline', () {
      // Имитация: один такт 4/4 переполнен 5 четвертями -> reflow даст 2 такта.
      final from = [
        Measure(
          {'treble': [for (var i = 0; i < 5; i++) q('c/4')], 'bass': []},
          barline: BarlineType.finalBar,
        ),
      ];
      final packed = packVoice(from[0].voice('treble'), 1.0); // 4/4 -> 2 корзины
      final to = reflowPreserve(from, packed.length);
      expect(packed.length, 2);
      expect(to[0].barline, BarlineType.finalBar); // черта не потеряна
      expect(to[1].barline, isNull);
    });
  });
}
