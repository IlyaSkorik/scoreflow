import 'palette.dart';
import 'score.dart';

/// РЕАЛЬНОЕ время ноты (доля от целой) с учётом точек И tuplet-соотношения.
/// Базовая длительность масштабируется на [MusicNote.tupletScale]
/// (normal/actual): нота триоли 3:2 занимает 2/3 написанной длительности.
double noteTime(MusicNote n) =>
    noteFraction(n.duration, n.dots) * n.tupletScale;

/// Доля (в ЧЕТВЕРТЯХ) от начала такта до ноты с индексом [index] — реальное
/// смещение онсета с учётом точек/tuplet. Единица совпадает со startBeat
/// playback-компилятора (четверти), поэтому к этому значению привязываются
/// динамические оттенки ([Dynamic.beat]).
double onsetBeats(List<MusicNote> notes, int index) {
  var q = 0.0;
  final n = index < notes.length ? index : notes.length;
  for (var i = 0; i < n; i++) {
    q += noteTime(notes[i]) * 4; // доля от целой -> четверти
  }
  return q;
}

/// Кумулятивные доли (в ЧЕТВЕРТЯХ) начала каждого такта для [count] тактов:
/// starts[0]=0, starts[i]=Σ measureQAt(0..i-1). [measureQAt] — четвертей в такте
/// по ИНДЕКСУ (разный для разных размеров). Зеркало движкового
/// domain/timesig.measureStarts. Возвращает [count]+1 элементов (последний =
/// общая длина), чтобы по нему искать индекс такта по абсолютной доле.
List<double> measureStarts(int count, double Function(int) measureQAt) {
  final out = <double>[0.0];
  var acc = 0.0;
  for (var i = 0; i < count; i++) {
    acc += measureQAt(i);
    out.add(acc);
  }
  return out;
}

/// Индекс такта, в который попадает абсолютная доля [abs] (четверти), по
/// предрассчитанным [starts] (см. [measureStarts]). Клампится в [0, count-1].
int measureIndexAtBeat(List<double> starts, double abs) {
  final count = starts.length - 1;
  if (count <= 0) return 0;
  var idx = 0;
  for (var i = 0; i < count; i++) {
    if (starts[i] <= abs + 1e-9) {
      idx = i;
    } else {
      break;
    }
  }
  return idx;
}

/// Перепривязывает динамические оттенки к НОВОЙ раскладке тактов по АБСОЛЮТНОЙ
/// доле, сохраняя их музыкальную позицию при reflow (как в проф. редакторах:
/// оттенок остаётся на своей доле, даже если ноты переехали в другой такт).
/// МЕТР-ОСОЗНАННАЯ версия: ёмкость такта берётся по индексу из [measureQAt]
/// (четверти), поэтому смены размера не сбивают позиции оттенков.
///
/// [from] — такты ДО перепаковки (источник оттенков и их абсолютных позиций),
/// [to] — НОВЫЕ такты (их списки оттенков очищаются и заполняются заново).
/// Смены размера — ПОЗИЦИОННЫЕ якоря по индексу такта (не двигаются при reflow),
/// поэтому одна и та же [measureQAt] описывает и старую, и новую раскладку.
void reflowDynamicsVariable(
    List<Measure> from, List<Measure> to, double Function(int) measureQAt) {
  for (final m in to) {
    m.dynamics.clear();
  }
  if (to.isEmpty) return;
  final fromStarts = measureStarts(from.length, measureQAt);
  final toStarts = measureStarts(to.length, measureQAt);
  for (var mi = 0; mi < from.length; mi++) {
    final base = fromStarts[mi];
    from[mi].dynamics.forEach((voice, list) {
      for (final d in list) {
        final abs = base + d.beat;
        final idx = measureIndexAtBeat(toStarts, abs);
        final local = abs - toStarts[idx];
        final dest = to[idx].dynamicsOf(voice);
        dest.removeWhere((e) => (e.beat - local).abs() < 1e-6);
        dest.add(Dynamic(mark: d.mark, voice: voice, beat: local));
        dest.sort((a, b) => a.beat.compareTo(b.beat));
      }
    });
  }
}

