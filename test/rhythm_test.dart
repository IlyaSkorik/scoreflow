import 'package:flutter_test/flutter_test.dart';
import 'package:scoreflow/models/palette.dart';
import 'package:scoreflow/models/reflow.dart';
import 'package:scoreflow/models/score.dart';

MusicNote n(String dur, {int dots = 0, bool rest = false}) => MusicNote.fromKeys(
      keys: rest ? const [] : const ['c/4'],
      duration: dur,
      dots: dots,
      rest: rest,
    );

// Удобное представление паузы для проверок: "<dur>" или "<dur>." с точкой.
String tag(MusicNote r) => r.duration + (r.dots > 0 ? '.' * r.dots : '');
List<String> tags(List<MusicNote> rs) => rs.map(tag).toList();

void main() {
  group('noteFraction (точки + новые длительности)', () {
    test('базовые без точек', () {
      expect(noteFraction('w', 0), 1.0);
      expect(noteFraction('32', 0), 0.03125);
      expect(noteFraction('64', 0), 0.015625);
    });

    test('одна точка = base·1.5', () {
      expect(noteFraction('q', 1), 0.375);
      expect(noteFraction('h', 1), 0.75);
      expect(noteFraction('8', 1), 0.1875);
    });

    test('двойная точка = base·1.75 (расширяемость)', () {
      expect(noteFraction('q', 2), 0.4375);
    });
  });

  group('packVoice с дотированными нотами', () {
    test('две пунктирные половинные не влезают в 4/4', () {
      final bins = packVoice([n('h', dots: 1), n('h', dots: 1)], 1.0);
      expect(bins.length, 2);
    });

    test('пунктирная четверть + восьмая = одна доля группы', () {
      // qd(0.375) + 8(0.125) + h(0.5) = 1.0 -> один такт
      final bins = packVoice([n('q', dots: 1), n('8'), n('h')], 1.0);
      expect(bins.length, 1);
      expect(bins.first.length, 3);
    });
  });

  group('fillRests — каноническая добивка', () {
    test('не хватает четверти (4/4) -> четвертная пауза', () {
      // заполнено q+q+q = 0.75, остаток 0.25
      expect(tags(fillRests(0.75, 0.25, 4, 4)), ['q']);
    });

    test('остаток 1/2 в начале такта -> половинная пауза', () {
      expect(tags(fillRests(0.0, 0.5, 4, 4)), ['h']);
    });

    test('3/8 на сильной доле -> пунктирная четверть, а не три восьмых', () {
      expect(tags(fillRests(0.5, 0.375, 4, 4)), ['q.']);
    });

    test('3/8 со слабой доли -> восьмая + четверть (без 1/8·3)', () {
      expect(tags(fillRests(0.625, 0.375, 4, 4)), ['8', 'q']);
    });

    test('1/32 c точкой собирается каноном (3 тика)', () {
      // 3/64 = 0.046875 -> пунктирная 1/32
      expect(tags(fillRests(0.0, 0.046875, 4, 4)), ['32.']);
    });

    test('1/64 поддерживается', () {
      expect(tags(fillRests(0.0, 0.015625, 4, 4)), ['64']);
    });

    test('составной 6/8: пустая доля -> пунктирная четверть', () {
      expect(tags(fillRests(0.375, 0.375, 6, 8)), ['q.']);
    });

    test('добитые паузы помечены auto и являются паузами', () {
      final rs = fillRests(0.75, 0.25, 4, 4);
      expect(rs.every((r) => r.rest && r.auto), isTrue);
    });
  });

  group('целостность: сумма добивки точно закрывает остаток', () {
    double sum(List<MusicNote> rs) =>
        rs.fold(0.0, (s, r) => s + noteFraction(r.duration, r.dots));

    for (final tc in [
      [0.75, 0.25, 4, 4],
      [0.0, 0.875, 4, 4],
      [0.125, 0.625, 4, 4],
      [0.375, 0.375, 6, 8],
      [0.0, 0.75, 6, 8],
      [0.25, 0.5, 3, 4],
    ]) {
      test('остаток ${tc[1]} @ ${tc[0]} в ${tc[2]}/${tc[3]}', () {
        final start = tc[0].toDouble();
        final rem = tc[1].toDouble();
        final rs = fillRests(start, rem, tc[2].toInt(), tc[3].toInt());
        expect((sum(rs) - rem).abs() < 1e-9, isTrue);
      });
    }
  });

  group('JSON round-trip с точками', () {
    test('dots сериализуется и читается', () {
      final j = n('q', dots: 1).toJson();
      expect(j['dots'], 1);
      expect(MusicNote.fromJson(j).dots, 1);
    });

    test('без точек поле dots не пишется (компактность)', () {
      expect(n('q').toJson().containsKey('dots'), isFalse);
      expect(MusicNote.fromJson(n('q').toJson()).dots, 0);
    });
  });
}
