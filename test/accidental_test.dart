import 'package:flutter_test/flutter_test.dart';
import 'package:scoreflow/models/reflow.dart';
import 'package:scoreflow/models/score.dart';

// Тесты профессиональной системы альтераций (Accidental / Pitch).
//
// Реальная (звучащая) высота считается в ОДНОМ месте — playback-компиляторе
// движка (assets/www/js): тональность + знак + правила такта. Эти музыкальные
// правила (keysig interaction, natural cancellation, measure reset, double
// sharp/flat) проверяются JS-тестом test/js/accidental_resolver.test.mjs
// (node). Здесь покрываем модель Dart и КОНТРАКТ с движком: round-trip,
// equality, copy, reflow/undo-сохранность и точное кодирование natural-aware
// ключей VexFlow, которые потребляет резолвер.

Score _score({String key = 'C', required List<MusicNote> treble}) => Score(
      id: 'x',
      title: 't',
      instrument: InstrumentType.piano,
      keySignature: key,
      createdAt: DateTime(2026),
      updatedAt: DateTime(2026),
      measures: [
        Measure({'treble': treble, 'bass': <MusicNote>[]}),
      ],
    );

void main() {
  group('Accidental enum', () {
    test('semitoneShift', () {
      expect(Accidental.none.semitoneShift, 0);
      expect(Accidental.natural.semitoneShift, 0);
      expect(Accidental.sharp.semitoneShift, 1);
      expect(Accidental.flat.semitoneShift, -1);
      expect(Accidental.doubleSharp.semitoneShift, 2);
      expect(Accidental.doubleFlat.semitoneShift, -2);
    });

    test('isExplicit — только none неявный', () {
      expect(Accidental.none.isExplicit, isFalse);
      expect(Accidental.natural.isExplicit, isTrue);
      expect(Accidental.sharp.isExplicit, isTrue);
      expect(Accidental.doubleFlat.isExplicit, isTrue);
    });

    test('vexSuffix', () {
      expect(Accidental.none.vexSuffix, '');
      expect(Accidental.natural.vexSuffix, 'n');
      expect(Accidental.sharp.vexSuffix, '#');
      expect(Accidental.flat.vexSuffix, 'b');
      expect(Accidental.doubleSharp.vexSuffix, '##');
      expect(Accidental.doubleFlat.vexSuffix, 'bb');
    });

    test('id <-> fromId round-trip', () {
      for (final a in Accidental.values) {
        expect(Accidental.fromId(a.id), a);
      }
      expect(Accidental.fromId('garbage'), Accidental.none);
      expect(Accidental.fromId(null), Accidental.none);
    });

    test('fromVexSuffix', () {
      expect(Accidental.fromVexSuffix('#'), Accidental.sharp);
      expect(Accidental.fromVexSuffix('b'), Accidental.flat);
      expect(Accidental.fromVexSuffix('##'), Accidental.doubleSharp);
      expect(Accidental.fromVexSuffix('bb'), Accidental.doubleFlat);
      expect(Accidental.fromVexSuffix('n'), Accidental.natural);
      expect(Accidental.fromVexSuffix(''), Accidental.none);
    });
  });

  group('Pitch', () {
    test('vexKey — natural-aware кодирование для всех знаков', () {
      expect(const Pitch(step: 'f', octave: 4).vexKey, 'f/4');
      expect(
          const Pitch(step: 'f', octave: 4, accidental: Accidental.natural)
              .vexKey,
          'fn/4');
      expect(
          const Pitch(step: 'f', octave: 4, accidental: Accidental.sharp).vexKey,
          'f#/4');
      expect(
          const Pitch(step: 'e', octave: 4, accidental: Accidental.flat).vexKey,
          'eb/4');
      expect(
          const Pitch(step: 'f', octave: 4, accidental: Accidental.doubleSharp)
              .vexKey,
          'f##/4');
      expect(
          const Pitch(step: 'e', octave: 4, accidental: Accidental.doubleFlat)
              .vexKey,
          'ebb/4');
      // Ударные: головка как 3-й сегмент сохраняется.
      expect(const Pitch(step: 'g', octave: 5, head: 'x2').vexKey, 'g/5/x2');
    });

    test('fromVexKey — миграция legacy ключей', () {
      expect(Pitch.fromVexKey('c#/4'),
          const Pitch(step: 'c', octave: 4, accidental: Accidental.sharp));
      expect(Pitch.fromVexKey('cb/3'),
          const Pitch(step: 'c', octave: 3, accidental: Accidental.flat));
      expect(Pitch.fromVexKey('fn/4'),
          const Pitch(step: 'f', octave: 4, accidental: Accidental.natural));
      expect(Pitch.fromVexKey('c##/4'),
          const Pitch(step: 'c', octave: 4, accidental: Accidental.doubleSharp));
      expect(Pitch.fromVexKey('ebb/4'),
          const Pitch(step: 'e', octave: 4, accidental: Accidental.doubleFlat));
      expect(Pitch.fromVexKey('c/4'), const Pitch(step: 'c', octave: 4));
      expect(Pitch.fromVexKey('g/5/x2'),
          const Pitch(step: 'g', octave: 5, head: 'x2'));
    });

    test('vexKey <-> fromVexKey round-trip', () {
      const ps = [
        Pitch(step: 'c', octave: 4),
        Pitch(step: 'c', octave: 4, accidental: Accidental.sharp),
        Pitch(step: 'c', octave: 4, accidental: Accidental.flat),
        Pitch(step: 'c', octave: 4, accidental: Accidental.natural),
        Pitch(step: 'c', octave: 4, accidental: Accidental.doubleSharp),
        Pitch(step: 'c', octave: 4, accidental: Accidental.doubleFlat),
        Pitch(step: 'g', octave: 5, head: 'x2'),
      ];
      for (final p in ps) {
        expect(Pitch.fromVexKey(p.vexKey), p, reason: p.vexKey);
      }
    });

    test('equality и hashCode', () {
      // Не const — иначе анализатор статически видит равные литералы в Set.
      final a = Pitch(
          step: 'c', octave: 4, accidental: Accidental.values[2]); // sharp
      const b = Pitch(step: 'c', octave: 4, accidental: Accidental.sharp);
      const c = Pitch(step: 'c', octave: 4, accidental: Accidental.flat);
      expect(a, b);
      expect(a.hashCode, b.hashCode);
      expect(a == c, isFalse);
      expect({a, b, c}.length, 2); // a==b в Set'е схлопываются по ==/hashCode
    });

    test('copy / withAccidental', () {
      const p = Pitch(step: 'c', octave: 4, accidental: Accidental.sharp);
      expect(p.copy(), p);
      expect(p.withAccidental(Accidental.flat),
          const Pitch(step: 'c', octave: 4, accidental: Accidental.flat));
      // withAccidental не трогает ступень/октаву/головку
      const d = Pitch(step: 'g', octave: 5, head: 'x2');
      expect(d.withAccidental(Accidental.sharp).head, 'x2');
    });

    test('toJson / fromJson round-trip знаков', () {
      for (final a in Accidental.values) {
        final p = Pitch(step: 'd', octave: 5, accidental: a);
        expect(Pitch.fromJson(p.toJson()), p, reason: a.name);
      }
      // none НЕ пишет ключ 'acc' (лаконичный JSON), но читается обратно.
      expect(const Pitch(step: 'd', octave: 5).toJson().containsKey('acc'),
          isFalse);
    });

    test('rank упорядочивает головки аккорда снизу вверх', () {
      const c4 = Pitch(step: 'c', octave: 4);
      const e4 = Pitch(step: 'e', octave: 4);
      const g4 = Pitch(step: 'g', octave: 4);
      expect(c4.rank < e4.rank, isTrue);
      expect(e4.rank < g4.rank, isTrue);
      // диез поднимает ранг
      expect(
          const Pitch(step: 'c', octave: 4, accidental: Accidental.sharp).rank >
              c4.rank,
          isTrue);
    });
  });

  group('MusicNote сериализация', () {
    test('toJson хранит структурные pitches; round-trip сохраняет знак', () {
      final n = MusicNote(
        pitches: const [
          Pitch(step: 'e', octave: 4, accidental: Accidental.flat),
        ],
        duration: 'q',
      );
      final j = n.toJson();
      expect(j['pitches'], isA<List>());
      final back = MusicNote.fromJson(j);
      expect(back.pitches.single.accidental, Accidental.flat);
      expect(back.pitches.single.step, 'e');
    });

    test('fromJson мигрирует legacy keys-строки', () {
      final legacy = {
        'keys': ['c#/4', 'eb/4'],
        'duration': 'h',
        'rest': false,
      };
      final n = MusicNote.fromJson(legacy);
      expect(n.pitches[0].accidental, Accidental.sharp);
      expect(n.pitches[1].accidental, Accidental.flat);
    });

    test('toRenderJson отдаёт natural-aware ключи VexFlow для движка', () {
      final n = MusicNote(
        pitches: const [
          Pitch(step: 'f', octave: 4), // none -> по тональности
          Pitch(step: 'f', octave: 4, accidental: Accidental.natural),
          Pitch(step: 'c', octave: 4, accidental: Accidental.doubleSharp),
        ],
        duration: 'q',
      );
      expect(n.toRenderJson()['keys'], ['f/4', 'fn/4', 'c##/4']);
    });

    test('chords: per-notehead знаки сохраняются (round-trip)', () {
      final chord = MusicNote(
        pitches: const [
          Pitch(step: 'c', octave: 4), // натуральная
          Pitch(step: 'e', octave: 4, accidental: Accidental.flat),
          Pitch(step: 'g', octave: 4, accidental: Accidental.sharp),
        ],
        duration: 'h',
      );
      final back = MusicNote.fromJson(chord.toJson());
      expect(back.pitches.map((p) => p.accidental).toList(),
          [Accidental.none, Accidental.flat, Accidental.sharp]);
    });

    test('copy() сохраняет знаки аккорда', () {
      final chord = MusicNote(
        pitches: const [
          Pitch(step: 'c', octave: 4, accidental: Accidental.doubleSharp),
          Pitch(step: 'e', octave: 4, accidental: Accidental.doubleFlat),
        ],
        duration: 'q',
      );
      final c = chord.copy();
      c.pitches[0] = c.pitches[0].withAccidental(Accidental.none);
      // копия независима, оригинал не затронут
      expect(chord.pitches[0].accidental, Accidental.doubleSharp);
      expect(chord.pitches[1].accidental, Accidental.doubleFlat);
    });
  });

  group('Score round-trip / copy / undo', () {
    test('encode/decode сохраняет знаки (в т.ч. тональность и аккорд)', () {
      final s = _score(key: 'D', treble: [
        MusicNote(pitches: const [
          Pitch(step: 'f', octave: 4, accidental: Accidental.natural),
        ], duration: 'q'),
        MusicNote(pitches: const [
          Pitch(step: 'c', octave: 4),
          Pitch(step: 'e', octave: 4, accidental: Accidental.flat),
        ], duration: 'q', tieToNext: true),
      ]);
      final back = Score.decode(s.encode());
      final notes = back.measures.first.voice('treble');
      expect(back.keySignature, 'D');
      expect(notes[0].pitches.single.accidental, Accidental.natural);
      expect(notes[1].pitches[1].accidental, Accidental.flat);
      expect(notes[1].tieToNext, isTrue);
    });

    test('copy() (снимок Undo/Redo) сохраняет знаки', () {
      final s = _score(treble: [
        MusicNote(pitches: const [
          Pitch(step: 'g', octave: 4, accidental: Accidental.sharp),
        ], duration: 'q'),
      ]);
      final c = s.copy();
      // мутируем копию — оригинал не затронут (независимость снимка)
      c.measures.first.voice('treble').first.pitches = const [
        Pitch(step: 'g', octave: 4),
      ];
      expect(s.measures.first.voice('treble').first.pitches.single.accidental,
          Accidental.sharp);
    });

    test('tuplet-нота сохраняет знак через round-trip', () {
      final s = _score(treble: [
        MusicNote(
          pitches: const [
            Pitch(step: 'f', octave: 4, accidental: Accidental.sharp),
          ],
          duration: '8',
          tuplet: const Tuplet(3, 2),
          tupletStart: true,
        ),
      ]);
      final back = Score.decode(s.encode());
      final n = back.measures.first.voice('treble').first;
      expect(n.pitches.single.accidental, Accidental.sharp);
      expect(n.tuplet?.actualNotes, 3);
      expect(n.tupletStart, isTrue);
    });
  });

  group('Reflow preservation', () {
    test('packVoice сохраняет знаки альтерации на нотах', () {
      final notes = [
        MusicNote(pitches: const [
          Pitch(step: 'c', octave: 4, accidental: Accidental.sharp),
        ], duration: 'q'),
        MusicNote(pitches: const [
          Pitch(step: 'e', octave: 4, accidental: Accidental.flat),
        ], duration: 'q'),
        MusicNote(pitches: const [
          Pitch(step: 'g', octave: 4, accidental: Accidental.natural),
        ], duration: 'q'),
      ];
      final bins = packVoice(notes, 1.0); // 4/4 -> capacity 1.0 (целая)
      final flat = bins.expand((b) => b).where((n) => !n.rest).toList();
      expect(flat[0].pitches.single.accidental, Accidental.sharp);
      expect(flat[1].pitches.single.accidental, Accidental.flat);
      expect(flat[2].pitches.single.accidental, Accidental.natural);
    });
  });
}
