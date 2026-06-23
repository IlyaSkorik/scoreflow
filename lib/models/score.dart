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
        InstrumentType.piano => 'Клавишные',
        InstrumentType.drums => 'Ударные',
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

/// Одна нота / аккорд / пауза.
///
/// [keys] — ключи в формате VexFlow: "c/4", аккорд ["c/4","e/4"], а для
/// ударных — с указанием головки ноты, напр. "g/5/x2" (закрытый хай-хэт).
/// [duration] — базовая длительность VexFlow: w h q 8 16 (без 'r').
/// [rest] — если true, рисуется пауза соответствующей длительности.
class MusicNote {
  List<String> keys;
  String duration;
  bool rest;

  MusicNote({
    required this.keys,
    required this.duration,
    this.rest = false,
  });

  MusicNote copy() =>
      MusicNote(keys: List.of(keys), duration: duration, rest: rest);

  Map<String, dynamic> toJson() => {
        'keys': keys,
        'duration': duration,
        'rest': rest,
      };

  factory MusicNote.fromJson(Map<String, dynamic> j) => MusicNote(
        keys: (j['keys'] as List).map((e) => e as String).toList(),
        duration: j['duration'] as String,
        rest: j['rest'] as bool? ?? false,
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
  }) =>
      Score(
        id: id,
        title: title.trim().isEmpty ? 'Без названия' : title.trim(),
        instrument: instrument,
        createdAt: now,
        updatedAt: now,
        measures: [Measure.empty(instrument)],
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
  /// чтобы движок подсветил активную ноту.
  String renderPayload(EditorCursor cursor) => jsonEncode({
        'instrument': instrument.id,
        'keySignature': keySignature,
        'timeSignature': timeSignature.vex,
        'tempo': tempo,
        'measures': measures.map((m) => m.toJson()).toList(),
        'cursor': cursor.toJson(),
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
