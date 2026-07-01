import 'dart:convert';

/// Тип инструмента определяет конфигурацию станов и палитру редактора.
/// piano  -> Grand Staff (скрипичный + басовый ключи, фигурная скобка).
/// drums  -> один перкуссионный стан (percussion clef, x-ноты для тарелок).
enum InstrumentType {
  piano,
  drums;

  String get id => name;

  static InstrumentType fromId(String? id) =>
      InstrumentType.values.firstWhere(
        (e) => e.name == id,
        orElse: () => InstrumentType.piano,
      );

  /// Голоса (voice id), которые есть у инструмента. Порядок = порядок станов.
  List<String> get voiceIds => switch (this) {
        InstrumentType.piano => const ['treble', 'bass'],
        InstrumentType.drums => const ['perc'],
      };

  String get label => switch (this) {
        InstrumentType.piano => 'Фортепиано',
        InstrumentType.drums => 'Ударная установка',
      };
}

/// Размер такта, напр. 4/4.
class TimeSignature {
  final int beats;
  final int beatValue;

  const TimeSignature(this.beats, this.beatValue);

  static const TimeSignature common = TimeSignature(4, 4);

  String get vex => '$beats/$beatValue';

  factory TimeSignature.parse(String s) {
    final parts = s.split('/');
    if (parts.length != 2) return common;
    return TimeSignature(
      int.tryParse(parts[0]) ?? 4,
      int.tryParse(parts[1]) ?? 4,
    );
  }

  /// Ёмкость такта в ЦЕЛЫХ нотах (доля от целой) — beats/beatValue. 4/4 = 1.0,
  /// 3/4 = 0.75, 5/8 = 0.625, 7/8 = 0.875. Зеркало движкового
  /// `domain/timesig.measureCapacityQ` (там — в четвертях: ×4). Единица [capacity]
  /// совпадает с [packVoice]/[noteFraction] — доля от целой ноты.
  double get capacity => beats / beatValue;

  Map<String, dynamic> toJson() => {'beats': beats, 'beatValue': beatValue};

  factory TimeSignature.fromJson(Map<String, dynamic> j) =>
      TimeSignature(j['beats'] as int? ?? 4, j['beatValue'] as int? ?? 4);

  @override
  bool operator ==(Object other) =>
      other is TimeSignature &&
      other.beats == beats &&
      other.beatValue == beatValue;

  @override
  int get hashCode => Object.hash(beats, beatValue);
}

/// Соотношение группы нестандартной ритмики (tuplet): [actualNotes] нот за
/// время [normalNotes]. Триоль = 3:2, квинтоль = 5:4 и т.д. Универсально —
/// отдельного типа «триоль» нет. [scale] — множитель РЕАЛЬНОГО времени ноты
/// группы (normal/actual): в 3:2 каждая нота длится 2/3 написанной.
class Tuplet {
  final int actualNotes;
  final int normalNotes;

  const Tuplet(this.actualNotes, this.normalNotes);

  double get scale => normalNotes / actualNotes;

  Map<String, dynamic> toJson() =>
      {'actual': actualNotes, 'normal': normalNotes};

  factory Tuplet.fromJson(Map<String, dynamic> j) =>
      Tuplet(j['actual'] as int? ?? 3, j['normal'] as int? ?? 2);
}

/// Динамический оттенок (forte/piano…). ОТДЕЛЬНАЯ модель и ОТДЕЛЬНЫЙ
/// нотационный объект — как в MuseScore/Dorico/Finale/Sibelius. НЕ свойство
/// ноты: оттенок привязан к РИТМИЧЕСКОЙ позиции и действует на все последующие
/// ноты до следующего оттенка.
///
/// Каждое значение само знает (а) свои буквы для глифа (p/m/f — движок проецирует
/// в SMuFL dynamicPiano/Mezzo/Forte) и (б) свою громкость. Поэтому расширение до
/// sfz/fp/rfz/cresc./dim. — это ДОБАВЛЕНИЕ значений (и при необходимости новых
/// букв s/z/r), без переделки модели, компилятора или рендера. Вилки (hairpins)
/// лягут отдельным объектом с тем же позиционным якорем.
enum DynamicMark {
  ppp,
  pp,
  p,
  mp,
  mf,
  f,
  ff,
  fff;

  String get id => name;

  /// Текстовая метка (буквы). Совпадает с [name] для ppp..fff; вынесено
  /// отдельным геттером, чтобы будущие знаки (sfz, fp, …) могли задавать
  /// последовательность букв, отличную от имени константы.
  String get label => name;

  /// Громкость воспроизведения (velocity/gain, 0..1; fff>1 клампится сэмплером
  /// и синтезом). ЗЕРКАЛО для модели и тестов: РЕАЛЬНОЕ разрешение громкости
  /// происходит в ОДНОМ месте — playback-компиляторе движка
  /// (assets/www/js/domain/dynamics.js → DYNAMIC_VELOCITY), точно как сдвиг
  /// высоты у [Accidental] считается в движке. Значения синхронизированы.
  double get velocity => switch (this) {
        DynamicMark.ppp => 0.20,
        DynamicMark.pp => 0.30,
        DynamicMark.p => 0.45,
        DynamicMark.mp => 0.60,
        DynamicMark.mf => 0.75,
        DynamicMark.f => 0.90,
        DynamicMark.ff => 1.00,
        DynamicMark.fff => 1.10,
      };

  static DynamicMark fromId(String? id) => DynamicMark.values.firstWhere(
        (e) => e.name == id,
        orElse: () => DynamicMark.mf,
      );
}

/// Один динамический оттенок, привязанный к ритмической позиции внутри такта.
/// Хранится в [Measure] в списке своего голоса — поэтому ИНДЕКС ТАКТА задаётся
/// контейнером и в объекте не дублируется (хранятся [voice] и [beat]).
/// [beat] — доля от начала такта в ЧЕТВЕРТЯХ (та же единица, что startBeat
/// компилятора): один оттенок на (голос+доля).
///
/// На MusicNote оттенок НЕ хранится. Реальная громкость каждого playback-события
/// считается в одном месте (движок) по «активному» оттенку — этот объект описывает
/// лишь ЧТО и ГДЕ записано.
class Dynamic {
  final DynamicMark mark;
  final String voice;
  final double beat;

  const Dynamic({required this.mark, required this.voice, this.beat = 0});

  Dynamic copy() => Dynamic(mark: mark, voice: voice, beat: beat);

  /// Тот же якорь с другим знаком (замена оттенка на месте).
  Dynamic withMark(DynamicMark m) => Dynamic(mark: m, voice: voice, beat: beat);

  /// Persistence-JSON: голос задаётся ключом контейнера (в [Measure]), поэтому
  /// в объект не пишется — лаконично и без рассинхрона с ключом.
  Map<String, dynamic> toJson() => {'mark': mark.id, 'beat': beat};

