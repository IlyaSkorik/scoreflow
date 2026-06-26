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

  Map<String, dynamic> toJson() => {'beats': beats, 'beatValue': beatValue};

  factory TimeSignature.fromJson(Map<String, dynamic> j) =>
      TimeSignature(j['beats'] as int? ?? 4, j['beatValue'] as int? ?? 4);
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
  });

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
      );
}

/// Такт: хранит ноты по голосам. Для piano голоса treble+bass,
/// для drums — только perc.
class Measure {
  final Map<String, List<MusicNote>> voices;

  Measure(this.voices);

  factory Measure.empty(InstrumentType instrument) => Measure({
        for (final v in instrument.voiceIds) v: <MusicNote>[],
      });

  List<MusicNote> voice(String id) => voices.putIfAbsent(id, () => []);

  /// Глубокая копия такта (каждая нота копируется, флаг auto сохраняется).
  Measure copy() => Measure({
        for (final entry in voices.entries)
          entry.key: entry.value.map((n) => n.copy()).toList(),
      });

  Map<String, dynamic> toJson() => {
        for (final entry in voices.entries)
          entry.key: entry.value.map((n) => n.toJson()).toList(),
      };

  /// Render-проекция для движка: ноты как natural-aware ключи VexFlow.
  Map<String, dynamic> toRenderJson() => {
        for (final entry in voices.entries)
          entry.key: entry.value.map((n) => n.toRenderJson()).toList(),
      };

  factory Measure.fromJson(Map<String, dynamic> j) => Measure({
        for (final entry in j.entries)
          entry.key: (entry.value as List)
              .map((e) => MusicNote.fromJson(e as Map<String, dynamic>))
              .toList(),
      });
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
