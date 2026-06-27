import 'package:flutter_test/flutter_test.dart';
import 'package:scoreflow/models/reflow.dart';
import 'package:scoreflow/models/score.dart';

// Тесты профессиональной системы динамики (DynamicMark / Dynamic).
//
// Громкость (velocity) playback разрешается в ОДНОМ месте — playback-компиляторе
// движка (assets/www/js): активный оттенок -> velocity события. Музыкальные
// правила разрешения (действие до следующего знака, независимость голосов,
// tie-merge) проверяет JS-тест test/js/dynamics_resolver.test.mjs (node). Здесь
// покрываем модель Dart и КОНТРАКТ с движком: маппинг громкости, round-trip
// JSON (вкл. зарезервированный ключ _dyn и обратную совместимость), copy()
// (снимок Undo/Redo), сохранность при reflow, привязку к доле ноты (onsetBeats)
// и проекцию для рендера/PDF.

MusicNote _n(String step, {String dur = 'q'}) =>
    MusicNote(pitches: [Pitch(step: step, octave: 4)], duration: dur);

Score _score({required List<MusicNote> treble, List<Dynamic>? dyn}) => Score(
      id: 'x',
      title: 't',
      instrument: InstrumentType.piano,
      createdAt: DateTime(2026),
      updatedAt: DateTime(2026),
      measures: [
        Measure(
          {'treble': treble, 'bass': <MusicNote>[]},
          dynamics: dyn == null ? null : {'treble': dyn},
        ),
      ],
    );