  /// Render-проекция для движка: метка (буквы глифа) + доля. Громкость движок
  /// считает сам из метки (единое место) — здесь только что/где нарисовать.
  Map<String, dynamic> toRenderJson() => {'mark': mark.id, 'beat': beat};

  factory Dynamic.fromJson(Map<String, dynamic> j, {required String voice}) =>
      Dynamic(
        mark: DynamicMark.fromId(j['mark'] as String?),
        voice: voice,
        beat: (j['beat'] as num?)?.toDouble() ?? 0,
      );

  @override
  bool operator ==(Object other) =>
      other is Dynamic &&
      other.mark == mark &&
      other.voice == voice &&
      other.beat == beat;

  @override
  int get hashCode => Object.hash(mark, voice, beat);
}

/// Тип вилки (hairpin): постепенное изменение громкости в диапазоне.
/// [crescendo] — нарастание (<), [diminuendo] — спад (>). Расширяемо до
/// niente/кастомных вилок добавлением значений.
enum HairpinType {
  crescendo,
  diminuendo;

  String get id => name;

  static HairpinType fromId(String? id) => switch (id) {
        'diminuendo' => HairpinType.diminuendo,
        _ => HairpinType.crescendo,
      };
}

/// Вилка (crescendo/diminuendo) — FIRST-CLASS нотационный объект-ДИАПАЗОН,
/// РАСШИРЯЮЩИЙ систему динамики (не заменяющий её). НЕ свойство ноты и НЕ оттенок:
/// вилка задаёт ПЛАВНОЕ изменение громкости между двумя ритмическими позициями.
/// Привязана к музыкальному ВРЕМЕНИ (такт+доля обоих концов) — как [Dynamic], и
/// так же переживает reflow (перепривязка по абсолютной доле, см. reflowHairpins).
///
/// Громкость вилка НЕ считает: playback-компилятор движка (domain/dynamics.
/// velocityTimeline + velocityAt) ИНТЕРПОЛИРУЕТ velocity между активным оттенком
/// в начале вилки и целевым в конце — ЕДИНОЕ место разрешения громкости, без
/// дублирования. Этот объект описывает лишь ЧТО и ГДЕ записано.
///
/// [voice] — голос вилки; [startMeasure] задаётся контейнером ([Measure] хранит
/// вилку на своём такте-начале), поэтому в объекте не дублируется. [startBeat]/
/// [endBeat] — доли (в ЧЕТВЕРТЯХ) от начала своего такта; [endMeasure] — индекс
/// такта-конца. Future-ready: niente/expression/кривые лягут доп. полями без
/// переделки модели, компилятора или рендера.
class Hairpin {
  final HairpinType type;
  final String voice;
  final double startBeat;
  final int endMeasure;
  final double endBeat;

  const Hairpin({
    required this.type,
    required this.voice,
    required this.startBeat,
    required this.endMeasure,
    required this.endBeat,
  });

  Hairpin copy() => Hairpin(
        type: type,
        voice: voice,
        startBeat: startBeat,
        endMeasure: endMeasure,
        endBeat: endBeat,
      );

  /// Persistence-JSON и render-проекция СОВПАДАЮТ (движок читает `type`/`voice`/
  /// `sb`/`em`/`eb`): вилка не имеет отдельного «глифа-vs-структуры», как у ноты.
  /// startMeasure задаётся контейнером (ключ такта), поэтому в объект не пишется.
  Map<String, dynamic> toJson() => {
        'type': type.id,
        'voice': voice,
        'sb': startBeat,
        'em': endMeasure,
        'eb': endBeat,
      };

  Map<String, dynamic> toRenderJson() => toJson();

  factory Hairpin.fromJson(Map<String, dynamic> j) => Hairpin(
        type: HairpinType.fromId(j['type'] as String?),
        voice: j['voice'] as String? ?? 'treble',
        startBeat: (j['sb'] as num?)?.toDouble() ?? 0,
        endMeasure: j['em'] as int? ?? 0,
        endBeat: (j['eb'] as num?)?.toDouble() ?? 0,
      );

  @override
  bool operator ==(Object other) =>
      other is Hairpin &&
      other.type == type &&
      other.voice == voice &&
      (other.startBeat - startBeat).abs() < 1e-9 &&
      other.endMeasure == endMeasure &&
      (other.endBeat - endBeat).abs() < 1e-9;

  @override
  int get hashCode => Object.hash(type, voice, startBeat, endMeasure, endBeat);
}

/// Смена темпа (♩ = N) — FIRST-CLASS нотационный объект на ритмической позиции
/// (такт+доля), НЕ свойство ноты. Как в MuseScore/Dorico/Finale. Привязана к
/// музыкальному ВРЕМЕНИ и переживает reflow перепривязкой по абсолютной доле
/// (reflowTempos) — ПАРАЛЛЕЛЬНО оттенкам/вилкам.
///
/// Темп в ПЛЕЙБЕК-ВРЕМЯ превращает ТОЛЬКО движок (domain/tempo.buildTempoMap +
/// компилятор — единый tempo map): здесь хранится лишь ЧТО записано. [bpm] —
/// ударов в минуту; [beatUnit] — доля-удар в ЧЕТВЕРТЯХ (1 = ♩ по умолчанию;
/// расширяемо на ♩.=1.5, ♪=0.5 и т.п.). [beat] — доля (в четвертях) от начала
/// такта ([measure] задаёт контейнер). Future-ready: rit./accel./a tempo/tempo
/// text — соседние объекты/поля с тем же якорем, без переделки модели.
class TempoMark {
  final int bpm;
  final double beatUnit;
  final double beat;

  const TempoMark({required this.bpm, this.beatUnit = 1, this.beat = 0});

  TempoMark copy() => TempoMark(bpm: bpm, beatUnit: beatUnit, beat: beat);

  /// Тот же якорь с другим bpm (замена темпа на месте).
  TempoMark withBpm(int v) => TempoMark(bpm: v, beatUnit: beatUnit, beat: beat);

  /// Persistence-JSON и render-проекция СОВПАДАЮТ (движок читает bpm/beat/unit).
  /// [beat] задаётся контейнером-тактом косвенно, но хранится (позиция внутри
  /// такта); [measure] — нет (это индекс в списке тактов). unit пишем только != 1.
  Map<String, dynamic> toJson() => {
        'bpm': bpm,
        'beat': beat,
        if (beatUnit != 1) 'unit': beatUnit,
      };

  Map<String, dynamic> toRenderJson() => toJson();

  factory TempoMark.fromJson(Map<String, dynamic> j) => TempoMark(
        bpm: j['bpm'] as int? ?? 120,
        beatUnit: (j['unit'] as num?)?.toDouble() ?? 1,
        beat: (j['beat'] as num?)?.toDouble() ?? 0,
      );

  @override
  bool operator ==(Object other) =>
      other is TempoMark &&
      other.bpm == bpm &&
      other.beatUnit == beatUnit &&
      (other.beat - beat).abs() < 1e-9;

