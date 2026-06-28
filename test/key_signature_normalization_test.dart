import 'package:flutter_test/flutter_test.dart';
import 'package:scoreflow/models/keysig.dart';
import 'package:scoreflow/models/score.dart';

/// Тесты нормализации локальных альтераций при смене тональности. Избыточный
/// знак (дающий ту же высоту, что и тональность/унаследованный знак такта)
/// удаляется; значимый — сохраняется. Звучащая высота не меняется.
Pitch p(String step, int octave, [Accidental acc = Accidental.none]) =>
    Pitch(step: step, octave: octave, accidental: acc);

MusicNote note(List<Pitch> pitches) =>
    MusicNote(pitches: pitches, duration: 'q');

List<Accidental> accidentalsOf(List<MusicNote> notes) =>
    [for (final n in notes) for (final pt in n.pitches) pt.accidental];

void main() {
  group('keyAlterations (mirror of engine)', () {
    test('C -> empty', () => expect(keyAlterations('C'), <String, int>{}));
    test('G -> f#', () => expect(keyAlterations('G'), {'f': 1}));
    test('D -> f#,c#', () => expect(keyAlterations('D'), {'f': 1, 'c': 1}));
    test('Bb -> bb,eb', () => expect(keyAlterations('Bb'), {'b': -1, 'e': -1}));
    test('unknown -> empty', () => expect(keyAlterations('???'), <String, int>{}));
  });

  group('normalizeMeasureAccidentals', () {
    test('explicit sharp matching the key is removed', () {
      // F# в G-dur (тональность уже даёт F#) -> знак избыточен.
      final notes = [note([p('f', 4, Accidental.sharp)])];
      normalizeMeasureAccidentals(notes, keyAlterations('G'));
      expect(notes.first.pitches.first.accidental, Accidental.none);
    });

    test('explicit natural matching C major is removed', () {
      final notes = [note([p('f', 4, Accidental.natural)])];
      normalizeMeasureAccidentals(notes, keyAlterations('C'));
      expect(notes.first.pitches.first.accidental, Accidental.none);
    });

    test('accidental that still alters relative to the key is kept', () {
      // F# в F-dur (Bb, без F#) -> всё ещё меняет звук -> сохраняется.
      final notes = [note([p('f', 4, Accidental.sharp)])];
      normalizeMeasureAccidentals(notes, keyAlterations('F'));
      expect(notes.first.pitches.first.accidental, Accidental.sharp);
    });

    test('natural cancelling a key sharp is kept', () {
      // F-натурал в G-dur отменяет диез тональности -> сохраняется.
      final notes = [note([p('f', 4, Accidental.natural)])];
      normalizeMeasureAccidentals(notes, keyAlterations('G'));
      expect(notes.first.pitches.first.accidental, Accidental.natural);
    });

    test('double sharp is never collapsed by a single-sharp key', () {
      final notes = [note([p('f', 4, Accidental.doubleSharp)])];
      normalizeMeasureAccidentals(notes, keyAlterations('G'));
      expect(notes.first.pitches.first.accidental, Accidental.doubleSharp);
    });

    test('none heads are untouched', () {
      final notes = [note([p('c', 4), p('e', 4)])];
      normalizeMeasureAccidentals(notes, keyAlterations('G'));
      expect(accidentalsOf(notes), [Accidental.none, Accidental.none]);
    });

    test('per-octave: f#5 redundant in G does not affect f4', () {
      final notes = [
        note([p('f', 5, Accidental.sharp)]),
        note([p('f', 4, Accidental.flat)]),
      ];
      normalizeMeasureAccidentals(notes, keyAlterations('G'));
      // f#5 избыточен (G), снят; fb4 значим (≠ ключ), сохранён.
      expect(notes[0].pitches.first.accidental, Accidental.none);
      expect(notes[1].pitches.first.accidental, Accidental.flat);
    });

    test('in-measure carry: explicit sharp after a kept natural is preserved', () {
      // G-dur. Такт: F-натурал (значим, сохранён, действует до конца такта),
      // затем F# — без знака он унаследовал бы натурал -> прозвучал бы F, не F#.
      // Поэтому диез ОБЯЗАН сохраниться (звук неизменен).
      final notes = [
        note([p('f', 4, Accidental.natural)]),
        note([p('f', 4, Accidental.sharp)]),
      ];
      normalizeMeasureAccidentals(notes, keyAlterations('G'));
      expect(notes[0].pitches.first.accidental, Accidental.natural);
      expect(notes[1].pitches.first.accidental, Accidental.sharp);
    });

    test('redundant natural after a sharp in C major is kept (cancels carry)', () {
      // C-dur. F# (значим, сохранён), затем F-натурал: без знака унаследовал бы
      // диез такта -> F#. Натурал нужен, чтобы прозвучал F -> сохраняется.
      final notes = [
        note([p('f', 4, Accidental.sharp)]),
        note([p('f', 4, Accidental.natural)]),
      ];
      normalizeMeasureAccidentals(notes, keyAlterations('C'));
      expect(notes[0].pitches.first.accidental, Accidental.sharp);
      expect(notes[1].pitches.first.accidental, Accidental.natural);
    });
  });

  group('normalizeAccidentalsFrom (range)', () {
    Measure m(List<Pitch> trebleHeads, {String? key}) => Measure(
          {
            'treble': [note(trebleHeads)],
            'bass': <MusicNote>[],
          },
          keySignature: key,
        );

    Score score(List<Measure> measures, {String key = 'C'}) => Score(
          id: 's',
          title: 'T',
          instrument: InstrumentType.piano,
          keySignature: key,
          measures: measures,
          createdAt: DateTime(2026),
          updatedAt: DateTime(2026),
        );

    test('normalizes only measures sharing the changed key block', () {
      // Такт 0: G (старт). Такт 1: смена на D. Такт 2: смена на C.
      // Нормализация от такта 1 затрагивает только такт 1 (до следующей смены).
      final s = score([
        m([p('f', 4, Accidental.sharp)]),
        m([p('f', 4, Accidental.sharp)], key: 'D'),
        m([p('f', 4, Accidental.sharp)], key: 'C'),
      ], key: 'G');
      normalizeAccidentalsFrom(s, 1);
      // Такт 1 (D-dur, F# в ключе): знак снят.
      expect(s.measures[1].voice('treble').first.pitches.first.accidental,
          Accidental.none);
      // Такт 0 (другой блок) и такт 2 (C-dur, F# значим) не тронуты.
      expect(s.measures[0].voice('treble').first.pitches.first.accidental,
          Accidental.sharp);
      expect(s.measures[2].voice('treble').first.pitches.first.accidental,
          Accidental.sharp);
    });

    test('drums score is a no-op', () {
      final s = Score(
        id: 'd',
        title: 'D',
        instrument: InstrumentType.drums,
        measures: [
          Measure({
            'perc': [note(const [Pitch(step: 'f', octave: 4, head: 'x2')])],
          }),
        ],
        createdAt: DateTime(2026),
        updatedAt: DateTime(2026),
      );
      normalizeAccidentalsFrom(s, 0); // не бросает, ничего не меняет
      expect(s.measures.first.voice('perc').first.pitches.first.head, 'x2');
    });
  });
}
