import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:scoreflow/models/reflow.dart';
import 'package:scoreflow/models/score.dart';

MusicNote n(String dur, {Tuplet? tuplet, bool start = false}) => MusicNote.fromKeys(
      keys: const ['c/4'],
      duration: dur,
      tuplet: tuplet,
      tupletStart: start,
    );

void main() {
  group('Модель Tuplet — универсальное соотношение actual:normal', () {
    test('scale = normal/actual', () {
      expect(const Tuplet(3, 2).scale, closeTo(2 / 3, 1e-12));
      expect(const Tuplet(5, 4).scale, closeTo(4 / 5, 1e-12));
      expect(const Tuplet(7, 4).scale, closeTo(4 / 7, 1e-12));
    });

    test('по умолчанию ноты вне tuplet', () {
      final note = MusicNote.fromKeys(keys: const ['c/4'], duration: '8');
      expect(note.tuplet, isNull);
      expect(note.tupletStart, false);
      expect(note.tupletScale, 1.0);
    });

    test('toJson пишет tuplet/tupletStart только когда заданы', () {
      final plain = MusicNote.fromKeys(keys: const ['c/4'], duration: '8').toJson();
      expect(plain.containsKey('tuplet'), false);
      expect(plain.containsKey('tupletStart'), false);

      final t = n('8', tuplet: const Tuplet(3, 2), start: true).toJson();
      expect(t['tuplet'], {'actual': 3, 'normal': 2});
      expect(t['tupletStart'], true);
    });

    test('round-trip JSON сохраняет соотношение и старт (3:2,5:4,6:4,7:4)', () {
      for (final r in const [
        Tuplet(3, 2),
        Tuplet(5, 4),
        Tuplet(6, 4),
        Tuplet(7, 4),
      ]) {
        final src = n('8', tuplet: r, start: true);
        final back = MusicNote.fromJson(
            jsonDecode(jsonEncode(src.toJson())) as Map<String, dynamic>);
        expect(back.tuplet!.actualNotes, r.actualNotes);
        expect(back.tuplet!.normalNotes, r.normalNotes);
        expect(back.tupletStart, true);
      }
    });

    test('copy() глубоко копирует tuplet (важно для snapshot-Undo)', () {
      final src = n('8', tuplet: const Tuplet(5, 4), start: true);
      final c = src.copy();
      expect(c.tuplet!.actualNotes, 5);
      expect(c.tupletStart, true);
      // независимость: смена ссылки в копии не трогает оригинал
      c.tuplet = null;
      expect(src.tuplet, isNotNull);
    });
  });

  group('noteTime — реальное время с учётом tuplet', () {
    test('восьмая триоли 3:2 = 1/12; группа из трёх = 1/4', () {
      final note = n('8', tuplet: const Tuplet(3, 2));
      expect(noteTime(note), closeTo(1 / 12, 1e-12));
      expect(noteTime(note) * 3, closeTo(1 / 4, 1e-12)); // = 2 восьмых
    });

    test('квинтоль/секстоль/септоль 8-х занимают ожидаемое время', () {
      // 5:4 пять восьмых -> 4 восьмых = 1/2
      expect(noteTime(n('8', tuplet: const Tuplet(5, 4))) * 5, closeTo(0.5, 1e-12));
      // 6:4 шесть восьмых -> 1/2
      expect(noteTime(n('8', tuplet: const Tuplet(6, 4))) * 6, closeTo(0.5, 1e-12));
      // 7:4 семь восьмых -> 1/2
      expect(noteTime(n('8', tuplet: const Tuplet(7, 4))) * 7, closeTo(0.5, 1e-12));
    });
  });

  group('tupletChunks — группировка', () {
    test('группа + одиночная нота', () {
      const t = Tuplet(3, 2);
      final notes = [
        n('8', tuplet: t, start: true),
        n('8', tuplet: t),
        n('8', tuplet: t),
        n('q'),
      ];
      final chunks = tupletChunks(notes);
      expect(chunks.length, 2);
      expect(chunks[0].length, 3);
      expect(chunks[1].length, 1);
    });

    test('две одинаковые триоли подряд разделяются по tupletStart', () {
      const t = Tuplet(3, 2);
      final notes = [
        n('8', tuplet: t, start: true),
        n('8', tuplet: t),
        n('8', tuplet: t),
        n('8', tuplet: t, start: true),
        n('8', tuplet: t),
        n('8', tuplet: t),
      ];
      final chunks = tupletChunks(notes);
      expect(chunks.length, 2);
      expect(chunks[0].length, 3);
      expect(chunks[1].length, 3);
    });
  });

  group('Reflow — tuplet-группа атомарна', () {
    test('группа целиком переезжает в следующий такт при переполнении', () {
      // 4/4: три четверти (3/4) + триоль из 3 четвертей (3:2 -> 1/2).
      // 3/4 + 1/2 = 5/4 > 1 -> вся триоль уходит во второй такт целиком,
      // НЕ дробится (хотя первая её нота 1/6 влезла бы в остаток 1/4).
      const t = Tuplet(3, 2);
      final notes = [
        n('q'), n('q'), n('q'),
        n('q', tuplet: t, start: true),
        n('q', tuplet: t),
        n('q', tuplet: t),
      ];
      final bins = packVoice(notes, 1.0);
      expect(bins.length, 2);
      expect(bins[0].length, 3); // три обычные четверти
      expect(bins[0].every((x) => x.tuplet == null), true);
      expect(bins[1].length, 3); // триоль целиком
      expect(bins[1].every((x) => x.tuplet != null), true);
      expect(bins[1].first.tupletStart, true);
    });

    test('триоль восьмых помещается в такт вместе с другими нотами', () {
      // три четверти (3/4) + триоль восьмых (1/4) = ровно 4/4 -> один такт
      const t = Tuplet(3, 2);
      final notes = [
        n('q'), n('q'), n('q'),
        n('8', tuplet: t, start: true),
        n('8', tuplet: t),
        n('8', tuplet: t),
      ];
      final bins = packVoice(notes, 1.0);
      expect(bins.length, 1);
      expect(bins[0].length, 6);
    });
  });
}