  @override
  int get hashCode => Object.hash(bpm, beatUnit, beat);
}

/// Тип тактовой черты (barline) — ОТДЕЛЬНАЯ модель и FIRST-CLASS нотационный
/// объект, как в MuseScore/Dorico/Finale. НЕ свойство рендера: черта привязана к
/// ГРАНИЦЕ такта (его ПРАВОМУ краю — end barline) и переживает reflow как
/// позиционный якорь (по номеру такта), точно как [Measure.keySignature]/
/// [Measure.timeSignature].
///
/// Каждое значение само знает (а) свой [id] для JSON и (б) — через движок
/// (domain/barlines.js) — проекцию на НАТИВНЫЙ тип VexFlow (normal/double/final/
/// invisible) ЛИБО кастомную профессиональную гравировку (dashed/dotted/tick/
/// short). Поэтому расширение до Repeat Start/End/Both — это ДОБАВЛЕНИЕ значений
/// (нативные типы VexFlow REPEAT_*), без переделки модели, рендера, сериализации
/// или редактора. Вольты/D.C./D.S./Fine/Coda лягут отдельными объектами с тем же
/// позиционным якорем.
///
/// [normal] — обычная одиночная черта (ПО УМОЛЧАНИЮ): на такте хранится как null
/// и НЕ сериализуется (как «нет смены» у `_key`/`_ts`); движок рисует штатную
/// одиночную линию VexFlow. [invisible] — ЯВНЫЙ тип: занимает место в раскладке,
/// но линия не рисуется (VexFlow Barline NONE).
enum BarlineType {
  normal,
  doubleBar,
  finalBar,
  dashed,
  dotted,
  tick,
  short,
  invisible;

  /// JSON-идентификатор (значение зарезервированного ключа `_bar`). Совпадает с
  /// именем константы, кроме double/final: их имена в Dart зарезервированы,
  /// поэтому константы названы doubleBar/finalBar, а id остаются 'double'/'final'
  /// (стабильный, читаемый формат — как имена тональностей/размеров).
  String get id => switch (this) {
        BarlineType.doubleBar => 'double',
        BarlineType.finalBar => 'final',
        _ => name,
      };

  /// Черта по умолчанию (одиночная). Хранится на такте как null и не пишется в
  /// JSON — «не сериализовать, если не изменилось» (как `_key`/`_ts`/лиги).
  bool get isDefault => this == BarlineType.normal;

  static BarlineType fromId(String? id) => switch (id) {
        'double' => BarlineType.doubleBar,
        'final' => BarlineType.finalBar,
        'dashed' => BarlineType.dashed,
        'dotted' => BarlineType.dotted,
        'tick' => BarlineType.tick,
        'short' => BarlineType.short,
        'invisible' => BarlineType.invisible,
        _ => BarlineType.normal,
      };
}

/// Реприза на границе такта — FIRST-CLASS нотационный объект, отдельный от
/// [BarlineType]. Обычные тактовые черты остаются `_bar`; повтор хранится в
/// `_repeat`, потому что playback обязан читать семантику повтора, а не
/// рендер-флаг. Значение привязано к ПРАВОЙ границе такта: `start` открывает
/// повтор после этой границы, `end` закрывает повтор на этой границе, `both`
/// закрывает предыдущий и сразу открывает следующий.
///
/// Future-ready: repeat count, volta, D.C./D.S./Fine/Coda станут соседними
/// объектами на той же границе, без переделки нот, рендера или scheduler.
enum RepeatMark {
  start,
  end,
  both;

  String get id => name;

  bool get opensRepeat => this == RepeatMark.start || this == RepeatMark.both;
  bool get closesRepeat => this == RepeatMark.end || this == RepeatMark.both;

  static RepeatMark? fromId(String? id) => switch (id) {
        'start' => RepeatMark.start,
        'end' => RepeatMark.end,
        'both' => RepeatMark.both,
        _ => null,
      };
}

/// Вольта (первая/вторая концовка) — FIRST-CLASS нотационный объект-ДИАПАЗОН,
/// как в MuseScore/Dorico/Finale. НЕ свойство рендера: вольта привязана к
/// ПЕРВОМУ такту концовки и переживает reflow позиционно (по номеру такта),
/// точно как [RepeatMark]/[BarlineType]/[Measure.keySignature]. Тесно
/// интегрирована с [RepeatMark]: playback-компилятор на нужном проходе повтора
/// проигрывает ту концовку, чей [numbers] содержит номер прохода (движок
/// domain/voltas + domain/repeats.expandMeasureOrder — ЕДИНСТВЕННОЕ место
/// разворота порядка). Scheduler о вольтах не знает.
///
/// Модель диапазонная и расширяется БЕЗ редизайна: [numbers] — список номеров
/// концовки ([1], [2] и, в будущем, [3], [4], [1,3] …), [span] — сколько тактов
/// покрывает скобка (>=1 — многотактовые концовки). Хранится под
/// зарезервированным ключом `_volta` (как `_repeat`/`_bar`): старые файлы без
/// него грузятся, с голосами он не путается (имена голосов без `_`).
class Volta {
  final List<int> numbers;
  final int span;

  Volta({required this.numbers, this.span = 1});

  /// Первая концовка (номер 1, один такт) — типовой пресет редактора.
  factory Volta.ending(int number, {int span = 1}) =>
      Volta(numbers: [number], span: span < 1 ? 1 : span);

  /// Текстовая метка скобки: "1.", "2.", "1, 3." … Зеркало движкового
  /// domain/voltas.voltaLabel — движок и модель рисуют одинаковый текст.
  String get label => '${(numbers.isEmpty ? const [1] : numbers).join(', ')}.';

  Volta copy() => Volta(numbers: List<int>.of(numbers), span: span);

  /// Persistence-JSON: список номеров под `n`; span пишется только если > 1
  /// (лаконичный JSON — большинство концовок однотактовые).
  Map<String, dynamic> toJson() => {
        'n': numbers,
        if (span != 1) 'span': span,
      };

  /// Render-проекция для движка (domain/voltas читает `n` и `span`). span
  /// пишем всегда — движку удобнее не додумывать дефолт.
  Map<String, dynamic> toRenderJson() => {'n': numbers, 'span': span};

  factory Volta.fromJson(Map<String, dynamic> j) {
    final raw = j['n'] ?? j['numbers'];
    final nums = <int>[];
    if (raw is List) {
      for (final e in raw) {
        final v = (e is num) ? e.toInt() : int.tryParse('$e');
        if (v != null && v > 0 && !nums.contains(v)) nums.add(v);
      }
    }
    nums.sort();
    final s = j['span'] as int? ?? 1;
    return Volta(numbers: nums.isEmpty ? [1] : nums, span: s < 1 ? 1 : s);
  }

  @override
  bool operator ==(Object other) =>
      other is Volta &&
      other.span == span &&
      other.numbers.length == numbers.length &&
      _sameNumbers(other.numbers);

