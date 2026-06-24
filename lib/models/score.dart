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

/// Одна нота / аккорд / пауза.
///
/// [keys] — ключи в формате VexFlow: "c/4", аккорд ["c/4","e/4"], а для
/// ударных — с указанием головки ноты, напр. "g/5/x2" (закрытый хай-хэт).
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
  List<String> keys;
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
    required this.keys,
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

  MusicNote copy() => MusicNote(
        keys: List.of(keys),
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

  Map<String, dynamic> toJson() => {
        'keys': keys,
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

  factory MusicNote.fromJson(Map<String, dynamic> j) => MusicNote(
        keys: (j['keys'] as List).map((e) => e as String).toList(),
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
        'measures': measures.map((m) => m.toJson()).toList(),
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