/// Перепривязывает ВИЛКИ (crescendo/diminuendo) к НОВОЙ раскладке тактов по
/// АБСОЛЮТНЫМ долям ОБОИХ концов — так же, как [reflowDynamicsVariable] для
/// оттенков (вилка РАСШИРЯЕТ динамику и живёт в том же музыкальном времени).
/// Оба конца (начало вилки на её такте-контейнере + [Hairpin.endMeasure]/endBeat)
/// переводятся в абсолютные четверти по [from], затем раскладываются по [to];
/// вилка кладётся на новый такт-начало с пересчитанными долями и endMeasure.
/// Смены размера — позиционные якоря по индексу, поэтому одна [measureQAt]
/// описывает и старую, и новую раскладку.
void reflowHairpinsVariable(
    List<Measure> from, List<Measure> to, double Function(int) measureQAt) {
  for (final m in to) {
    m.hairpins.clear();
  }
  if (to.isEmpty) return;
  final fromStarts = measureStarts(from.length, measureQAt);
  final toStarts = measureStarts(to.length, measureQAt);
  for (var mi = 0; mi < from.length; mi++) {
    for (final h in from[mi].hairpins) {
      final em = h.endMeasure < from.length ? h.endMeasure : from.length - 1;
      final absStart = fromStarts[mi] + h.startBeat;
      final absEnd = fromStarts[em] + h.endBeat;
      final ns = measureIndexAtBeat(toStarts, absStart);
      final ne = measureIndexAtBeat(toStarts, absEnd);
      to[ns].hairpins.add(Hairpin(
        type: h.type,
        voice: h.voice,
        startBeat: absStart - toStarts[ns],
        endMeasure: ne,
        endBeat: absEnd - toStarts[ne],
      ));
    }
  }
}

/// Перепривязка оттенков при ЕДИНОМ размере по всей партитуре (обратная
/// совместимость): [measureQ] — четвертей в такте, одинаково для всех тактов.
/// Тонкая обёртка над [reflowDynamicsVariable] — без дублирования логики.
void reflowDynamics(List<Measure> from, List<Measure> to, double measureQ) {
  if (measureQ <= 0) {
    for (final m in to) {
      m.dynamics.clear();
    }
    return;
  }
  reflowDynamicsVariable(from, to, (_) => measureQ);
}

/// Разбивает поток нот одного голоса на «чанки» — неделимые при раскладке
/// единицы: одиночная нота вне tuplet, либо ЦЕЛАЯ tuplet-группа. Группа —
/// непрерывный ряд нот с одинаковым соотношением, начинающийся с [tupletStart].
/// Так tuplet никогда не дробится через границу такта.
List<List<MusicNote>> tupletChunks(List<MusicNote> notes) {
  final chunks = <List<MusicNote>>[];
  var i = 0;
  while (i < notes.length) {
    final n = notes[i];
    if (n.tuplet == null) {
      chunks.add([n]);
      i++;
      continue;
    }
    // Старт группы: текущая нота. Включаем последующие ноты того же
    // соотношения, пока не встретим новый tupletStart / смену / выход из tuplet.
    final group = <MusicNote>[n];
    final t = n.tuplet!;
    var j = i + 1;
    while (j < notes.length) {
      final m = notes[j];
      if (m.tuplet == null ||
          m.tupletStart ||
          m.tuplet!.actualNotes != t.actualNotes ||
          m.tuplet!.normalNotes != t.normalNotes) {
        break;
      }
      group.add(m);
      j++;
    }
    chunks.add(group);
    i = j;
  }
  return chunks;
}

/// Раскладывает поток нот одного голоса по тактам так, чтобы сумма РЕАЛЬНЫХ
/// длительностей в каждом такте не превышала ёмкости ЭТОГО такта.
/// МЕТР-ОСОЗНАННАЯ версия: ёмкость берётся по индексу корзины из [capacityAt]
/// (доля от целой ноты — 4/4 → 1.0, 7/8 → 0.875), поэтому смены размера задают
/// разную вместимость каждому такту. Глобального размера здесь нет.
///
/// Единица переноса — «чанк» (см. [tupletChunks]): одиночная нота или целая
/// tuplet-группа. Чанк не расщепляется: если не влезает в текущий такт —
/// целиком переносится в следующий (где ёмкость уже соответствует его индексу).
/// Чанк, чья длительность сама по себе больше размера такта (редкий край),
/// занимает отдельный такт. Всегда возвращает минимум одну (возможно пустую)
/// корзину.
List<List<MusicNote>> packVoiceVariable(
    List<MusicNote> notes, double Function(int) capacityAt) {
  final bins = <List<MusicNote>>[];
  var current = <MusicNote>[];
  var sum = 0.0;

  for (final chunk in tupletChunks(notes)) {
    final f = chunk.fold<double>(0, (s, n) => s + noteTime(n));
    if (current.isNotEmpty && sum + f > capacityAt(bins.length) + 1e-6) {
      bins.add(current);
      current = <MusicNote>[];
      sum = 0;
    }
    current.addAll(chunk);
    sum += f;
  }
  if (current.isNotEmpty || bins.isEmpty) bins.add(current);
  return bins;
}

/// Раскладка при ЕДИНОМ размере по всей партитуре (обратная совместимость):
/// [capacity] — доля от целой ноты, одинаково для всех тактов. Тонкая обёртка
/// над [packVoiceVariable] — без дублирования логики упаковки.
List<List<MusicNote>> packVoice(List<MusicNote> notes, double capacity) =>
    packVoiceVariable(notes, (_) => capacity);

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
    MusicNote(pitches: const [], duration: duration, dots: dots, rest: true, auto: true);

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