  bool _sameNumbers(List<int> o) {
    for (var i = 0; i < numbers.length; i++) {
      if (numbers[i] != o[i]) return false;
    }
    return true;
  }

  @override
  int get hashCode => Object.hash(span, Object.hashAll(numbers));
}

/// Знак альтерации головки ноты. ОТДЕЛЬНАЯ модель (не bool) — как в MuseScore/
/// Dorico/Finale. Архитектура расширяема до микротонов/четвертьтонов простым
/// добавлением значений: каждое значение само знает свой сдвиг в полутонах и
/// обозначение VexFlow, поэтому остальной код переделывать не придётся.
///
/// [none] — знак НЕ записан: реальная высота следует тональности и правилам
/// такта. [natural] (♮) — записанный бекар: отменяет тональность и предыдущие
/// знаки в такте (сдвиг 0, но ЯВНЫЙ). Реальный (звучащий) сдвиг с учётом
/// тональности и правил такта считается в ОДНОМ месте — playback-компиляторе
/// движка; здесь хранится только то, что записано.
enum Accidental {
  none,
  natural,
  sharp,
  flat,
  doubleSharp,
  doubleFlat;

  /// Сдвиг полутонов относительно натуральной ступени (для записанного знака).
  /// none/natural == 0 (natural при этом ЯВНО сбрасывает тональность — см.
  /// [isExplicit] и компилятор).
  int get semitoneShift => switch (this) {
        Accidental.sharp => 1,
        Accidental.flat => -1,
        Accidental.doubleSharp => 2,
        Accidental.doubleFlat => -2,
        Accidental.none || Accidental.natural => 0,
      };

  /// Знак записан явно (рисуется глиф и переопределяет тональность/такт).
  /// none — единственный «неявный» знак.
  bool get isExplicit => this != Accidental.none;

  /// Суффикс ключа VexFlow: '#','b','##','bb','n' или '' (для none).
  String get vexSuffix => switch (this) {
        Accidental.sharp => '#',
        Accidental.flat => 'b',
        Accidental.doubleSharp => '##',
        Accidental.doubleFlat => 'bb',
        Accidental.natural => 'n',
        Accidental.none => '',
      };

  String get id => name;

  static Accidental fromId(String? id) => Accidental.values.firstWhere(
        (e) => e.name == id,
        orElse: () => Accidental.none,
      );

  /// Разбор суффикса ключа VexFlow в знак (миграция legacy keys-строк).
  static Accidental fromVexSuffix(String s) => switch (s) {
        '#' => Accidental.sharp,
        'b' => Accidental.flat,
        '##' => Accidental.doubleSharp,
        'bb' => Accidental.doubleFlat,
        'n' => Accidental.natural,
        _ => Accidental.none,
      };
}

/// Одна головка ноты: натуральная ступень (буква a–g) + октава + знак
/// альтерации. [head] — головка VexFlow для ударных (напр. 'x2' — крест у
/// тарелок), null для обычных нот.
///
/// Реальная (звучащая) высота здесь НЕ хранится: MIDI = ступень + тональность
/// + знак + правила такта, и считается в одном месте (playback-компилятор
/// движка). Модель хранит лишь то, что записано на стане. Ключ VexFlow ([vexKey])
/// — проекция для рендера/движка, строится из полей только на границе VexFlow.
class Pitch {
  final String step; // 'a'..'g' — натуральная буква без знака
  final int octave;
  final Accidental accidental;
  final String? head;

  const Pitch({
    required this.step,
    required this.octave,
    this.accidental = Accidental.none,
    this.head,
  });

  /// Натуральный полутон ступени внутри октавы (без знака): c=0 .. b=11.
  static const Map<String, int> _stepSemi =
      {'c': 0, 'd': 2, 'e': 4, 'f': 5, 'g': 7, 'a': 9, 'b': 11};

  /// Ключ VexFlow: "f#/4", "fn/4" (бекар), "f/4" (без знака), "g/5/x2" (ударные).
  /// Natural-aware: бекар кодируется суффиксом 'n', чтобы движок мог отличить
  /// «следовать тональности» (none) от «явный бекар» при расчёте высоты.
  String get vexKey {
    final base = '$step${accidental.vexSuffix}/$octave';
    return head == null ? base : '$base/$head';
  }

  /// Высотный ранг для сортировки головок аккорда снизу вверх (требование
  /// VexFlow). По записанной высоте со знаком — устойчивый порядок.
  int get rank =>
      octave * 12 + (_stepSemi[step] ?? 0) + accidental.semitoneShift;

  Pitch copy() =>
      Pitch(step: step, octave: octave, accidental: accidental, head: head);

  /// Та же головка с другим знаком (для инструмента «Альтерация» в редакторе).
  Pitch withAccidental(Accidental a) =>
      Pitch(step: step, octave: octave, accidental: a, head: head);

  Map<String, dynamic> toJson() => {
        'step': step,
        'octave': octave,
        if (accidental != Accidental.none) 'acc': accidental.id,
        if (head != null) 'head': head,
      };

  factory Pitch.fromJson(Map<String, dynamic> j) => Pitch(
        step: (j['step'] as String).toLowerCase(),
        octave: j['octave'] as int? ?? 4,
        accidental: Accidental.fromId(j['acc'] as String?),
        head: j['head'] as String?,
      );

  /// Разбор legacy ключа VexFlow ("c#/4", "cb/3", "g/5/x2") в [Pitch] —
  /// миграция старого формата (ноты до введения модели Accidental).
  factory Pitch.fromVexKey(String key) {
    final parts = key.split('/');
    final la = parts.isNotEmpty ? parts[0] : 'c';
    final step = la.isNotEmpty ? la[0].toLowerCase() : 'c';
    final suffix = la.length > 1 ? la.substring(1).toLowerCase() : '';
    final octave = parts.length > 1 ? (int.tryParse(parts[1]) ?? 4) : 4;
    final head = parts.length > 2 ? parts[2] : null;
    return Pitch(
      step: step,
      octave: octave,
      accidental: Accidental.fromVexSuffix(suffix),
      head: head,
    );
  }

  @override
  bool operator ==(Object other) =>
      other is Pitch &&
      other.step == step &&
      other.octave == octave &&
      other.accidental == accidental &&
      other.head == head;

  @override
  int get hashCode => Object.hash(step, octave, accidental, head);
}

/// Артикуляция ноты (staccato/accent/…) — FIRST-CLASS выразительный знак,
/// принадлежащий НОТЕ (головке), НЕ такту. Как в MuseScore/Dorico/Finale.
/// Хранится в списке на [MusicNote] (несколько артикуляций на ноте: staccato +
/// accent и т.п.) — поэтому переживает reflow «бесплатно» вместе с объектом ноты.
///
/// Влияние на playback (длительность/громкость/атака) считается в ОДНОМ месте —
/// движке (domain/articulations.ARTICULATION_SPEC), как громкость у [DynamicMark]:
/// компилятор — последний выразительный слой ПОСЛЕ динамики и вилок, scheduler не
/// знает об артикуляциях. Здесь хранится лишь ЧТО записано.
///
/// Расширяемо БЕЗ редизайна: fermata/breath/caesura — добавление значений
/// (+ запись в движковый ARTICULATION_SPEC), без переделки ноты/рендера/редактора.
enum Articulation {
  staccato,
  staccatissimo,
  accent,
  marcato,
  tenuto;

