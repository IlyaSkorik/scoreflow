import 'palette.dart';
import 'score.dart';

/// Раскладывает поток нот одного голоса по тактам так, чтобы сумма
/// длительностей в каждом такте не превышала [capacity] (доля от целой ноты).
///
/// Ноты не расщепляются: если очередная нота не влезает в текущий такт, она
/// целиком переносится в следующий. Нота, чья длительность сама по себе больше
/// размера такта (редкий край), занимает отдельный такт. Всегда возвращает
/// минимум одну (возможно пустую) корзину.
List<List<MusicNote>> packVoice(List<MusicNote> notes, double capacity) {
  final bins = <List<MusicNote>>[];
  var current = <MusicNote>[];
  var sum = 0.0;

  for (final n in notes) {
    final f = noteFraction(n.duration, n.dots);
    if (current.isNotEmpty && sum + f > capacity + 1e-6) {
      bins.add(current);
      current = <MusicNote>[];
      sum = 0;
    }
    current.add(n);
    sum += f;
  }
  if (current.isNotEmpty || bins.isEmpty) bins.add(current);
  return bins;
}

// =====================================================================
//  Каноническая добивка такта паузами
// =====================================================================
//
// Всё считаем в «тиках» = 1/64 целой ноты (целая = 64, четверть = 16).
// Базовые значения от большего к меньшему — нужно для жадного выбора.
const List<List<Object>> _baseTicks = [
  [64, 'w'],
  [32, 'h'],
  [16, 'q'],
  [8, '8'],
  [4, '16'],
  [2, '32'],
  [1, '64'],
];

MusicNote _autoRest(String duration, int dots) =>
    MusicNote(keys: const [], duration: duration, dots: dots, rest: true, auto: true);

/// Заполняет диапазон [pos, pos+len) (в тиках) паузами power-of-two с
/// выравниванием по сильным долям: на каждом шаге берём наибольшее базовое
/// значение, которое (а) влезает и (б) выровнено по позиции (pos % v == 0) —
/// так пауза не пересекает границу более сильной длительности. Если ровно
/// половина значения достраивает остаток — ставим пунктирную паузу
/// (напр. 3/8 -> пунктирная четверть, а не три восьмых).
void _alignedFill(int pos, int len, List<MusicNote> out) {
  while (len > 0) {
    var v = 0;
    var code = '64';
    for (final e in _baseTicks) {
      final tv = e[0] as int;
      if (tv <= len && pos % tv == 0) {
        v = tv;
        code = e[1] as String;
        break;
      }
    }
    if (v == 0) {
      v = 1;
      code = '64';
    }
    final half = v ~/ 2;
    if (half >= 1 && len - v == half) {
      out.add(_autoRest(code, 1)); // пунктирная пауза достраивает ровно
      pos += v + half;
      len -= v + half;
    } else {
      out.add(_autoRest(code, 0));
      pos += v;
      len -= v;
    }
  }
}

/// Каноническая последовательность пауз, добивающая такт от позиции
/// [startFrac] на [remainder] (обе — доли от целой ноты) с учётом размера.
///
/// Для составных размеров (x/8, beats%3==0) добивка идёт по дольным группам
/// (пунктирная четверть на полную пустую долю), внутри неполной доли —
/// power-of-two. Для простых размеров декомпозиция идёт по всему остатку,
/// что естественно даёт половинные/целые и пунктирные паузы.
List<MusicNote> fillRests(
    double startFrac, double remainder, int beats, int beatValue) {
  var rem = (remainder * 64).round();
  var pos = (startFrac * 64).round();
  if (rem <= 0) return const [];

  final out = <MusicNote>[];
  final compound = beatValue == 8 && beats % 3 == 0;
  if (compound) {
    const beat = 24; // пунктирная четверть
    while (rem > 0) {
      final into = pos % beat;
      final toBeat = into == 0 ? beat : beat - into;
      final chunk = rem < toBeat ? rem : toBeat;
      if (into == 0 && chunk == beat) {
        out.add(_autoRest('q', 1)); // целая пустая доля -> пунктирная четверть
      } else {
        _alignedFill(pos, chunk, out);
      }
      pos += chunk;
      rem -= chunk;
    }
  } else {
    _alignedFill(pos, rem, out);
  }
  return out;
}