void main() {
  group('DynamicMark', () {
    test('velocity mapping (зеркало DYNAMIC_VELOCITY движка)', () {
      expect(DynamicMark.ppp.velocity, 0.20);
      expect(DynamicMark.pp.velocity, 0.30);
      expect(DynamicMark.p.velocity, 0.45);
      expect(DynamicMark.mp.velocity, 0.60);
      expect(DynamicMark.mf.velocity, 0.75);
      expect(DynamicMark.f.velocity, 0.90);
      expect(DynamicMark.ff.velocity, 1.00);
      expect(DynamicMark.fff.velocity, 1.10);
    });

    test('velocity монотонно возрастает', () {
      final vs = DynamicMark.values.map((m) => m.velocity).toList();
      for (var i = 1; i < vs.length; i++) {
        expect(vs[i] > vs[i - 1], isTrue, reason: DynamicMark.values[i].name);
      }
    });

    test('label = буквы оттенка', () {
      expect(DynamicMark.mf.label, 'mf');
      expect(DynamicMark.ppp.label, 'ppp');
      expect(DynamicMark.fff.label, 'fff');
    });

    test('id <-> fromId round-trip; неизвестное -> mf', () {
      for (final m in DynamicMark.values) {
        expect(DynamicMark.fromId(m.id), m);
      }
      expect(DynamicMark.fromId('garbage'), DynamicMark.mf);
      expect(DynamicMark.fromId(null), DynamicMark.mf);
    });
  });

  group('Dynamic', () {
    test('copy / withMark независимы и сохраняют якорь', () {
      const d = Dynamic(mark: DynamicMark.p, voice: 'treble', beat: 2.0);
      expect(d.copy(), d);
      final w = d.withMark(DynamicMark.ff);
      expect(w.mark, DynamicMark.ff);
      expect(w.voice, 'treble');
      expect(w.beat, 2.0);
    });

    test('equality / hashCode по (mark, voice, beat)', () {
      // a не const — иначе анализатор видит равные литералы в Set (см. ниже).
      final a = Dynamic(mark: DynamicMark.values[5], voice: 'treble', beat: 1);
      const b = Dynamic(mark: DynamicMark.f, voice: 'treble', beat: 1);
      const c = Dynamic(mark: DynamicMark.f, voice: 'bass', beat: 1);
      expect(a, b);
      expect(a.hashCode, b.hashCode);
      expect(a == c, isFalse);
      expect({a, b, c}.length, 2);
    });

    test('toJson не дублирует voice (он — ключ контейнера)', () {
      const d = Dynamic(mark: DynamicMark.mp, voice: 'treble', beat: 1.5);
      final j = d.toJson();
      expect(j, {'mark': 'mp', 'beat': 1.5});
      expect(j.containsKey('voice'), isFalse);
    });

    test('fromJson восстанавливает voice из ключа', () {
      final d = Dynamic.fromJson({'mark': 'ff', 'beat': 3}, voice: 'bass');
      expect(d.mark, DynamicMark.ff);
      expect(d.voice, 'bass');
      expect(d.beat, 3.0);
    });

    test('toRenderJson — метка + доля для движка', () {
      const d = Dynamic(mark: DynamicMark.fff, voice: 'treble', beat: 0);
      expect(d.toRenderJson(), {'mark': 'fff', 'beat': 0});
    });
  });

  group('Measure dynamics — JSON round-trip', () {
    test('toJson пишет _dyn только при наличии оттенков', () {
      final empty = Measure({'treble': [_n('c')], 'bass': []});
      expect(empty.toJson().containsKey('_dyn'), isFalse);

      final m = Measure(
        {'treble': [_n('c')], 'bass': <MusicNote>[]},
        dynamics: {
          'treble': [const Dynamic(mark: DynamicMark.p, voice: 'treble', beat: 0)],
        },
      );
      final j = m.toJson();
      expect(j['_dyn'], {
        'treble': [
          {'mark': 'p', 'beat': 0}
        ]
      });
    });

    test('fromJson(toJson) сохраняет оттенки и не путает их с голосами', () {
      final m = Measure(
        {'treble': [_n('c'), _n('d')], 'bass': <MusicNote>[]},
        dynamics: {
          'treble': [
            const Dynamic(mark: DynamicMark.pp, voice: 'treble', beat: 0),
            const Dynamic(mark: DynamicMark.f, voice: 'treble', beat: 1),
          ],
        },
      );
      final back = Measure.fromJson(m.toJson());
      expect(back.voices.keys.toList(), ['treble', 'bass']);
      expect(back.dynamics['treble']!.map((d) => d.mark).toList(),
          [DynamicMark.pp, DynamicMark.f]);
      expect(back.dynamics['treble']!.map((d) => d.beat).toList(), [0, 1]);
      expect(back.dynamics['treble']!.every((d) => d.voice == 'treble'), isTrue);
    });

    test('обратная совместимость: старый JSON без _dyn -> пустые оттенки', () {
      final legacy = {
        'treble': [
          {'pitches': [{'step': 'c', 'octave': 4}], 'duration': 'q', 'rest': false}
        ],
        'bass': <dynamic>[],
      };
      final m = Measure.fromJson(legacy);
      expect(m.voices['treble']!.length, 1);
      expect(m.dynamics.isEmpty, isTrue);
    });

    test('toRenderJson отдаёт _dyn для движка/PDF (контракт рендера)', () {
      final m = Measure(
        {'treble': [_n('c')], 'bass': <MusicNote>[]},
        dynamics: {
          'treble': [const Dynamic(mark: DynamicMark.ff, voice: 'treble', beat: 0)],
        },
      );
      final r = m.toRenderJson();
      expect(r['_dyn'], {
        'treble': [
          {'mark': 'ff', 'beat': 0}
        ]
      });
      // голоса остаются natural-aware ключами (как раньше)
      expect((r['treble'] as List).first['keys'], ['c/4']);
    });
  });

  group('Measure.copy / Score copy — снимок Undo/Redo', () {
    test('copy() глубоко копирует оттенки (независимость снимка)', () {
      final m = Measure(
        {'treble': [_n('c')], 'bass': <MusicNote>[]},
        dynamics: {
          'treble': [const Dynamic(mark: DynamicMark.p, voice: 'treble', beat: 0)],
        },
      );
      final c = m.copy();
      // мутируем копию — оригинал не затронут
      c.dynamics['treble']![0] =
          const Dynamic(mark: DynamicMark.fff, voice: 'treble', beat: 0);
      c.dynamics['treble']!.add(
          const Dynamic(mark: DynamicMark.mp, voice: 'treble', beat: 1));
      expect(m.dynamics['treble']!.length, 1);
      expect(m.dynamics['treble']!.single.mark, DynamicMark.p);
    });

    test('Score.copy() (Undo) сохраняет и изолирует оттенки', () {
      final s = _score(
        treble: [_n('c')],
        dyn: [const Dynamic(mark: DynamicMark.f, voice: 'treble', beat: 0)],
      );
      final c = s.copy();
      c.measures.first.dynamicsOf('treble').clear();
      expect(s.measures.first.dynamicsOf('treble').single.mark, DynamicMark.f);
    });

    test('Score encode/decode сохраняет оттенки', () {
      final s = _score(
        treble: [_n('c'), _n('d')],
        dyn: [
          const Dynamic(mark: DynamicMark.pp, voice: 'treble', beat: 0),
          const Dynamic(mark: DynamicMark.ff, voice: 'treble', beat: 1),
        ],
      );
      final back = Score.decode(s.encode());
      final d = back.measures.first.dynamics['treble']!;
      expect(d.map((x) => x.mark).toList(), [DynamicMark.pp, DynamicMark.ff]);
      expect(d.map((x) => x.beat).toList(), [0, 1]);
    });
  });

  group('onsetBeats — привязка оттенка к доле ноты (в четвертях)', () {
    test('кумулятивные онсеты с учётом длительностей', () {
      final notes = [_n('c'), _n('d'), _n('e', dur: 'h')];
      expect(onsetBeats(notes, 0), 0);
      expect(onsetBeats(notes, 1), 1); // после q
      expect(onsetBeats(notes, 2), 2); // после q+q
    });

    test('учитывает точку и tuplet', () {
      final dotted = MusicNote(
          pitches: [const Pitch(step: 'c', octave: 4)], duration: 'q', dots: 1);
      final notes = [dotted, _n('d')];
      expect(onsetBeats(notes, 1), 1.5); // пунктирная четверть = 1.5 доли
    });
  });

  group('reflowDynamics — сохранение музыкальной позиции', () {
    test('оттенок остаётся на своей абсолютной доле при перепаковке', () {
      // from: 2 такта, f на доле 2 такта 1 (абс. доля 6 при measureQ=4).
      final from = [
        Measure({'treble': <MusicNote>[], 'bass': <MusicNote>[]}),
        Measure(
          {'treble': <MusicNote>[], 'bass': <MusicNote>[]},
          dynamics: {
            'treble': [const Dynamic(mark: DynamicMark.f, voice: 'treble', beat: 2)],
          },
        ),
      ];
      final to = [
        for (var i = 0; i < 3; i++)
          Measure({'treble': <MusicNote>[], 'bass': <MusicNote>[]}),
      ];
      reflowDynamics(from, to, 4); // 4/4 -> measureQ = 4 четверти
      // абс. доля 6 -> такт 1, локальная доля 2
      expect(to[0].dynamics['treble'] ?? const [], isEmpty);
      final d = to[1].dynamics['treble']!.single;
      expect(d.mark, DynamicMark.f);
      expect(d.beat, 2);
      expect(to[2].dynamics['treble'] ?? const [], isEmpty);
    });

    test('очищает старые оттенки целевых тактов перед раскладкой', () {
      final from = [
        Measure(
          {'treble': <MusicNote>[], 'bass': <MusicNote>[]},
          dynamics: {
            'treble': [const Dynamic(mark: DynamicMark.p, voice: 'treble', beat: 0)],
          },
        ),
      ];
      final to = [
        Measure(
          {'treble': <MusicNote>[], 'bass': <MusicNote>[]},
          dynamics: {
            'treble': [const Dynamic(mark: DynamicMark.fff, voice: 'treble', beat: 3)],
          },
        ),
      ];
      reflowDynamics(from, to, 4);
      expect(to[0].dynamics['treble']!.single.mark, DynamicMark.p);
      expect(to[0].dynamics['treble']!.single.beat, 0);
    });

    test('совпадающие по доле схлопываются (побеждает последний)', () {
      final from = [
        Measure(
          {'treble': <MusicNote>[], 'bass': <MusicNote>[]},
          dynamics: {
            'treble': [
              const Dynamic(mark: DynamicMark.p, voice: 'treble', beat: 0),
              const Dynamic(mark: DynamicMark.f, voice: 'treble', beat: 0),
            ],
          },
        ),
      ];
      final to = [Measure({'treble': <MusicNote>[], 'bass': <MusicNote>[]})];
      reflowDynamics(from, to, 4);
      expect(to[0].dynamics['treble']!.single.mark, DynamicMark.f);
    });
  });

  group('Editor insertion semantics (модель: добавить/заменить/снять)', () {
    // Повторяет контракт _setDynamic редактора на уровне модели: оттенок на
    // доле ноты под курсором; тот же знак — снять; другой — заменить.
    void apply(Measure m, String voice, double beat, DynamicMark mark) {
      final list = m.dynamicsOf(voice);
      final at = list.indexWhere((d) => (d.beat - beat).abs() < 1e-6);
      if (at >= 0) {
        if (list[at].mark == mark) {
          list.removeAt(at);
        } else {
          list[at] = Dynamic(mark: mark, voice: voice, beat: beat);
        }
      } else {
        list
          ..add(Dynamic(mark: mark, voice: voice, beat: beat))
          ..sort((a, b) => a.beat.compareTo(b.beat));
      }
    }

    test('добавление на долю ноды под курсором', () {
      final m = Measure({'treble': [_n('c'), _n('d')], 'bass': <MusicNote>[]});
      final beat = onsetBeats(m.voice('treble'), 1); // 2-я нота -> доля 1
      apply(m, 'treble', beat, DynamicMark.f);
      expect(m.dynamics['treble']!.single.beat, 1);
      expect(m.dynamics['treble']!.single.mark, DynamicMark.f);
    });

    test('тот же знак — снимается (toggle)', () {
      final m = Measure({'treble': [_n('c')], 'bass': <MusicNote>[]});
      apply(m, 'treble', 0, DynamicMark.f);
      apply(m, 'treble', 0, DynamicMark.f);
      expect(m.dynamicsOf('treble'), isEmpty);
    });

    test('другой знак на той же доле — заменяет', () {
      final m = Measure({'treble': [_n('c')], 'bass': <MusicNote>[]});
      apply(m, 'treble', 0, DynamicMark.p);
      apply(m, 'treble', 0, DynamicMark.ff);
      expect(m.dynamicsOf('treble').single.mark, DynamicMark.ff);
    });
  });
}