  String get id => name;

  static Articulation? fromId(String? id) => switch (id) {
        'staccato' => Articulation.staccato,
        'staccatissimo' => Articulation.staccatissimo,
        'accent' => Articulation.accent,
        'marcato' => Articulation.marcato,
        'tenuto' => Articulation.tenuto,
        _ => null,
      };
}

/// Одна нота / аккорд / пауза.
///
/// [pitches] — головки ноты как модель [Pitch] (ступень + октава + знак
/// альтерации [+ головка для ударных]). Аккорд = несколько [Pitch];
/// у каждой головки СВОЙ знак (per-notehead — как в профессиональных
/// редакторах). Пауза — пустой список. Знак НЕ хранится строкой: высота и глиф
/// строятся из [Pitch] на границе VexFlow ([Pitch.vexKey]).
/// [duration] — базовая длительность VexFlow: w h q 8 16 32 64 (без 'r').
/// [dots] — число точек (0 = без точки, 1 = пунктир, 2 = двойной пунктир).
///          Модель расширяема; UI пока выставляет 0/1.
/// [rest] — если true, рисуется пауза соответствующей длительности.
/// [auto] — служебный флаг: пауза, автоматически добитая для целостности
///          такта (см. fillRests/normalize). НЕ сериализуется — добивка
///          пересчитывается при каждой нормализации, поэтому не накапливается.
///
/// Лиги — два МУЗЫКАЛЬНО РАЗНЫХ объекта, представленных РАЗДЕЛЬНЫМИ
/// независимыми полями (никогда не делящими одно поле — см. модель MusicXML
/// `<tie>` vs `<slur>`):
/// [tieToNext] — Tie (лига ДЛИТЕЛЬНОСТИ): эта нота связана со следующей
///          реальной нотой того же голоса в одну звучащую — один attack,
///          суммарная длительность. Флаг на ноте-источнике; цепочка a–a–a =
///          подряд идущие tieToNext. Может пересекать границу такта (флаг едет
///          вместе с объектом при reflow). Влияет на playback/рендер/PDF.
/// [slurStart]/[slurStop] — Slur (лига ФРАЗИРОВКИ): legato-дуга над диапазоном
///          нот любой высоты. Маркеры на нотах-концах; промежуточные ноты
///          попадают под дугу. НЕ объединяет ни длительности, ни звуки
///          (на playback не влияет — только рендер/модель/PDF).
/// [tuplet]/[tupletStart] — Tuplet (нестандартная ритмика): нота входит в
///          группу с соотношением [tuplet]; [tupletStart] помечает ПЕРВУЮ ноту
///          группы (разделяет смежные группы одного соотношения). Влияет на
///          реальное время (см. [tupletScale]) — рендер/playback/PDF/reflow.
class MusicNote {
  List<Pitch> pitches;
  String duration;
  int dots;
  bool rest;
  bool auto;
  bool tieToNext;
  bool slurStart;
  bool slurStop;
  Tuplet? tuplet;
  bool tupletStart;

  /// Артикуляции ноты (staccato/accent/…). Список — на ноте может быть несколько
  /// совместимых знаков (staccato + accent). Принадлежат НОТЕ, поэтому едут с ней
  /// при reflow (как [tieToNext]/[slurStart]). Влияние на playback считает движок
  /// (единое место). Пустой список — знаков нет (не сериализуется).
  List<Articulation> articulations;

  MusicNote({
    required this.pitches,
    required this.duration,
    this.dots = 0,
    this.rest = false,
    this.auto = false,
    this.tieToNext = false,
    this.slurStart = false,
    this.slurStop = false,
    this.tuplet,
    this.tupletStart = false,
    List<Articulation>? articulations,
  }) : articulations = articulations ?? [];

  /// Множитель реального времени ноты от tuplet-группы (1.0 вне группы).
  double get tupletScale => tuplet?.scale ?? 1.0;

  /// Ключи VexFlow (проекция головок на границе VexFlow). Удобный string-view
  /// над каноническим [pitches] — для рендера/движка и string-based кода
  /// (ударные/тесты). Сеттер пересобирает [pitches] из ключей (миграция).
  List<String> get keys => pitches.map((p) => p.vexKey).toList();
  set keys(List<String> v) =>
      pitches = v.map(Pitch.fromVexKey).toList();

  /// Конструктор из ключей VexFlow (string-based путь: ударные, тесты,
  /// reflow). Головки разбираются в [Pitch] через [Pitch.fromVexKey].
  factory MusicNote.fromKeys({
    required List<String> keys,
    required String duration,
    int dots = 0,
    bool rest = false,
    bool auto = false,
    bool tieToNext = false,
    bool slurStart = false,
    bool slurStop = false,
    Tuplet? tuplet,
    bool tupletStart = false,
    List<Articulation>? articulations,
  }) =>
      MusicNote(
        pitches: keys.map(Pitch.fromVexKey).toList(),
        duration: duration,
        dots: dots,
        rest: rest,
        auto: auto,
        tieToNext: tieToNext,
        slurStart: slurStart,
        slurStop: slurStop,
        tuplet: tuplet,
        tupletStart: tupletStart,
        articulations: articulations,
      );

  MusicNote copy() => MusicNote(
        pitches: pitches.map((p) => p.copy()).toList(),
        duration: duration,
        dots: dots,
        rest: rest,
        auto: auto,
        tieToNext: tieToNext,
        slurStart: slurStart,
        slurStop: slurStop,
        tuplet: tuplet == null
            ? null
            : Tuplet(tuplet!.actualNotes, tuplet!.normalNotes),
        tupletStart: tupletStart,
        articulations: List<Articulation>.of(articulations),
      );

  /// Поля, общие для persistence-JSON и render-проекции (всё, кроме головок).
  Map<String, dynamic> _commonJson() => {
        'duration': duration,
        if (dots > 0) 'dots': dots,
        'rest': rest,
        // Лиги сериализуются только когда выставлены — JSON остаётся лаконичным.
        if (tieToNext) 'tieToNext': true,
        if (slurStart) 'slurStart': true,
        if (slurStop) 'slurStop': true,
        if (tuplet != null) 'tuplet': tuplet!.toJson(),
        if (tupletStart) 'tupletStart': true,
        // Артикуляции — списком id (`art`), только когда есть. И persistence, и
        // render-проекция читают одно поле (движок берёт глиф/эффект по id).
        if (articulations.isNotEmpty)
          'art': articulations.map((a) => a.id).toList(),
      };

