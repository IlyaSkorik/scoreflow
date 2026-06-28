import 'package:flutter_test/flutter_test.dart';
import 'package:scoreflow/models/history.dart';
import 'package:scoreflow/models/score.dart';

/// Тесты профессиональных смен тональности по партитуре (модель/сериализация/
/// copy/история/reflow/семантика операций редактора). Реальная высота и глифы —
/// в движке (JS-тесты); здесь — контракт Dart-модели.
MusicNote q(String key) =>
    MusicNote.fromKeys(keys: [key], duration: 'q');

Score scoreWith(List<Measure> measures, {String key = 'C'}) => Score(
      id: 's1',
      title: 'T',
      instrument: InstrumentType.piano,
      keySignature: key,
      measures: measures,
      createdAt: DateTime(2026),
      updatedAt: DateTime(2026),
    );

Measure measure({String? key}) =>
    Measure({'treble': [q('c/4')], 'bass': <MusicNote>[]}, keySignature: key);

void main() {
  group('serialization', () {
    test('per-measure key round-trips through JSON', () {
      final s = scoreWith([measure(), measure(key: 'G'), measure()]);
      final back = Score.decode(s.encode());
      expect(back.measures[0].keySignature, isNull);
      expect(back.measures[1].keySignature, 'G');
      expect(back.measures[2].keySignature, isNull);
      expect(back.keySignature, 'C');
    });

    test('measure without _key encodes no key field (lean JSON)', () {
      final m = measure();
      expect(m.toJson().containsKey('_key'), isFalse);
      final m2 = measure(key: 'Bb');
      expect(m2.toJson()['_key'], 'Bb');
    });

    test('legacy score without _key loads (backward compatible)', () {
      // Старый файл: такты без поля смены тональности.
      const legacy = '{"id":"old","title":"Old","composer":"",'
          '"instrument":"piano","keySignature":"D",'
          '"timeSignature":{"beats":4,"beatValue":4},"tempo":120,'
          '"measures":[{"treble":[],"bass":[]}],'
          '"createdAt":"2026-01-01T00:00:00.000",'
          '"updatedAt":"2026-01-01T00:00:00.000"}';
      final s = Score.decode(legacy);
      expect(s.keySignature, 'D');
      expect(s.measures.single.keySignature, isNull);
      expect(s.effectiveKeySignatureAt(0), 'D');
    });

    test('render projection carries _key', () {
      final m = measure(key: 'F');
      expect(m.toRenderJson()['_key'], 'F');
    });
  });

  group('copy()', () {
    test('deep copy preserves per-measure key and is independent', () {
      final s = scoreWith([measure(), measure(key: 'A')]);
      final c = s.copy();
      expect(c.measures[1].keySignature, 'A');
      // Мутация копии не задевает оригинал.
      c.measures[1].keySignature = 'E';
      expect(s.measures[1].keySignature, 'A');
    });
  });

  group('effectiveKeySignatureAt', () {
    test('carries last change forward', () {
      final s = scoreWith(
          [measure(), measure(key: 'G'), measure(), measure(key: 'F')],
          key: 'C');
      expect(s.effectiveKeySignatureAt(0), 'C');
      expect(s.effectiveKeySignatureAt(1), 'G');
      expect(s.effectiveKeySignatureAt(2), 'G');
      expect(s.effectiveKeySignatureAt(3), 'F');
    });

    test('measure 0 own key overrides the start key', () {
      final s = scoreWith([measure(key: 'D'), measure()], key: 'C');
      expect(s.effectiveKeySignatureAt(0), 'D');
      expect(s.effectiveKeySignatureAt(1), 'D');
    });
  });

  group('undo/redo (snapshot copy)', () {
    test('undo restores the previous key change', () {
      final history = ScoreHistory();
      final s = scoreWith([measure(), measure()]);
      // Снимок ДО правки (как в редакторе _commit).
      final before = EditorSnapshot(
          score: s.copy(), measure: 1, voice: 'treble', index: 0);
      history.record(before);
      // Правка: добавить смену тональности в такт 1.
      s.measures[1].keySignature = 'G';
      // Undo возвращает состояние ДО — без смены.
      final restored = history.undo(EditorSnapshot(
          score: s.copy(), measure: 1, voice: 'treble', index: 0));
      expect(restored, isNotNull);
      expect(restored!.score.measures[1].keySignature, isNull);
      // Redo возвращает состояние ПОСЛЕ — со сменой.
      final redone = history.redo(EditorSnapshot(
          score: restored.score.copy(),
          measure: 1,
          voice: 'treble',
          index: 0));
      expect(redone!.score.measures[1].keySignature, 'G');
    });
  });

  group('reflow (positional anchor)', () {
    test('key change stays attached to its measure index after repack', () {
      // Reflow перепаковывает ноты, но смены тональности — ПОЗИЦИОННЫЕ якоря:
      // сохраняются по индексу такта (как в редакторе _normalize). Здесь
      // моделируем перестроение списка тактов с переносом ключей по индексу.
      final src = [measure(), measure(key: 'G'), measure(key: 'Bb')];
      final keysByIndex = src.map((m) => m.keySignature).toList();

      // Новый список тактов (напр., нот стало больше/меньше — здесь та же длина).
      final rebuilt = <Measure>[
        for (var i = 0; i < src.length; i++)
          Measure({'treble': <MusicNote>[], 'bass': <MusicNote>[]},
              keySignature: i < keysByIndex.length ? keysByIndex[i] : null),
      ];
      final s = scoreWith(rebuilt);
      expect(s.effectiveKeySignatureAt(0), 'C');
      expect(s.effectiveKeySignatureAt(1), 'G');
      expect(s.effectiveKeySignatureAt(2), 'Bb');
    });
  });

  group('editor operation semantics', () {
    // Зеркало логики _setMeasureKey: такт 0 -> начальная тональность партитуры;
    // такт >0 -> смена; совпадение с предыдущей действующей -> снять (null).
    void setMeasureKey(Score s, int m, String? key) {
      if (m == 0) {
        s.keySignature = key ?? 'C';
        s.measures[0].keySignature = null;
      } else if (key == null) {
        s.measures[m].keySignature = null;
      } else {
        final prev = s.effectiveKeySignatureAt(m - 1);
        s.measures[m].keySignature = (key == prev) ? null : key;
      }
    }

    test('measure 0 sets the initial key, not a per-measure change', () {
      final s = scoreWith([measure(), measure()]);
      setMeasureKey(s, 0, 'G');
      expect(s.keySignature, 'G');
      expect(s.measures[0].keySignature, isNull);
      expect(s.effectiveKeySignatureAt(0), 'G');
    });

    test('insert + remove a key change on a later measure', () {
      final s = scoreWith([measure(), measure(), measure()]);
      setMeasureKey(s, 1, 'D');
      expect(s.measures[1].keySignature, 'D');
      expect(s.effectiveKeySignatureAt(2), 'D');
      setMeasureKey(s, 1, null);
      expect(s.measures[1].keySignature, isNull);
      expect(s.effectiveKeySignatureAt(2), 'C');
    });

    test('redundant change (equals previous effective) collapses to null', () {
      final s = scoreWith([measure(), measure(key: 'G'), measure()]);
      // Такт 2 уже звучит в G; явная установка G не должна порождать смену.
      setMeasureKey(s, 2, 'G');
      expect(s.measures[2].keySignature, isNull);
      // Иная тональность — реальная смена.
      setMeasureKey(s, 2, 'F');
      expect(s.measures[2].keySignature, 'F');
    });
  });
}
