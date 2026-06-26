import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:scoreflow/models/reflow.dart';
import 'package:scoreflow/models/score.dart';

void main() {
  group('Модель лиг — раздельные сущности Tie/Slur', () {
    test('по умолчанию все флаги выключены', () {
      final n = MusicNote.fromKeys(keys: const ['c/4'], duration: 'q');
      expect(n.tieToNext, false);
      expect(n.slurStart, false);
      expect(n.slurStop, false);
    });

    test('toJson сериализует только выставленные флаги', () {
      final plain = MusicNote.fromKeys(keys: const ['c/4'], duration: 'q').toJson();
      expect(plain.containsKey('tieToNext'), false);
      expect(plain.containsKey('slurStart'), false);
      expect(plain.containsKey('slurStop'), false);

      final tied = MusicNote.fromKeys(keys: const ['c/4'], duration: 'q', tieToNext: true)
          .toJson();
      expect(tied['tieToNext'], true);
      expect(tied.containsKey('slurStart'), false);
    });

    test('round-trip toJson/fromJson сохраняет каждый флаг независимо', () {
      final src = MusicNote.fromKeys(
        keys: const ['c/4'],
        duration: 'h',
        tieToNext: true,
        slurStart: true,
        slurStop: false,
      );
      final back = MusicNote.fromJson(
          jsonDecode(jsonEncode(src.toJson())) as Map<String, dynamic>);
      expect(back.tieToNext, true);
      expect(back.slurStart, true);
      expect(back.slurStop, false);
    });

    test('copy() копирует флаги лиг (важно для snapshot-Undo)', () {
      final src = MusicNote.fromKeys(
        keys: const ['c/4'],
        duration: 'q',
        tieToNext: true,
        slurStop: true,
      );
      final c = src.copy();
      expect(c.tieToNext, true);
      expect(c.slurStart, false);
      expect(c.slurStop, true);
      // независимость копии
      c.tieToNext = false;
      expect(src.tieToNext, true);
    });

    test('Tie и Slur не делят одно поле — независимое переключение', () {
      final n = MusicNote.fromKeys(keys: const ['c/4'], duration: 'q');
      n.tieToNext = true;
      expect(n.slurStart, false);
      expect(n.slurStop, false);
      n
        ..tieToNext = false
        ..slurStart = true;
      expect(n.tieToNext, false);
      expect(n.slurStart, true);
    });
  });

  group('Reflow сохраняет флаги лиг', () {
    test('tieToNext переживает перепаковку через границу такта', () {
      // h(tie) + h + q  в 4/4: первый такт h+h, q уходит в следующий.
      final first =
          MusicNote.fromKeys(keys: const ['c/4'], duration: 'h', tieToNext: true);
      final second = MusicNote.fromKeys(keys: const ['c/4'], duration: 'h');
      final third = MusicNote.fromKeys(keys: const ['c/4'], duration: 'q');
      final bins = packVoice([first, second, third], 1.0); // 4/4

      expect(bins.length, 2);
      // флаг остался на том же объекте, на первой ноте первого такта
      expect(bins[0].first.tieToNext, true);
      expect(identical(bins[0].first, first), true);
      // прочие ноты не «нахватали» флагов
      expect(bins[0][1].tieToNext, false);
      expect(bins[1].first.tieToNext, false);
    });

    test('slurStart/slurStop остаются на нотах-концах после упаковки', () {
      final a = MusicNote.fromKeys(keys: const ['c/4'], duration: 'q', slurStart: true);
      final b = MusicNote.fromKeys(keys: const ['d/4'], duration: 'q');
      final c = MusicNote.fromKeys(keys: const ['e/4'], duration: 'q');
      final d = MusicNote.fromKeys(keys: const ['f/4'], duration: 'q', slurStop: true);
      final e = MusicNote.fromKeys(keys: const ['g/4'], duration: 'q'); // -> новый такт
      final bins = packVoice([a, b, c, d, e], 1.0);

      expect(bins.length, 2);
      expect(bins[0].first.slurStart, true);
      expect(bins[0].last.slurStop, true);
      expect(identical(bins[0].first, a), true);
      expect(identical(bins[0].last, d), true);
    });
  });
}