  /// Persistence-JSON: головки как структурные [Pitch] (round-trip знаков).
  Map<String, dynamic> toJson() => {
        'pitches': pitches.map((p) => p.toJson()).toList(),
        ..._commonJson(),
      };

  /// Render-проекция для движка (VexFlow): головки как natural-aware ключи
  /// "f#/4"/"fn/4"/"f/4". Движок строит глиф и считает высоту из ключа +
  /// тональности + правил такта (единое место — playback-компилятор).
  Map<String, dynamic> toRenderJson() => {
        'keys': keys,
        ..._commonJson(),
      };

  factory MusicNote.fromJson(Map<String, dynamic> j) => MusicNote(
        // Новый формат — 'pitches'; legacy — массив строк 'keys' (миграция).
        pitches: j['pitches'] != null
            ? (j['pitches'] as List)
                .map((e) => Pitch.fromJson(e as Map<String, dynamic>))
                .toList()
            : ((j['keys'] as List?) ?? const [])
                .map((e) => Pitch.fromVexKey(e as String))
                .toList(),
        duration: j['duration'] as String,
        dots: j['dots'] as int? ?? 0,
        rest: j['rest'] as bool? ?? false,
        tieToNext: j['tieToNext'] as bool? ?? false,
        slurStart: j['slurStart'] as bool? ?? false,
        slurStop: j['slurStop'] as bool? ?? false,
        tuplet: j['tuplet'] == null
            ? null
            : Tuplet.fromJson(j['tuplet'] as Map<String, dynamic>),
        tupletStart: j['tupletStart'] as bool? ?? false,
        // Артикуляции: список id под `art` (старые файлы без него грузятся).
        // Неизвестные id отбрасываются (Articulation.fromId -> null).
        articulations: (j['art'] as List?)
            ?.map((e) => Articulation.fromId(e as String?))
            .whereType<Articulation>()
            .toList(),
      );
}

/// Такт: хранит ноты по голосам. Для piano голоса treble+bass,
/// для drums — только perc. Динамические оттенки ([Dynamic]) живут ПАРАЛЛЕЛЬНО
/// нотам — в [dynamics] (голос -> список оттенков, отсортированный по доле), а
/// не внутри MusicNote. В JSON хранятся под зарезервированным ключом `_dyn`
/// (имена голосов с подчёркивания не начинаются), что не ломает старые файлы
/// без оттенков и не путается с голосами при разборе.
class Measure {
  final Map<String, List<MusicNote>> voices;
  final Map<String, List<Dynamic>> dynamics;

  /// Смена тональности С НАЧАЛА этого такта (имя VexFlow: "G", "Bb", …) или
  /// null — тональность не меняется (наследуется от предыдущего такта/начала
  /// партитуры). ПОЗИЦИОННЫЙ якорь (как размер): привязан к НОМЕРУ такта, не к
  /// нотам — при reflow остаётся на своём такте (см. editor `_normalize`).
  /// Действующая тональность каждого такта разрешается в ОДНОМ месте
  /// (движок domain/keysig.effectiveKeys для рендера/playback, и
  /// [Score.effectiveKeySignatureAt] — зеркало для модели/тестов).
  /// Хранится под зарезервированным ключом `_key` (как `_dyn`) — старые файлы
  /// без него грузятся, а с голосами он не путается (имена голосов без `_`).
  String? keySignature;

  /// Смена РАЗМЕРА С НАЧАЛА этого такта (напр. 3/4, 7/8) или null — размер не
  /// меняется (наследуется от предыдущего такта/начала партитуры). ПОЗИЦИОННЫЙ
  /// якорь — как [keySignature]: привязан к НОМЕРУ такта, не к нотам; при reflow
  /// остаётся на своём такте (см. editor `_normalize`). Действующий размер
  /// каждого такта разрешается в ОДНОМ месте (движок domain/timesig.
  /// effectiveTimeSignatures для рендера/playback, и [Score.effectiveTimeSignatureAt]
  /// — зеркало для модели/тестов). Ёмкость такта (сколько нот влезает) берётся
  /// ТОЛЬКО отсюда: глобального размера у алгоритмов больше нет.
  /// Хранится под зарезервированным ключом `_ts` (как `_key`/`_dyn`) — строкой
  /// VexFlow "3/4"; старые файлы без него грузятся.
  TimeSignature? timeSignature;

  /// Тактовая черта на ПРАВОЙ границе этого такта (end barline) или null —
  /// обычная одиночная черта ([BarlineType.normal] по умолчанию). ПОЗИЦИОННЫЙ
  /// якорь — как [keySignature]/[timeSignature]: привязан к НОМЕРУ такта, не к
  /// нотам; при reflow остаётся на своём такте (см. editor `_normalize`). Тип
  /// черты разрешается в ОДНОМ месте (движок domain/barlines для рендера/печати);
  /// playback на черту не реагирует (нотация-only). Хранится под зарезервированным
  /// ключом `_bar` (как `_key`/`_ts`/`_dyn`) — строкой-id ('double','final',…);
  /// старые файлы без него грузятся, нормальная черта не пишется (лаконичный JSON).
  BarlineType? barline;

  /// Реприза на той же ПРАВОЙ границе такта или null — нет повтора. Это не
  /// разновидность `_bar`: renderer может проецировать её в нативный VexFlow
  /// repeat barline, но playback compiler читает именно `_repeat`.
  RepeatMark? repeat;

  /// Вольта (концовка), НАЧИНАющаяся с этого такта, или null — такт не начинает
  /// концовку. Диапазонный объект (см. [Volta]): покрывает [Volta.span] тактов.
  /// Хранится отдельно от `_bar`/`_repeat`, потому что это спан над станом, а не
  /// граница. Позиционный якорь по номеру такта (переживает reflow).
  Volta? volta;

  /// Вилки (crescendo/diminuendo), НАЧИНАющиеся с этого такта. Диапазонные
  /// объекты (см. [Hairpin]), РАСШИРЯЮТ динамику. Привязаны к музыкальному времени
  /// и переживают reflow перепривязкой по абсолютной доле (reflowHairpins) —
  /// ПАРАЛЛЕЛЬНО оттенкам ([dynamics]), а не по индексу такта. Хранятся под
  /// зарезервированным ключом `_hair`.
  final List<Hairpin> hairpins;

  /// Смены темпа (♩ = N) на ритмических позициях внутри такта. Привязаны к
  /// музыкальному времени и переживают reflow перепривязкой по абсолютной доле
  /// (reflowTempos) — ПАРАЛЛЕЛЬНО оттенкам/вилкам. Хранятся под ключом `_tempo`.
  final List<TempoMark> tempos;

  static const String _dynKey = '_dyn';
  static const String _keyKey = '_key';
  static const String _tsKey = '_ts';
  static const String _barKey = '_bar';
  static const String _repeatKey = '_repeat';
  static const String _voltaKey = '_volta';
  static const String _hairKey = '_hair';
  static const String _tempoKey = '_tempo';

