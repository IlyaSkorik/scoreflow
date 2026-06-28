import 'score.dart';

/// Нормализация локальных альтераций при смене тональности.
///
/// Теория высоты (круг квинт -> сдвиг ступени) здесь — ЗЕРКАЛО движкового
/// `assets/www/js/domain/keysig.js` (keySignatureAlterations): значения
/// синхронизированы и закреплены тестами. РЕАЛЬНАЯ (звучащая) высота по-прежнему
/// разрешается в ОДНОМ месте — playback-компиляторе движка. Здесь — РЕДАКТОРСКАЯ
/// операция над ЗАПИСЬЮ (какие знаки рисовать), а не расчёт звука: она лишь
/// удаляет ИЗБЫТОЧНЫЕ глифы, не меняя ни одной звучащей высоты.

// Порядок появления диезов и бемолей (круг квинт) — как в движке.
const List<String> _sharpOrder = ['f', 'c', 'g', 'd', 'a', 'e', 'b'];
const List<String> _flatOrder = ['b', 'e', 'a', 'd', 'g', 'c', 'f'];

// Число знаков мажорной тональности (имя VexFlow): >0 диезы, <0 бемоли.
const Map<String, int> _keyFifths = {
  'C': 0,
  'G': 1, 'D': 2, 'A': 3, 'E': 4, 'B': 5, 'F#': 6, 'C#': 7,
  'F': -1, 'Bb': -2, 'Eb': -3, 'Ab': -4, 'Db': -5, 'Gb': -6, 'Cb': -7,
};

/// Имя тональности -> { ступень: сдвиг }. Ступени без знака отсутствуют в карте
/// (для них сдвиг 0). Неизвестное имя -> C-dur (пустая карта). Зеркало движка.
Map<String, int> keyAlterations(String name) {
  final fifths = _keyFifths[name] ?? 0;
  final alt = <String, int>{};
  if (fifths > 0) {
    for (var i = 0; i < fifths; i++) {
      alt[_sharpOrder[i]] = 1;
    }
  } else if (fifths < 0) {
    for (var i = 0; i < -fifths; i++) {
      alt[_flatOrder[i]] = -1;
    }
  }
  return alt;
}

/// Нормализует записанные альтерации одного голоса такта под тональность
/// [keyAlt] (ступень -> сдвиг). Проход СЛЕВА НАПРАВО повторяет разрешение знаков
/// такта движка: знак привязан к (ступень+октава) и действует до конца такта.
///
/// Явный знак УДАЛЯЕТСЯ (становится [Accidental.none]), если без него высота
/// осталась бы той же — то есть его сдвиг совпадает с действующим контекстом:
/// либо унаследованным знаком такта на этой высоте, либо (если его не было)
/// тональностью. Иначе знак СОХРАНЯЕТСЯ (он всё ещё меняет звучание — напр.
/// бекар, отменяющий диез тональности, или знак, отменяющий ранний знак такта).
///
/// Звучащая высота КАЖДОЙ ноты при этом не меняется: удаляются лишь избыточные
/// глифы. [Accidental.none]-головки не трогаются (следуют контексту) и не
/// устанавливают контекст — ровно как в компиляторе. Головки ударных (с [head])
/// пропускаются (у перкуссии нет тональности).
void normalizeMeasureAccidentals(
    List<MusicNote> notes, Map<String, int> keyAlt) {
  final state = <String, int>{}; // (ступень+октава) -> сдвиг сохранённого знака
  for (final n in notes) {
    if (n.rest) continue;
    var changed = false;
    final out = <Pitch>[];
    for (final p in n.pitches) {
      if (!p.accidental.isExplicit || p.head != null) {
        out.add(p); // none / ударные — не трогаем и контекст не задаём
        continue;
      }
      final slot = '${p.step}${p.octave}';
      final written = p.accidental.semitoneShift;
      final ctx = state.containsKey(slot) ? state[slot]! : (keyAlt[p.step] ?? 0);
      if (written == ctx) {
        // Избыточен: без знака высота та же -> удаляем глиф. Нота становится
        // «читателем» контекста (контекст НЕ переустанавливаем) — как none.
        out.add(p.withAccidental(Accidental.none));
        changed = true;
      } else {
        // Сохраняем: знак реально меняет звучание -> он «устанавливает»
        // контекст такта на этой высоте (для последующих нот).
        state[slot] = written;
        out.add(p);
      }
    }
    if (changed) n.pitches = out;
  }
}

/// Нормализует альтерации во всех тактах, разделяющих действующую тональность,
/// которая начинается с такта [from] (т.е. от [from] до следующего такта с
/// собственной сменой тональности). Вызывается редактором ПОСЛЕ смены
/// тональности. Для ударных неприменимо (у перкуссии нет тональности).
void normalizeAccidentalsFrom(Score score, int from) {
  if (score.instrument == InstrumentType.drums) return;
  if (from < 0 || from >= score.measures.length) return;
  final keyAlt = keyAlterations(score.effectiveKeySignatureAt(from));
  for (var i = from; i < score.measures.length; i++) {
    // Следующий такт с собственной сменой открывает другой тональный блок —
    // его этой сменой не задело, останавливаемся.
    if (i > from && score.measures[i].keySignature != null) break;
    final m = score.measures[i];
    for (final v in score.instrument.voiceIds) {
      normalizeMeasureAccidentals(m.voice(v), keyAlt);
    }
  }
}