  Measure(this.voices,
      {Map<String, List<Dynamic>>? dynamics,
      List<Hairpin>? hairpins,
      List<TempoMark>? tempos,
      this.keySignature,
      this.timeSignature,
      this.barline,
      this.repeat,
      this.volta})
      : dynamics = dynamics ?? {},
        hairpins = hairpins ?? [],
        tempos = tempos ?? [];

  factory Measure.empty(InstrumentType instrument) => Measure({
        for (final v in instrument.voiceIds) v: <MusicNote>[],
      });

  List<MusicNote> voice(String id) => voices.putIfAbsent(id, () => []);

  /// Список оттенков голоса (создаётся при первом обращении).
  List<Dynamic> dynamicsOf(String id) => dynamics.putIfAbsent(id, () => []);

  /// Глубокая копия такта (ноты + оттенки + смена тональности; флаг auto нот
  /// сохраняется).
  Measure copy() => Measure(
        {
          for (final entry in voices.entries)
            entry.key: entry.value.map((n) => n.copy()).toList(),
        },
        dynamics: {
          for (final entry in dynamics.entries)
            entry.key: entry.value.map((d) => d.copy()).toList(),
        },
        keySignature: keySignature,
        timeSignature: timeSignature == null
            ? null
            : TimeSignature(timeSignature!.beats, timeSignature!.beatValue),
        barline: barline,
        repeat: repeat,
        volta: volta?.copy(),
        hairpins: hairpins.map((h) => h.copy()).toList(),
        tempos: tempos.map((t) => t.copy()).toList(),
      );

  /// JSON оттенков по голосам (только непустые списки) — общий для persistence
  /// и render-проекции. Пусто, если оттенков в такте нет (лаконичный JSON).
  Map<String, dynamic> _dynJson(Map<String, dynamic> Function(Dynamic) enc) => {
        for (final entry in dynamics.entries)
          if (entry.value.isNotEmpty)
            entry.key: entry.value.map(enc).toList(),
      };

  Map<String, dynamic> toJson() {
    final j = <String, dynamic>{
      for (final entry in voices.entries)
        entry.key: entry.value.map((n) => n.toJson()).toList(),
    };
    final dyn = _dynJson((d) => d.toJson());
    if (dyn.isNotEmpty) j[_dynKey] = dyn;
    if (keySignature != null) j[_keyKey] = keySignature;
    if (timeSignature != null) j[_tsKey] = timeSignature!.vex;
    if (barline != null && !barline!.isDefault) j[_barKey] = barline!.id;
    if (repeat != null) j[_repeatKey] = repeat!.id;
    if (volta != null) j[_voltaKey] = volta!.toJson();
    if (hairpins.isNotEmpty) {
      j[_hairKey] = hairpins.map((h) => h.toJson()).toList();
    }
    if (tempos.isNotEmpty) {
      j[_tempoKey] = tempos.map((t) => t.toJson()).toList();
    }
    return j;
  }

  /// Render-проекция для движка: ноты как natural-aware ключи VexFlow + оттенки
  /// под `_dyn` + смена тональности под `_key` + смена размера под `_ts` + тактовая
  /// черта под `_bar` (движок индексирует такт по голосам/`_dyn`/`_key`/`_ts`/`_bar`
  /// явно, не итерируя ключи, поэтому лишние ключи безопасны). `_key` читают
  /// effectiveKeys/compiler/render/print; `_ts` — effectiveTimeSignatures; `_bar`
  /// — domain/barlines (render/print). Playback `_bar` игнорирует (нотация-only).
  Map<String, dynamic> toRenderJson() {
    final j = <String, dynamic>{
      for (final entry in voices.entries)
        entry.key: entry.value.map((n) => n.toRenderJson()).toList(),
    };
    final dyn = _dynJson((d) => d.toRenderJson());
    if (dyn.isNotEmpty) j[_dynKey] = dyn;
    if (keySignature != null) j[_keyKey] = keySignature;
    if (timeSignature != null) j[_tsKey] = timeSignature!.vex;
    if (barline != null && !barline!.isDefault) j[_barKey] = barline!.id;
    if (repeat != null) j[_repeatKey] = repeat!.id;
    if (volta != null) j[_voltaKey] = volta!.toRenderJson();
    if (hairpins.isNotEmpty) {
      j[_hairKey] = hairpins.map((h) => h.toRenderJson()).toList();
    }
    if (tempos.isNotEmpty) {
      j[_tempoKey] = tempos.map((t) => t.toRenderJson()).toList();
    }
    return j;
  }

  factory Measure.fromJson(Map<String, dynamic> j) {
    final voices = <String, List<MusicNote>>{};
    final dynamics = <String, List<Dynamic>>{};
    final hairpins = <Hairpin>[];
    final tempos = <TempoMark>[];
    String? keySignature;
    TimeSignature? timeSignature;
    BarlineType? barline;
    RepeatMark? repeat;
    Volta? volta;
    for (final entry in j.entries) {
      if (entry.key == _dynKey) {
        final m = entry.value as Map<String, dynamic>;
        for (final de in m.entries) {
          dynamics[de.key] = (de.value as List)
              .map((e) =>
                  Dynamic.fromJson(e as Map<String, dynamic>, voice: de.key))
              .toList();
        }
        continue;
      }
      if (entry.key == _keyKey) {
        keySignature = entry.value as String?;
        continue;
      }
      if (entry.key == _tsKey) {
        final raw = entry.value;
        timeSignature = raw == null ? null : TimeSignature.parse(raw as String);
        continue;
      }
      if (entry.key == _barKey) {
        barline = BarlineType.fromId(entry.value as String?);
        continue;
      }
      if (entry.key == _repeatKey) {
        repeat = RepeatMark.fromId(entry.value as String?);
        continue;
      }
      if (entry.key == _voltaKey) {
        final v = entry.value;
        volta = v == null ? null : Volta.fromJson(v as Map<String, dynamic>);
        continue;
      }
      if (entry.key == _hairKey) {
        for (final e in (entry.value as List)) {
          hairpins.add(Hairpin.fromJson(e as Map<String, dynamic>));
        }
        continue;
      }
      if (entry.key == _tempoKey) {
        for (final e in (entry.value as List)) {
          tempos.add(TempoMark.fromJson(e as Map<String, dynamic>));
        }
        continue;
      }
      voices[entry.key] = (entry.value as List)
          .map((e) => MusicNote.fromJson(e as Map<String, dynamic>))
          .toList();
    }
    return Measure(voices,
        dynamics: dynamics,
        hairpins: hairpins,
        tempos: tempos,
        keySignature: keySignature,
        timeSignature: timeSignature,
        barline: barline,
        repeat: repeat,
        volta: volta);
  }
}

/// Партитура целиком — корневая сущность хранилища.
class Score {
  final String id;
  String title;
  String composer;
  final InstrumentType instrument;
  String keySignature; // "C", "G", "F", ... (формат VexFlow)
  TimeSignature timeSignature;
  int tempo;
  List<Measure> measures;
  final DateTime createdAt;
  DateTime updatedAt;

  Score({
    required this.id,
    required this.title,
    required this.instrument,
    this.composer = '',
    this.keySignature = 'C',
    this.timeSignature = TimeSignature.common,
    this.tempo = 120,
    List<Measure>? measures,
    required this.createdAt,
    required this.updatedAt,
  }) : measures = measures ?? [];

  /// Новая пустая партитура с одним тактом.
  factory Score.create({
    required String id,
    required String title,
    required InstrumentType instrument,
    required DateTime now,
    TimeSignature timeSignature = TimeSignature.common,
  }) =>
      Score(
        id: id,
        title: title.trim().isEmpty ? 'Без названия' : title.trim(),
        instrument: instrument,
        timeSignature: timeSignature,
        createdAt: now,
        updatedAt: now,
        measures: [Measure.empty(instrument)],
      );

  /// Глубокая копия партитуры — основа snapshot-истории Undo/Redo.
  ///
  /// Копируются такты/ноты вместе со служебным флагом [MusicNote.auto], поэтому
  /// восстановленное состояние не требует повторной нормализации (в отличие от
  /// round-trip через JSON, который флаг auto теряет). Идентичность партитуры
  /// (id/createdAt) сохраняется — это та же партитура в другой момент времени.
  Score copy() => Score(
        id: id,
        title: title,
        instrument: instrument,
        composer: composer,
        keySignature: keySignature,
        timeSignature: TimeSignature(timeSignature.beats, timeSignature.beatValue),
        tempo: tempo,
        measures: measures.map((m) => m.copy()).toList(),
        createdAt: createdAt,
        updatedAt: updatedAt,
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'title': title,
        'composer': composer,
        'instrument': instrument.id,
        'keySignature': keySignature,
        'timeSignature': timeSignature.toJson(),
        'tempo': tempo,
        'measures': measures.map((m) => m.toJson()).toList(),
        'createdAt': createdAt.toIso8601String(),
        'updatedAt': updatedAt.toIso8601String(),
      };

  factory Score.fromJson(Map<String, dynamic> j) => Score(
        id: j['id'] as String,
        title: j['title'] as String? ?? 'Без названия',
        composer: j['composer'] as String? ?? '',
        instrument: InstrumentType.fromId(j['instrument'] as String?),
        keySignature: j['keySignature'] as String? ?? 'C',
        timeSignature:
            TimeSignature.fromJson(j['timeSignature'] as Map<String, dynamic>),
        tempo: j['tempo'] as int? ?? 120,
        measures: (j['measures'] as List)
            .map((e) => Measure.fromJson(e as Map<String, dynamic>))
            .toList(),
        createdAt: DateTime.parse(j['createdAt'] as String),
        updatedAt: DateTime.parse(j['updatedAt'] as String),
      );

  /// Действующая тональность в такте [measure]: стартовая [keySignature],
  /// переопределённая последней сменой ([Measure.keySignature]) на такте ≤
  /// [measure]. Зеркало движкового domain/keysig.effectiveKeys для модели/UI/
  /// тестов; РЕАЛЬНОЕ разрешение высоты остаётся в playback-компиляторе.
  String effectiveKeySignatureAt(int measure) {
    var cur = keySignature;
    final last = measure < measures.length ? measure : measures.length - 1;
    for (var i = 0; i <= last; i++) {
      final k = measures[i].keySignature;
      if (k != null) cur = k;
    }
    return cur;
  }

  /// Действующий РАЗМЕР в такте [measure]: стартовый [timeSignature],
  /// переопределённый последней сменой ([Measure.timeSignature]) на такте ≤
  /// [measure]. Зеркало движкового domain/timesig.effectiveTimeSignatures для
  /// модели/UI/тестов; РЕАЛЬНЫЙ тайминг остаётся в playback-компиляторе. ЕДИНЫЙ
  /// источник ёмкости такта при reflow (см. editor `_normalize`): глобального
  /// размера у алгоритмов нет. Индекс за пределами партитуры -> последний такт.
  TimeSignature effectiveTimeSignatureAt(int measure) {
    var cur = timeSignature;
    final last = measure < measures.length ? measure : measures.length - 1;
    for (var i = 0; i <= last; i++) {
      final t = measures[i].timeSignature;
      if (t != null) cur = t;
    }
    return cur;
  }

  /// Тактовая черта ПО УМОЛЧАНИЮ на границе такта [measure] (по ПОЗИЦИИ): на
  /// ПОСЛЕДНЕМ такте партитуры — финальная (завершающая), иначе обычная
  /// одиночная. Профессиональная конвенция (MuseScore/Dorico/Finale): конец
  /// пьесы помечается тонкой+толстой чертой. Дефолт ПОЗИЦИОННЫЙ: при добавлении
  /// такта «финальная» сама переезжает в новый конец, а явные override
  /// ([Measure.barline]) остаются на своих тактах.
  BarlineType defaultBarlineAt(int measure) =>
      measure == measures.length - 1
          ? BarlineType.finalBar
          : BarlineType.normal;

  /// Действующая тактовая черта такта [measure]: явный override
  /// ([Measure.barline]) либо позиционный дефолт ([defaultBarlineAt]). Зеркало
  /// движкового domain/barlines.effectiveBarlines для модели/UI/тестов; РЕАЛЬНАЯ
  /// гравировка — в движке.
  BarlineType effectiveBarlineAt(int measure) =>
      measures[measure].barline ?? defaultBarlineAt(measure);

  String encode() => jsonEncode(toJson());

  factory Score.decode(String raw) =>
      Score.fromJson(jsonDecode(raw) as Map<String, dynamic>);

  /// Полезная нагрузка для рендер-движка (VexFlow). Содержит позицию курсора,
  /// чтобы движок подсветил активную ноту. [selection] (опц.) — диапазон нот
  /// одного голоса для подсветки выделения при наборе лиги фразировки (slur).
  String renderPayload(EditorCursor cursor, {Map<String, dynamic>? selection}) =>
      jsonEncode({
        'title': title,
        'composer': composer,
        'instrument': instrument.id,
        'keySignature': keySignature,
        'timeSignature': timeSignature.vex,
        'tempo': tempo,
        // Render-проекция: головки как natural-aware ключи VexFlow (не
        // структурные pitches) — движок остаётся string-based на границе.
        'measures': measures.map((m) => m.toRenderJson()).toList(),
        'cursor': cursor.toJson(),
        if (selection != null) 'selection': selection,
      });
}

/// Позиция курсора редактирования: такт / голос / индекс ноты внутри голоса.
class EditorCursor {
  int measure;
  String voice;
  int index;

  EditorCursor({this.measure = 0, this.voice = 'treble', this.index = 0});

  Map<String, dynamic> toJson() =>
      {'measure': measure, 'voice': voice, 'index': index};
}
