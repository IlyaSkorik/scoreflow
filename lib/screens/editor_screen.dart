import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';

import '../data/score_repository.dart';
import '../main.dart' show kEngineUrl;
import '../models/history.dart';
import '../models/keysig.dart';
import '../models/palette.dart';
import '../models/reflow.dart';
import '../models/score.dart';
import '../widgets/metronome_icon.dart';

/// Тональности для пикера в листе «Ещё» (формат VexFlow keySignature).
const List<String> _keySignatures = [
  'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'F', 'Bb', 'Eb', 'Ab', 'Db'
];

/// Служебное значение пикера тональности «Без смены» (убрать смену в такте).
/// Не пересекается с именами тональностей VexFlow.
const String _kInheritKey = '__inherit__';

/// Размеры такта (пресеты) для пикера в листе «Ещё».
const List<String> _timeSignatures = [
  '2/4', '3/4', '4/4', '5/4', '6/8', '7/8', '9/8', '12/8', '2/2', '3/8', '5/8'
];

/// Служебное значение пикера размера «Без смены» (убрать смену в такте).
const String _kInheritTime = '__inherit_ts__';

/// Служебное значение пикера размера «Другой…» (ввод произвольного n/d).
const String _kCustomTime = '__custom_ts__';

/// Подписи типов тактовой черты для пикера в листе «Ещё». Порядок = порядок
/// показа (обычная -> двойная/финальная -> штриховая/пунктирная -> засечка/
/// короткая -> невидимая). Расширяется добавлением значений в [BarlineType]
/// (напр. реприза) без правки логики.
const Map<BarlineType, String> _barlineLabels = {
  BarlineType.normal: 'Обычная',
  BarlineType.doubleBar: 'Двойная',
  BarlineType.finalBar: 'Финальная',
  BarlineType.dashed: 'Штриховая',
  BarlineType.dotted: 'Пунктирная',
  BarlineType.tick: 'Засечка',
  BarlineType.short: 'Короткая',
  BarlineType.invisible: 'Невидимая',
};

const Map<RepeatMark?, String> _repeatLabels = {
  null: 'Нет',
  RepeatMark.start: 'Начало |:',
  RepeatMark.end: 'Конец :|',
  RepeatMark.both: 'Обе :|:',
};

/// Вольты редактора: номер концовки -> подпись. Однотактовые концовки 1./2.
/// (span=1) — типовой выбор; модель/движок поддерживают и многотактовые/
/// произвольные списки, но UI держит простой профессиональный набор.
const Map<int?, String> _voltaLabels = {
  null: 'Нет',
  1: '1-я концовка',
  2: '2-я концовка',
};

/// Редактор партитуры: WebView-рендер (VexFlow) + панель ввода нот + плеер.
class EditorScreen extends StatefulWidget {
  final String scoreId;
  final ScoreRepository repository;
  const EditorScreen({
    super.key,
    required this.scoreId,
    required this.repository,
  });

  @override
  State<EditorScreen> createState() => _EditorScreenState();
}

class _EditorScreenState extends State<EditorScreen> {
  InAppWebViewController? _web;
  bool _ready = false;

  Score? _score;
  final EditorCursor _cursor = EditorCursor();
  final ScoreHistory _history = ScoreHistory();
  String _duration = 'q';
  int _dots = 0; // 0 = без точки, 1 = пунктир (модель расширяема до 2–3)
  bool _stackMode = false; // Аккорд-режим: ввод наращивает созвучие, не двигая курсор
  // Якорь выделения диапазона (общий для slur и tuplet): первый конец. null —
  // не активен. Не часть документа — живёт только в сессии редактирования.
  EditorCursor? _selAnchor;
  bool _isPlaying = false;
  bool _metronome = false;
  bool _sustain = false;
  bool _follow = true; // Vertical Follow Playback (по умолчанию вкл.)

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    // Останавливаем звук при выходе из редактора.
    _web?.evaluateJavascript(source: "window.handlePlaybackCommand('PAUSE', 0);");
    super.dispose();
  }

  Future<void> _load() async {
    final s = await widget.repository.load(widget.scoreId);
    if (s == null) {
      if (mounted) Navigator.pop(context);
      return;
    }
    _cursor.voice = s.instrument.voiceIds.first;
    _cursor.measure = 0;
    _cursor.index = _voiceOf(s, 0, _cursor.voice).length - 1;
    setState(() {
      _score = s;
      _normalize(); // добивка пауз/целостность тактов до первого рендера
    });
    _render();
    _maybeLoadSamples();
  }

  // --- доступ к данным -------------------------------------------------
  List<MusicNote> _voiceOf(Score s, int measure, String voice) =>
      s.measures[measure].voice(voice);

  List<MusicNote> get _activeVoice =>
      _voiceOf(_score!, _cursor.measure, _cursor.voice);

  // Заполненность реальным материалом — авто-паузы добивки не учитываем,
  // иначе индикатор всегда показывал бы «полный такт».
  double _filled(List<MusicNote> notes) =>
      notes.fold(0.0, (s, n) => s + (n.auto ? 0 : noteTime(n)));

  // --- мост к движку ---------------------------------------------------
  void _render() {
    if (!_ready || _web == null || _score == null) return;
    final payload = _score!.renderPayload(_cursor, selection: _selectionMap());
    final b64 = base64Encode(utf8.encode(payload));
    _web!.evaluateJavascript(
      source: "window.ScoreFlow && window.ScoreFlow.renderB64('$b64');",
    );
  }

  /// Диапазон выделения для подсветки набора slur: [_selAnchor]..курсор в
  /// одном голосе. null, если якоря нет / курсор в другом голосе / на пустом
  /// слоте. Концы упорядочены по (такт, индекс).
  static int _rank(int measure, int index) => measure * 100000 + index;

  Map<String, dynamic>? _selectionMap() {
    final a = _selAnchor;
    if (a == null || a.voice != _cursor.voice || _cursor.index < 0) return null;
    final aR = _rank(a.measure, a.index);
    final cR = _rank(_cursor.measure, _cursor.index);
    final lo = aR <= cR ? a : _cursor;
    final hi = aR <= cR ? _cursor : a;
    return {
      'voice': a.voice,
      'm0': lo.measure,
      'i0': lo.index,
      'm1': hi.measure,
      'i1': hi.index,
    };
  }

  void _sendPlayback(String action) {
    _web?.evaluateJavascript(
      source: "window.handlePlaybackCommand('$action', ${_score!.tempo});",
    );
  }

  void _persist() {
    if (_score != null) widget.repository.save(_score!);
  }

  void _commit(VoidCallback mutation) {
    // Снимок состояния ДО правки (глубокая копия + курсор) для Undo.
    final before = _takeSnapshot();
    final beforeJson = before.score.encode();
    setState(() {
      mutation();
      _normalize(); // соблюдение размера такта после любого изменения
    });
    // В историю — только при РЕАЛЬНОМ изменении документа. Навигация ◀▶ и
    // смена голоса меняют лишь курсор (encode совпадает) и в Undo не идут —
    // как в MuseScore/Dorico, где Undo откатывает партитуру, а не выбор.
    if (_score!.encode() != beforeJson) {
      _history.record(before);
    }
    _render();
    _persist();
  }

  /// Снимок текущего состояния редактора (партитура + курсор) для истории.
  EditorSnapshot _takeSnapshot() => EditorSnapshot(
        score: _score!.copy(),
        measure: _cursor.measure,
        voice: _cursor.voice,
        index: _cursor.index,
      );

  /// Откат / повтор. Восстанавливают партитуру и курсор как есть, без
  /// повторной нормализации — снимок уже валиден (флаг auto сохранён в копии).
  /// Рендер VexFlow, индикатор заполнения, пиано/драм-панель и доступность
  /// кнопок ↶/↷ обновляются через setState. Режим аккорда/перо (настройки
  /// инструмента) сознательно не трогаем — они не часть документа.
  void _undo() {
    final restored = _history.undo(_takeSnapshot());
    if (restored != null) _applySnapshot(restored);
  }

  void _redo() {
    final restored = _history.redo(_takeSnapshot());
    if (restored != null) _applySnapshot(restored);
  }

  void _applySnapshot(EditorSnapshot snap) {
    setState(() {
      _score = snap.score;
      _selAnchor = null; // позиции могли сместиться — якорь набора slur сбрасываем
      _cursor
        ..measure = snap.measure
        ..voice = snap.voice
        ..index = snap.index;
    });
    _render();
    _persist();
  }

  /// Перераскладывает ноты каждого голоса по тактам так, чтобы сумма
  /// длительностей в такте не превышала размер. Лишнее уходит в следующий
  /// такт (целыми нотами, без расщепления). Курсор сохраняется по идентичности
  /// ноты. Пустые такты, добавленные вручную, не теряются.
  void _normalize() {
    final s = _score!;
    final cv = _cursor.voice;
    final keepCount = s.measures.length;
    // Смены тональности И размера — ПОЗИЦИОННЫЕ якоря (привязаны к НОМЕРУ такта,
    // а не к нотам). При перепаковке нот их сохраняем по индексу такта, чтобы
    // reflow не «сдвигал» и не терял смены.
    final keysByIndex = s.measures.map((m) => m.keySignature).toList();
    final tsByIndex = s.measures.map((m) => m.timeSignature).toList();
    final barByIndex = s.measures.map((m) => m.barline).toList();
    final repeatByIndex = s.measures.map((m) => m.repeat).toList();
    final voltaByIndex = s.measures.map((m) => m.volta).toList();

    // ДЕЙСТВУЮЩИЙ размер такта по индексу — ЕДИНЫЙ источник ёмкости. Смены
    // размера позиционны (по индексу), поэтому одна функция описывает и старую,
    // и новую раскладку. За пределами текущего списка тактов размер тянется
    // последним известным (effectiveTimeSignatureAt клампит индекс).
    TimeSignature effTsAt(int i) => s.effectiveTimeSignatureAt(i);
    double capAt(int i) => effTsAt(i).capacity; // доля от целой ноты
    double measureQAt(int i) => effTsAt(i).capacity * 4; // четверти

    // нота под курсором (по ссылке), чтобы потом вернуть курсор на неё.
    // Авто-паузы добивки пересоздаются — на них курсор не закрепляем.
    final curList = _voiceOf(s, _cursor.measure, cv);
    final MusicNote? cursorNote =
        (_cursor.index >= 0 && _cursor.index < curList.length &&
                !curList[_cursor.index].auto)
            ? curList[_cursor.index]
            : null;

    // упаковка каждого голоса в «корзины» (такты) по ёмкости КАЖДОГО такта.
    // Авто-паузы выбрасываем перед упаковкой — иначе добивка накапливалась бы.
    final bins = <String, List<List<MusicNote>>>{};
    var maxBins = 1;
    for (final v in s.instrument.voiceIds) {
      final flat = <MusicNote>[];
      for (final m in s.measures) {
        flat.addAll(m.voice(v).where((n) => !n.auto));
      }
      final packed = packVoiceVariable(flat, capAt);
      bins[v] = packed;
      if (packed.length > maxBins) maxBins = packed.length;
    }

    final count = maxBins > keepCount ? maxBins : keepCount;
    final measures = <Measure>[];
    for (var i = 0; i < count; i++) {
      measures.add(Measure(
        {
          for (final v in s.instrument.voiceIds)
            v: i < bins[v]!.length ? bins[v]![i] : <MusicNote>[],
        },
        // Смены тональности/размера и тактовая черта остаются на своём такте
        // (позиционный якорь по индексу — переживают reflow).
        keySignature: i < keysByIndex.length ? keysByIndex[i] : null,
        timeSignature: i < tsByIndex.length ? tsByIndex[i] : null,
        barline: i < barByIndex.length ? barByIndex[i] : null,
        repeat: i < repeatByIndex.length ? repeatByIndex[i] : null,
        volta: i < voltaByIndex.length ? voltaByIndex[i] : null,
      ));
    }

    // Целостность такта: каждый частично заполненный такт добиваем
    // каноническими паузами по ДЕЙСТВУЮЩЕМУ размеру ЭТОГО такта. Полностью
    // пустые такты оставляем пустыми — движок рисует им целую паузу.
    for (var mi = 0; mi < measures.length; mi++) {
      final m = measures[mi];
      final ts = effTsAt(mi);
      final cap = ts.capacity;
      for (final v in s.instrument.voiceIds) {
        final notes = m.voice(v);
        if (notes.isEmpty) continue;
        final filled = notes.fold(0.0, (sum, n) => sum + noteTime(n));
        final remainder = cap - filled;
        if (remainder > 1e-6) {
          notes.addAll(fillRests(filled, remainder, ts.beats, ts.beatValue));
        }
      }
    }
    // Оттенки и вилки переезжают вместе с музыкой: перепривязка по абсолютной
    // доле к новой раскладке (measureQ в четвертях, разный для разных размеров).
    // Делаем ДО подмены s.measures — источник позиций — прежняя раскладка.
    reflowDynamicsVariable(s.measures, measures, measureQAt);
    reflowHairpinsVariable(s.measures, measures, measureQAt);
    s.measures = measures;

    // вернуть курсор на ту же ноту (или подровнять в границы)
    if (cursorNote != null) {
      for (var mi = 0; mi < measures.length; mi++) {
        final idx = measures[mi].voice(cv).indexOf(cursorNote);
        if (idx >= 0) {
          _cursor.measure = mi;
          _cursor.index = idx;
          return;
        }
      }
    }
    _cursor.measure = _cursor.measure.clamp(0, measures.length - 1);
    _cursor.index =
        _cursor.index.clamp(-1, _voiceOf(s, _cursor.measure, cv).length - 1);
  }

  // --- операции редактирования ----------------------------------------

  /// Ввод ноты/паузы.
  ///
  /// Основной режим (по умолчанию) — быстрый последовательный набор: ввод
  /// ноты заполняет текущую/следующую паузу либо вставляется после курсора, и
  /// курсор движется вперёд (мелодии набираются без лишних нажатий).
  ///
  /// Аккорд-режим ([_stackMode], тумблер «Аккорд») — многозвучие: когда курсор
  /// стоит на ЗВУЧАЩЕЙ ноте, ввод головки добавляет её к этой же ноте, не
  /// двигая курсор (повторный ввод той же головки — убирает; см. [_toggleKeys]).
  /// Длительность не меняется — наращиваем созвучие, а не ритм. Механизм общий
  /// для пиано и ударных. Паузы не стекаются.
  ///
  /// «Умная замена» в обоих режимах:
  /// - курсор на паузе — она заполняется нотой/паузой текущей длительности
  ///   (курсор остаётся на месте);
  /// - курсор на ноте, следующий слот — пауза: заполняется она (курсор на неё);
  /// - иначе вставка ПОСЛЕ курсора.
  /// Соблюдение размера такта обеспечивает [_normalize].
  void _insertNote({required List<String> keys, bool rest = false}) {
    _commit(() {
      final notes = _activeVoice;
      final i = _cursor.index;

      // 0) аккорд-режим: на звучащей ноте ввод головки наращивает созвучие
      if (_stackMode &&
          !rest &&
          keys.isNotEmpty &&
          i >= 0 &&
          i < notes.length &&
          !notes[i].rest) {
        _toggleKeys(notes[i], keys);
        return;
      }

      // 1) курсор на паузе -> заполняем её (свежая нота без унаследованных лиг)
      if (i >= 0 && i < notes.length && notes[i].rest) {
        notes[i]
          ..keys = _sortedKeys(keys)
          ..rest = rest
          ..duration = _duration
          ..dots = _dots
          ..auto = false;
        _resetLigatures(notes[i]);
        return;
      }

      // 2) курсор на ноте, следующий слот — пауза -> заполняем её
      final next = i + 1;
      if (next >= 0 && next < notes.length && notes[next].rest) {
        notes[next]
          ..keys = _sortedKeys(keys)
          ..rest = rest
          ..duration = _duration
          ..dots = _dots
          ..auto = false;
        _resetLigatures(notes[next]);
        _cursor.index = next;
        return;
      }

      // 3) иначе вставляем после курсора
      final pos = next.clamp(0, notes.length);
      notes.insert(
          pos,
          MusicNote.fromKeys(
              keys: _sortedKeys(keys),
              duration: _duration,
              dots: _dots,
              rest: rest));
      _cursor.index = pos;
    });
  }

  /// Сортирует головки созвучия снизу вверх (требование VexFlow) и снимает
  /// дубли. Для ударных порядок идёт по линии стана (см. [keyPitchRank]).
  List<String> _sortedKeys(List<String> keys) {
    final out = <String>[];
    for (final k in keys) {
      if (!out.contains(k)) out.add(k);
    }
    out.sort((a, b) => keyPitchRank(a).compareTo(keyPitchRank(b)));
    return out;
  }

  /// Toggle головок [keys] у ноты [n]: имеющаяся головка убирается, новая —
  /// добавляется. Если головок не осталось — нота становится паузой (как при
  /// «Стереть»). Длительность и точки не трогаем.
  void _toggleKeys(MusicNote n, List<String> keys) {
    final set = List<String>.of(n.keys);
    for (final k in keys) {
      if (!set.remove(k)) set.add(k);
    }
    if (set.isEmpty) {
      n
        ..keys = []
        ..rest = true;
      _resetLigatures(n); // нота стёрта -> снять её лиги (как при удалении)
    } else {
      n
        ..keys = _sortedKeys(set)
        ..rest = false;
    }
  }

  /// Удаление под курсором: нота превращается в паузу той же длительности
  /// (ритм не «съезжает»). Пауза остаётся на месте как держатель ритма —
  /// удалять её нечего. Лиги, относящиеся к удаляемой ноте, снимаются: пауза
  /// не должна оставаться связанной (иначе дуга «висит» на паузе, а флаг
  /// «оживает» при повторном вводе ноты в этот слот).
  void _deleteAtCursor() {
    final notes = _activeVoice;
    if (notes.isEmpty || _cursor.index < 0) return;
    final n = notes[_cursor.index];
    if (n.rest) return;
    _commit(() {
      _clearLigaturesAt(_cursor.measure, _cursor.voice, _cursor.index);
      n
        ..keys = []
        ..rest = true;
    });
  }

  /// Снимает все лиги, относящиеся к ноте (measure,voice,index): её собственные
  /// маркеры (tie/slur) и ВХОДЯЩУЮ лигу длительности от предыдущей ноты голоса.
  void _clearLigaturesAt(int measure, String voice, int index) {
    final notes = _voiceOf(_score!, measure, voice);
    if (index < 0 || index >= notes.length) return;
    notes[index]
      ..tieToNext = false
      ..slurStart = false
      ..slurStop = false;
    _prevNoteInVoice(measure, voice, index)?.tieToNext = false;
  }

  /// Сбрасывает флаги лиг ноты (для переиспользуемого слота — напр. когда
  /// пауза заполняется свежей нотой, она не должна унаследовать старую лигу).
  void _resetLigatures(MusicNote n) => n
    ..tieToNext = false
    ..slurStart = false
    ..slurStop = false;

  /// Непосредственно предшествующая нота того же голоса (слот index-1, иначе
  /// последняя нота ближайшего предыдущего непустого такта) или null.
  MusicNote? _prevNoteInVoice(int measure, String voice, int index) {
    if (index > 0) return _voiceOf(_score!, measure, voice)[index - 1];
    for (var m = measure - 1; m >= 0; m--) {
      final notes = _voiceOf(_score!, m, voice);
      if (notes.isNotEmpty) return notes.last;
    }
    return null;
  }

  // --- Лиги ------------------------------------------------------------

  /// Текущая нота пригодна как конец лиги (существует и не пауза).
  bool get _cursorOnNote {
    final notes = _activeVoice;
    final i = _cursor.index;
    return i >= 0 && i < notes.length && !notes[i].rest;
  }

  /// Tie (лига длительности): тумблер на ноте под курсором — связь со
  /// следующей нотой того же голоса. Валидность (та же высота, без разрыва)
  /// проверяет движок при рендере/playback; модель остаётся пермиссивной.
  void _toggleTie() {
    if (!_cursorOnNote) return;
    final note = _activeVoice[_cursor.index];
    _commit(() => note.tieToNext = !note.tieToNext);
  }

  // --- Альтерация (Accidental) -----------------------------------------

  /// Знак альтерации головок ноты под курсором, если он ЕДИН для всех голов
  /// (иначе null — смешанный аккорд). Для подсветки активной кнопки инструмента.
  Accidental? get _cursorAccidental {
    if (!_cursorOnNote) return null;
    final ps = _activeVoice[_cursor.index].pitches;
    if (ps.isEmpty) return null;
    final a = ps.first.accidental;
    return ps.every((p) => p.accidental == a) ? a : null;
  }

  /// Инструмент «Альтерация»: ставит знак [acc] на ВСЕ головки ноты под
  /// курсором (per-notehead модель; пока без выбора отдельной головки аккорда).
  /// Для ударных неприменимо. Идёт через обычный пайплайн редактора
  /// (_commit -> normalize -> render -> persist -> история Undo/Redo).
  void _setAccidental(Accidental acc) {
    if (_score!.instrument == InstrumentType.drums) return; // неприменимо
    if (!_cursorOnNote) return;
    final note = _activeVoice[_cursor.index];
    _commit(() {
      note.pitches = note.pitches.map((p) => p.withAccidental(acc)).toList();
    });
  }

  // --- Динамика (Dynamic) ----------------------------------------------

  /// Оттенок можно поставить, когда курсор стоит на реальном слоте (ноте или
  /// паузе) — оттенок привязывается к его доле. Применимо к пиано и ударным.
  bool get _canDynamic =>
      _cursor.index >= 0 && _cursor.index < _activeVoice.length;

  /// Оттенок, стоящий на доле ноты под курсором (для подсветки активной кнопки),
  /// либо null.
  DynamicMark? get _cursorDynamic {
    if (!_canDynamic) return null;
    final beat = onsetBeats(_activeVoice, _cursor.index);
    for (final d in _score!.measures[_cursor.measure].dynamicsOf(_cursor.voice)) {
      if ((d.beat - beat).abs() < 1e-6) return d.mark;
    }
    return null;
  }

  /// Инструмент «Динамика»: ставит оттенок [mark] на долю ноты под курсором.
  /// Повторный тап того же знака — снимает (toggle); другой знак — заменяет.
  /// Оттенок — нотационный объект на ритмической позиции (НЕ свойство ноты);
  /// действует на все последующие ноты голоса до следующего оттенка (разрешение
  /// громкости — в playback-компиляторе движка). Идёт через обычный пайплайн
  /// (_commit -> normalize -> render -> persist -> Undo/Redo).
  void _setDynamic(DynamicMark mark) {
    if (!_canDynamic) return;
    _commit(() {
      final beat = onsetBeats(_activeVoice, _cursor.index);
      final list = _score!.measures[_cursor.measure].dynamicsOf(_cursor.voice);
      final at = list.indexWhere((d) => (d.beat - beat).abs() < 1e-6);
      if (at >= 0) {
        if (list[at].mark == mark) {
          list.removeAt(at); // повторный тот же знак — снять
        } else {
          list[at] = Dynamic(mark: mark, voice: _cursor.voice, beat: beat);
        }
      } else {
        list
          ..add(Dynamic(mark: mark, voice: _cursor.voice, beat: beat))
          ..sort((a, b) => a.beat.compareTo(b.beat));
      }
    });
  }

  // --- Артикуляции (staccato/accent/…) ---------------------------------

  /// Артикуляции ноты под курсором (для подсветки активных кнопок). Пусто, если
  /// курсор не на реальной ноте.
  Set<Articulation> get _cursorArticulations =>
      _cursorOnNote ? _activeVoice[_cursor.index].articulations.toSet() : {};

  /// Инструмент «Артикуляция»: переключает знак [a] на ноте под курсором (toggle
  /// — есть/нет). Несколько совместимых знаков сосуществуют (staccato + accent).
  /// Артикуляция принадлежит НОТЕ, поэтому переживает reflow вместе с ней;
  /// влияние на playback считает движок (единое место). Идёт через обычный
  /// пайплайн (_commit -> normalize -> render -> persist -> Undo/Redo).
  void _toggleArticulation(Articulation a) {
    if (!_cursorOnNote) return;
    _commit(() {
      final list = _activeVoice[_cursor.index].articulations;
      if (!list.remove(a)) list.add(a);
    });
  }

  // --- Вилки (Hairpin: crescendo/diminuendo) ---------------------------

  /// (m,b) ≤ (m2,b2) лексикографически (такт, затем доля) — для проверки
  /// покрытия/пересечения диапазонов вилок.
  bool _leq(int ma, double ba, int mb, double bb) =>
      ma < mb || (ma == mb && ba <= bb + 1e-6);

  /// Вилка активного голоса, ПОКРЫВАЮЩАЯ позицию курсора, либо null. Нужна для
  /// снятия (повторный тап инструмента на вилке) и подсветки кнопок.
  Hairpin? get _cursorHairpin {
    if (!_cursorOnNote) return null;
    final v = _cursor.voice;
    final cm = _cursor.measure;
    final cb = onsetBeats(_activeVoice, _cursor.index);
    for (var mi = 0; mi < _score!.measures.length; mi++) {
      for (final h in _score!.measures[mi].hairpins) {
        if (h.voice != v) continue;
        if (_leq(mi, h.startBeat, cm, cb) && _leq(cm, cb, h.endMeasure, h.endBeat)) {
          return h;
        }
      }
    }
    return null;
  }

  bool get _hairpinOnCursor => _cursorHairpin != null;

  /// Инструмент «Вилка» ([type] = crescendo/diminuendo). Если курсор внутри
  /// вилки — снимаем её. Иначе — механизм выделения диапазона (как slur): первый
  /// тап ставит якорь, второй (другой конец того же голоса) навешивает вилку.
  /// Вилка — нотационный объект, РАСШИРЯЮЩИЙ динамику: громкость интерполирует
  /// playback-компилятор движка (единое место), редактор лишь пишет ЧТО и ГДЕ.
  void _onHairpin(HairpinType type) {
    final existing = _cursorHairpin;
    if (existing != null) {
      _removeHairpin(existing);
      return;
    }
    if (!_cursorOnNote) return;
    final r = _consumeSelection();
    if (r == null) return; // только что поставили якорь — ждём второй конец
    _applyHairpin(type, r.voice, r.m0, r.i0, r.m1, r.i1);
  }

  /// Навесить вилку на диапазон одного голоса. Пересекающиеся вилки того же
  /// голоса убираются (без наложений — как в проф. редакторах). Вилка кладётся на
  /// такт-НАЧАЛО ([m0]); конец — ([m1], доля ноты [i1]).
  void _applyHairpin(
      HairpinType type, String voice, int m0, int i0, int m1, int i1) {
    _commit(() {
      final startBeat = onsetBeats(_voiceOf(_score!, m0, voice), i0);
      final endBeat = onsetBeats(_voiceOf(_score!, m1, voice), i1);
      for (var mi = 0; mi < _score!.measures.length; mi++) {
        _score!.measures[mi].hairpins.removeWhere((h) =>
            h.voice == voice &&
            _leq(mi, h.startBeat, m1, endBeat) &&
            _leq(m0, startBeat, h.endMeasure, h.endBeat));
      }
      _score!.measures[m0].hairpins.add(Hairpin(
        type: type,
        voice: voice,
        startBeat: startBeat,
        endMeasure: m1,
        endBeat: endBeat,
      ));
    });
  }

  /// Снять вилку [h] (поиск по её такту-началу).
  void _removeHairpin(Hairpin h) {
    _commit(() {
      for (final m in _score!.measures) {
        if (m.hairpins.remove(h)) break;
      }
    });
  }

  /// Общий механизм выделения диапазона для slur и tuplet. Если якорь активен
  /// (тот же голос, другая нота) — возвращает упорядоченный диапазон и сбрасывает
  /// якорь; иначе ставит/снимает якорь на текущей ноте и возвращает null.
  ({String voice, int m0, int i0, int m1, int i1})? _consumeSelection() {
    final a = _selAnchor;
    final sameNote = a != null &&
        a.voice == _cursor.voice &&
        a.measure == _cursor.measure &&
        a.index == _cursor.index;
    if (a == null || a.voice != _cursor.voice || sameNote) {
      setState(() {
        _selAnchor = sameNote
            ? null
            : EditorCursor(
                measure: _cursor.measure,
                voice: _cursor.voice,
                index: _cursor.index);
      });
      _render();
      return null;
    }
    final aR = _rank(a.measure, a.index);
    final cR = _rank(_cursor.measure, _cursor.index);
    final lo = aR <= cR ? a : _cursor;
    final hi = aR <= cR ? _cursor : a;
    setState(() => _selAnchor = null);
    return (
      voice: a.voice,
      m0: lo.measure,
      i0: lo.index,
      m1: hi.measure,
      i1: hi.index
    );
  }

  /// Slur (лига фразировки) — авто по выделению. Первый вызов ставит якорь;
  /// второй (другая нота того же голоса) навешивает дугу на диапазон.
  void _toggleSlur() {
    if (!_cursorOnNote) return;
    final r = _consumeSelection();
    if (r != null) _applySlur(r.voice, r.m0, r.i0, r.m1, r.i1);
  }

  /// Навесить фразировочную дугу на диапазон одного голоса: slurStart на первой
  /// ноте, slurStop на последней; промежуточные маркеры внутри диапазона
  /// сбрасываются (этап 1 — без вложенных дуг).
  void _applySlur(String voice, int m0, int i0, int m1, int i1) {
    _commit(() {
      final lo = _rank(m0, i0);
      final hi = _rank(m1, i1);
      for (var m = m0; m <= m1; m++) {
        final notes = _voiceOf(_score!, m, voice);
        for (var ix = 0; ix < notes.length; ix++) {
          final r = _rank(m, ix);
          if (r < lo || r > hi) continue;
          notes[ix]
            ..slurStart = (m == m0 && ix == i0)
            ..slurStop = (m == m1 && ix == i1);
        }
      }
    });
  }

  /// Tuplet (нестандартная ритмика) — операция над выделением, НЕ режим ввода.
  /// Курсор уже в группе → снять tuplet со всей группы. Иначе: первый вызов
  /// ставит якорь; со вторым (диапазон) спрашиваем соотношение и применяем.
  Future<void> _onTuplet() async {
    if (_cursorOnNote && _activeVoice[_cursor.index].tuplet != null) {
      _clearTupletAtCursor();
      return;
    }
    if (!_cursorOnNote) return;
    final r = _consumeSelection();
    if (r == null) return; // только что поставили якорь — ждём второй конец
    final ratio = await _pickTupletRatio();
    if (ratio == null) return;
    _applyTuplet(r.voice, r.m0, r.i0, r.m1, r.i1, ratio.$1, ratio.$2);
  }

  /// Проставить соотношение [actual]:[normal] на нотах диапазона; tupletStart —
  /// на первой. Группа атомарна при reflow (см. packVoice/tupletChunks).
  void _applyTuplet(
      String voice, int m0, int i0, int m1, int i1, int actual, int normal) {
    _commit(() {
      final lo = _rank(m0, i0);
      final hi = _rank(m1, i1);
      var first = true;
      for (var m = m0; m <= m1; m++) {
        final notes = _voiceOf(_score!, m, voice);
        for (var ix = 0; ix < notes.length; ix++) {
          final r = _rank(m, ix);
          if (r < lo || r > hi) continue;
          notes[ix]
            ..tuplet = Tuplet(actual, normal)
            ..tupletStart = first;
          first = false;
        }
      }
    });
  }

  /// Снять tuplet со всей группы, содержащей ноту под курсором (группа атомарна
  /// и лежит в одном такте — ищем её границы в текущем голосе).
  void _clearTupletAtCursor() {
    final notes = _activeVoice;
    final i = _cursor.index;
    if (i < 0 || i >= notes.length || notes[i].tuplet == null) return;
    final ref = notes[i].tuplet!;
    bool same(MusicNote n) =>
        n.tuplet != null &&
        n.tuplet!.actualNotes == ref.actualNotes &&
        n.tuplet!.normalNotes == ref.normalNotes;
    var s = i;
    while (s > 0 && !notes[s].tupletStart && same(notes[s - 1])) {
      s--;
    }
    var e = i;
    while (e + 1 < notes.length && !notes[e + 1].tupletStart && same(notes[e + 1])) {
      e++;
    }
    _commit(() {
      for (var k = s; k <= e; k++) {
        notes[k]
          ..tuplet = null
          ..tupletStart = false;
      }
    });
  }

  /// Мини-лист выбора соотношения tuplet. Возвращает (actual, normal) или null.
  Future<(int, int)?> _pickTupletRatio() async {
    const presets = <(String, int, int)>[
      ('Триоль', 3, 2),
      ('Квинтоль', 5, 4),
      ('Секстоль', 6, 4),
      ('Септоль', 7, 4),
      ('Дуоль', 2, 3),
    ];
    return showModalBottomSheet<(int, int)>(
      context: context,
      showDragHandle: true,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
              child: Text('Tuplet (нестандартная ритмика)',
                  style: Theme.of(ctx).textTheme.titleMedium),
            ),
            for (final p in presets)
              ListTile(
                dense: true,
                leading: Text('${p.$2}:${p.$3}',
                    style: const TextStyle(
                        fontWeight: FontWeight.bold, fontSize: 16)),
                title: Text(p.$1),
                onTap: () => Navigator.pop(ctx, (p.$2, p.$3)),
              ),
          ],
        ),
      ),
    );
  }

  /// Диалог произвольного размера: числитель (1..32) и знаменатель (степень
  /// двойки: 1,2,4,8,16). Возвращает строку "n/d" или null. Архитектура остаётся
  /// расширяемой под кастомную группировку долей (beat grouping) в будущем.
  Future<String?> _pickCustomTimeSignature(TimeSignature current) async {
    var beats = current.beats.clamp(1, 32);
    var beatValue = const [1, 2, 4, 8, 16].contains(current.beatValue)
        ? current.beatValue
        : 4;
    return showDialog<String>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setLocal) => AlertDialog(
          title: const Text('Произвольный размер'),
          content: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Expanded(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Text('Доли'),
                    DropdownButton<int>(
                      value: beats,
                      isExpanded: true,
                      items: [
                        for (var i = 1; i <= 32; i++)
                          DropdownMenuItem(value: i, child: Text('$i'))
                      ],
                      onChanged: (v) =>
                          setLocal(() => beats = v ?? beats),
                    ),
                  ],
                ),
              ),
              const Padding(
                padding: EdgeInsets.symmetric(horizontal: 8),
                child: Text('/', style: TextStyle(fontSize: 24)),
              ),
              Expanded(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Text('Длительность'),
                    DropdownButton<int>(
                      value: beatValue,
                      isExpanded: true,
                      items: const [
                        DropdownMenuItem(value: 1, child: Text('1')),
                        DropdownMenuItem(value: 2, child: Text('2')),
                        DropdownMenuItem(value: 4, child: Text('4')),
                        DropdownMenuItem(value: 8, child: Text('8')),
                        DropdownMenuItem(value: 16, child: Text('16')),
                      ],
                      onChanged: (v) =>
                          setLocal(() => beatValue = v ?? beatValue),
                    ),
                  ],
                ),
              ),
            ],
          ),
          actions: [
            TextButton(
                onPressed: () => Navigator.pop(ctx),
                child: const Text('Отмена')),
            FilledButton(
              onPressed: () => Navigator.pop(ctx, '$beats/$beatValue'),
              child: const Text('OK'),
            ),
          ],
        ),
      ),
    );
  }

  void _moveNote(int delta) {
    _commit(() {
      final len = _activeVoice.length;
      final next = _cursor.index + delta;
      if (next >= 0 && next < len) {
        _cursor.index = next;
      } else if (delta > 0) {
        _moveMeasure(1, toStart: true);
      } else {
        _moveMeasure(-1, toStart: false);
      }
    });
  }

  void _moveMeasure(int delta, {required bool toStart}) {
    final target = _cursor.measure + delta;
    if (target < 0 || target >= _score!.measures.length) return;
    _cursor.measure = target;
    final len = _voiceOf(_score!, target, _cursor.voice).length;
    _cursor.index = toStart ? (len > 0 ? 0 : -1) : len - 1;
  }

  void _addMeasure() {
    _commit(() {
      _score!.measures.add(Measure.empty(_score!.instrument));
      _cursor.measure = _score!.measures.length - 1;
      _cursor.index = -1;
    });
  }

  void _switchVoice(String voice) {
    _commit(() {
      _cursor.voice = voice;
      _cursor.index = _activeVoice.length - 1;
    });
  }

  /// Курсор по тапу на ноте/паузе на партитуре (из JS-моста).
  void _onNoteTap(int measure, String voice, int index) {
    final s = _score;
    if (s == null || measure < 0 || measure >= s.measures.length) return;
    if (!s.instrument.voiceIds.contains(voice)) return;
    setState(() {
      _cursor.measure = measure;
      _cursor.voice = voice;
      _cursor.index = index.clamp(-1, _voiceOf(s, measure, voice).length - 1);
    });
    _render(); // курсор не меняет данные — без нормализации/сохранения
  }

  void _togglePlay() {
    setState(() => _isPlaying = !_isPlaying);
    _sendPlayback(_isPlaying ? 'PLAY' : 'PAUSE');
  }

  void _toggleMetronome() {
    setState(() => _metronome = !_metronome);
    _web?.evaluateJavascript(
      source: 'window.ScoreFlow && window.ScoreFlow.setMetronome($_metronome);',
    );
  }

  void _toggleSustain() {
    setState(() => _sustain = !_sustain);
    _web?.evaluateJavascript(
      source: 'window.ScoreFlow && window.ScoreFlow.setSustain($_sustain);',
    );
  }

  void _toggleFollow() {
    setState(() => _follow = !_follow);
    _web?.evaluateJavascript(
      source: 'window.ScoreFlow && window.ScoreFlow.setFollowPlayback($_follow);',
    );
  }

  /// Предзагрузка сэмплов под инструмент партитуры (рояль / ударные).
  /// Идемпотентно — повторные вызовы безопасны.
  void _maybeLoadSamples() {
    if (!_ready || _web == null) return;
    final fn = switch (_score?.instrument) {
      InstrumentType.piano => 'loadPiano',
      InstrumentType.drums => 'loadDrums',
      _ => null,
    };
    if (fn == null) return;
    _web!.evaluateJavascript(
      source: 'window.ScoreFlow && window.ScoreFlow.$fn();',
    );
  }

  Future<void> _rename() async {
    final ctrl = TextEditingController(text: _score!.title);
    final title = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Переименовать'),
        content: TextField(controller: ctrl, autofocus: true),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx), child: const Text('Отмена')),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, ctrl.text),
            child: const Text('OK'),
          ),
        ],
      ),
    );
    if (title != null && title.trim().isNotEmpty) {
      _commit(() => _score!.title = title.trim());
    }
  }

  /// Экспорт в PDF. Движок верстает партитуру по страницам A4 (системная и
  /// страничная пагинация с выравниванием по краям) векторно в DOM, после
  /// чего вызывается системная печать — Android/iOS дают «Сохранить в PDF».
  Future<void> _exportPdf() async {
    final score = _score;
    if (score == null || _web == null || !_ready) return;
    final messenger = ScaffoldMessenger.of(context);

    try {
      final payload = score.renderPayload(_cursor);
      final b64 = base64Encode(utf8.encode(payload));
      final res = await _web!.callAsyncJavaScript(
        functionBody: 'return window.ScoreFlow.renderPrintB64(b64);',
        arguments: {'b64': b64},
      );

      final pages = (res?.value as num?)?.toInt() ?? 0;
      if (pages <= 0) {
        throw Exception('не удалось сверстать страницы');
      }

      await _web!.printCurrentPage();
    } catch (e) {
      messenger.showSnackBar(
        SnackBar(content: Text('Не удалось напечатать: $e')),
      );
    }
  }

  void _setTempo(int v) {
    _commit(() => _score!.tempo = v);
    if (_isPlaying) _sendPlayback('PLAY');
  }

  /// Инструмент «Тональность» — вставка/смена/удаление тональности С НАЧАЛА
  /// текущего такта (профессиональная смена тональности по месту).
  ///
  /// Такт 0 — это НАЧАЛЬНАЯ тональность партитуры: на нём меняем
  /// [Score.keySignature] (и снимаем избыточный позиционный `_key` такта 0).
  /// Такт > 0: [key]==null убирает смену; иначе ставит её. Если выбранная
  /// тональность совпадает с действующей в предыдущем такте — смены нет (храним
  /// null): движок ничего не дорисует и не переключит playback («не рисовать,
  /// если не изменилось»).
  ///
  /// Идёт через обычный пайплайн (_commit -> normalize -> render -> persist ->
  /// Undo/Redo): немедленный перерендер, автосейв, отмена/повтор. Для ударных
  /// тональности нет — операция неприменима.
  void _setMeasureKey(String? key) {
    if (_score!.instrument == InstrumentType.drums) return;
    final m = _cursor.measure;
    // Действующая тональность ДО правки — чтобы понять, реально ли она сменилась
    // (и нужно ли нормализовать локальные альтерации).
    final oldEff = _score!.effectiveKeySignatureAt(m);
    _commit(() {
      if (m == 0) {
        _score!.keySignature = key ?? 'C';
        _score!.measures[0].keySignature = null;
      } else if (key == null) {
        _score!.measures[m].keySignature = null;
      } else {
        final prev = _score!.effectiveKeySignatureAt(m - 1);
        _score!.measures[m].keySignature = (key == prev) ? null : key;
      }
      // Нормализация локальных альтераций под новую тональность: избыточные
      // знаки (дающие ту же высоту, что и тональность) убираются, значимые —
      // сохраняются. Звучащие высоты не меняются. Только если тональность
      // действительно сменилась. ДО reflow (_commit -> _normalize), чтобы
      // перепаковка шла уже по очищенным нотам.
      if (_score!.effectiveKeySignatureAt(m) != oldEff) {
        normalizeAccidentalsFrom(_score!, m);
      }
    });
  }

  /// Инструмент «Размер» — вставка/смена/удаление размера С НАЧАЛА текущего
  /// такта (профессиональная смена метра по месту, как в MuseScore/Dorico).
  ///
  /// Такт 0 — это НАЧАЛЬНЫЙ размер партитуры: на нём меняем [Score.timeSignature]
  /// (и снимаем избыточный позиционный `_ts` такта 0). Такт > 0: [ts]==null
  /// убирает смену; иначе ставит её. Если выбранный размер совпадает с
  /// действующим в предыдущем такте — смены нет (храним null): движок ничего не
  /// дорисует («не рисовать, если не изменилось»).
  ///
  /// Идёт через обычный пайплайн (_commit -> normalize -> render -> persist ->
  /// Undo/Redo). Нормализация немедленно перепакует ноты под новую ёмкость
  /// тактов: переполнение уезжает вперёд, нехватка добивается паузами — ноты не
  /// теряются и не дублируются (см. [_normalize]/[packVoiceVariable]).
  void _setMeasureTimeSignature(String? ts) {
    final m = _cursor.measure;
    _commit(() {
      if (m == 0) {
        _score!.timeSignature =
            ts == null ? TimeSignature.common : TimeSignature.parse(ts);
        _score!.measures[0].timeSignature = null;
      } else if (ts == null) {
        _score!.measures[m].timeSignature = null;
      } else {
        final prev = _score!.effectiveTimeSignatureAt(m - 1);
        final parsed = TimeSignature.parse(ts);
        _score!.measures[m].timeSignature = (parsed == prev) ? null : parsed;
      }
    });
  }

  /// Инструмент «Тактовая черта» — установка/смена/снятие черты на ПРАВОЙ границе
  /// текущего такта (профессиональный выбор типа черты по месту, как в MuseScore/
  /// Dorico/Finale). [type]==null или [BarlineType.normal] — вернуть обычную
  /// одиночную черту (снять override, храним null). Иначе поставить выбранный тип.
  ///
  /// Черта — FIRST-CLASS нотационный объект на границе такта (НЕ свойство
  /// рендера): переживает reflow позиционно (по номеру такта), как смены
  /// тональности/размера (см. [_normalize]). Playback не затрагивается (нотация-
  /// only). Идёт через обычный пайплайн (_commit -> normalize -> render ->
  /// persist -> Undo/Redo). Доступно обоим инструментам (черта есть и у ударных).
  void _setMeasureBarline(BarlineType? type) {
    final m = _cursor.measure;
    final chosen = type ?? BarlineType.normal;
    final def = _score!.defaultBarlineAt(m);
    _commit(() {
      // Храним ТОЛЬКО отклонение от позиционного дефолта: совпало с дефолтом
      // (или обычная одиночная) -> null. Тогда финальная черта конца партитуры
      // сама переедет при добавлении такта/reflow, а явные типы остаются.
      _score!.measures[m].barline =
          (chosen.isDefault || chosen == def) ? null : chosen;
    });
  }

  /// Инструмент «Повтор» — вставка/замена/снятие репризы на границе текущего
  /// такта. Повтор хранится отдельно от `_bar`: renderer рисует знак, playback
  /// compiler расширяет порядок воспроизведения, scheduler остаётся простым.
  void _setMeasureRepeat(RepeatMark? repeat) {
    final m = _cursor.measure;
    _commit(() {
      _score!.measures[m].repeat = repeat;
    });
  }

  /// Инструмент «Вольта» — установка/замена/снятие концовки, НАЧИНАющейся с
  /// текущего такта. [number]==null — снять вольту; иначе поставить однотактовую
  /// концовку с этим номером ([Volta.ending]). Вольта — FIRST-CLASS объект-спан,
  /// хранится отдельно от `_repeat`: renderer рисует скобку над станом, playback
  /// compiler (domain/voltas + repeats) выбирает концовку по проходу повтора,
  /// scheduler остаётся простым. Идёт через обычный пайплайн (_commit ->
  /// normalize -> render -> persist -> Undo/Redo), переживает reflow позиционно.
  void _setMeasureVolta(int? number) {
    final m = _cursor.measure;
    _commit(() {
      _score!.measures[m].volta =
          number == null ? null : Volta.ending(number);
    });
  }

  /// Нижний лист «Ещё» — редкие действия вне рабочей зоны: точный темп,
  /// sustain (фортепиано), параметры партитуры (тональность/размер),
  /// добавление такта, переименование, экспорт PDF.
  Future<void> _showMoreSheet() async {
    final score = _score;
    if (score == null) return;
    final isPiano = score.instrument == InstrumentType.piano;
    await showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      // Контента много (темп+слайдер, sustain, тональность, размер, действия) —
      // на фортепиано он не влезает в дефолтные 9/16 экрана. Снимаем потолок
      // высоты и делаем содержимое прокручиваемым, чтобы не переполняло низ.
      isScrollControlled: true,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setSheet) => SafeArea(
          child: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(8, 0, 8, 12),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(8, 0, 8, 4),
                  child:
                      Text('Ещё', style: Theme.of(ctx).textTheme.titleMedium),
                ),
                ListTile(
                  contentPadding: const EdgeInsets.symmetric(horizontal: 8),
                  leading: const Icon(Icons.speed),
                  title: const Text('Темп'),
                  trailing: Text('${score.tempo} BPM',
                      style: const TextStyle(fontWeight: FontWeight.bold)),
                ),
                Slider(
                  value: score.tempo.toDouble().clamp(40, 240),
                  min: 40,
                  max: 240,
                  divisions: 200,
                  label: '${score.tempo} BPM',
                  onChanged: (v) {
                    _setTempo(v.round());
                    setSheet(() {});
                  },
                ),
                if (isPiano)
                  SwitchListTile(
                    contentPadding: const EdgeInsets.symmetric(horizontal: 8),
                    secondary: const Icon(Icons.piano),
                    title: const Text('Демпфер-педаль (sustain)'),
                    value: _sustain,
                    onChanged: (_) {
                      _toggleSustain();
                      setSheet(() {});
                    },
                  ),
                // Тональность — контекстно к ТАКТУ под курсором: такт 1 задаёт
                // начальную тональность партитуры, такты >1 — смену по месту
                // (вставка/смена/удаление). Действующая тональность показана в
                // подзаголовке. Смена немедленно перерендерит экран/PDF и
                // playback, попадёт в Undo/Redo и автосейв.
                if (isPiano)
                  Builder(builder: (ctx) {
                    final m = _cursor.measure;
                    final atStart = m == 0;
                    final eff = score.effectiveKeySignatureAt(m);
                    final own = atStart
                        ? score.keySignature
                        : score.measures[m].keySignature;
                    final String? ddValue = atStart
                        ? (_keySignatures.contains(own) ? own : null)
                        : (own == null
                            ? _kInheritKey
                            : (_keySignatures.contains(own) ? own : null));
                    return ListTile(
                      contentPadding:
                          const EdgeInsets.symmetric(horizontal: 8),
                      leading: const Icon(Icons.music_note),
                      title: Text(atStart
                          ? 'Тональность'
                          : 'Тональность (такт ${m + 1})'),
                      subtitle:
                          atStart ? null : Text('Действует: $eff'),
                      trailing: DropdownButton<String>(
                        value: ddValue,
                        hint: Text(atStart ? eff : 'Без смены'),
                        items: [
                          if (!atStart)
                            const DropdownMenuItem(
                                value: _kInheritKey, child: Text('Без смены')),
                          for (final k in _keySignatures)
                            DropdownMenuItem(value: k, child: Text(k)),
                        ],
                        onChanged: (v) {
                          if (v == null) return;
                          _setMeasureKey(v == _kInheritKey ? null : v);
                          setSheet(() {});
                        },
                      ),
                    );
                  }),
                // Размер — контекстно к ТАКТУ под курсором: такт 1 задаёт
                // начальный размер партитуры, такты >1 — смену по месту
                // (вставка/смена/удаление). Действующий размер показан в
                // подзаголовке. Смена немедленно перепакует ноты под новую
                // ёмкость, перерендерит экран/PDF/playback, попадёт в Undo/Redo
                // и автосейв. Доступно обоим инструментам (метр есть и у ударных).
                Builder(builder: (ctx) {
                  final m = _cursor.measure;
                  final atStart = m == 0;
                  final eff = score.effectiveTimeSignatureAt(m).vex;
                  final own = atStart
                      ? score.timeSignature.vex
                      : score.measures[m].timeSignature?.vex;
                  final String? ddValue = atStart
                      ? (_timeSignatures.contains(own) ? own : _kCustomTime)
                      : (own == null
                          ? _kInheritTime
                          : (_timeSignatures.contains(own)
                              ? own
                              : _kCustomTime));
                  return ListTile(
                    contentPadding: const EdgeInsets.symmetric(horizontal: 8),
                    leading: const Icon(Icons.straighten),
                    title: Text(
                        atStart ? 'Размер' : 'Размер (такт ${m + 1})'),
                    subtitle: atStart ? null : Text('Действует: $eff'),
                    trailing: DropdownButton<String>(
                      value: ddValue,
                      hint: Text(atStart ? eff : 'Без смены'),
                      items: [
                        if (!atStart)
                          const DropdownMenuItem(
                              value: _kInheritTime, child: Text('Без смены')),
                        for (final t in _timeSignatures)
                          DropdownMenuItem(value: t, child: Text(t)),
                        // Текущий нестандартный размер виден как выбранный пункт.
                        if (own != null && !_timeSignatures.contains(own))
                          DropdownMenuItem(
                              value: _kCustomTime, child: Text('$own (своё)')),
                        const DropdownMenuItem(
                            value: _kCustomTime, child: Text('Другой…')),
                      ],
                      onChanged: (v) async {
                        if (v == null) return;
                        if (v == _kInheritTime) {
                          _setMeasureTimeSignature(null);
                        } else if (v == _kCustomTime) {
                          final custom = await _pickCustomTimeSignature(
                              score.effectiveTimeSignatureAt(m));
                          if (custom != null) {
                            _setMeasureTimeSignature(custom);
                          }
                        } else {
                          _setMeasureTimeSignature(v);
                        }
                        setSheet(() {});
                      },
                    ),
                  );
                }),
                // Тактовая черта — контекстно к ТАКТУ под курсором: тип ПРАВОЙ
                // границы (обычная/двойная/финальная/штриховая/пунктирная/
                // засечка/короткая/невидимая). Нотационный объект на границе
                // такта; смена немедленно перерендерит экран/PDF, попадёт в
                // Undo/Redo и автосейв. Доступно обоим инструментам.
                Builder(builder: (ctx) {
                  final m = _cursor.measure;
                  // Показываем ДЕЙСТВУЮЩУЮ черту: на последнем такте без override
                  // это финальная (позиционный дефолт), а не «обычная».
                  final cur = score.effectiveBarlineAt(m);
                  return ListTile(
                    contentPadding: const EdgeInsets.symmetric(horizontal: 8),
                    leading: const Icon(Icons.view_week_outlined),
                    title: Text('Тактовая черта (такт ${m + 1})'),
                    trailing: DropdownButton<BarlineType>(
                      value: cur,
                      items: [
                        for (final t in BarlineType.values)
                          DropdownMenuItem(
                              value: t, child: Text(_barlineLabels[t]!)),
                      ],
                      onChanged: (v) {
                        if (v == null) return;
                        _setMeasureBarline(v);
                        setSheet(() {});
                      },
                    ),
                  );
                }),
                Builder(builder: (ctx) {
                  final m = _cursor.measure;
                  final cur = score.measures[m].repeat;
                  return ListTile(
                    contentPadding: const EdgeInsets.symmetric(horizontal: 8),
                    leading: const Icon(Icons.repeat),
                    title: Text('Повтор (такт ${m + 1})'),
                    trailing: DropdownButton<RepeatMark?>(
                      value: cur,
                      items: [
                        for (final entry in _repeatLabels.entries)
                          DropdownMenuItem<RepeatMark?>(
                              value: entry.key, child: Text(entry.value)),
                      ],
                      onChanged: (v) {
                        _setMeasureRepeat(v);
                        setSheet(() {});
                      },
                    ),
                  );
                }),
                // Вольта (концовка) — контекстно к ТАКТУ под курсором: 1-я/2-я
                // концовка НАЧИНАется с этого такта. Нотационный объект-спан над
                // станом; интегрирован с повтором (playback выбирает концовку по
                // проходу). Смена немедленно перерендерит экран/PDF, попадёт в
                // Undo/Redo и автосейв. Доступно обоим инструментам.
                Builder(builder: (ctx) {
                  final m = _cursor.measure;
                  final n = score.measures[m].volta?.numbers.first;
                  final cur = (n == 1 || n == 2) ? n : null;
                  return ListTile(
                    contentPadding: const EdgeInsets.symmetric(horizontal: 8),
                    leading: const Icon(Icons.repeat_one),
                    title: Text('Вольта (такт ${m + 1})'),
                    trailing: DropdownButton<int?>(
                      value: cur,
                      items: [
                        for (final entry in _voltaLabels.entries)
                          DropdownMenuItem<int?>(
                              value: entry.key, child: Text(entry.value)),
                      ],
                      onChanged: (v) {
                        _setMeasureVolta(v);
                        setSheet(() {});
                      },
                    ),
                  );
                }),
                const Divider(height: 8),
                ListTile(
                  contentPadding: const EdgeInsets.symmetric(horizontal: 8),
                  leading: const Icon(Icons.playlist_add),
                  title: const Text('Добавить такт'),
                  onTap: () {
                    Navigator.pop(ctx);
                    _addMeasure();
                  },
                ),
                ListTile(
                  contentPadding: const EdgeInsets.symmetric(horizontal: 8),
                  leading: const Icon(Icons.drive_file_rename_outline),
                  title: const Text('Переименовать'),
                  onTap: () {
                    Navigator.pop(ctx);
                    _rename();
                  },
                ),
                ListTile(
                  contentPadding: const EdgeInsets.symmetric(horizontal: 8),
                  leading: const Icon(Icons.picture_as_pdf_outlined),
                  title: const Text('Экспорт в PDF'),
                  onTap: () {
                    Navigator.pop(ctx);
                    _exportPdf();
                  },
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  // --- UI --------------------------------------------------------------
  @override
  Widget build(BuildContext context) {
    final score = _score;
    if (score == null) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }

    // Индикатор заполнения — по ДЕЙСТВУЮЩЕМУ размеру такта под курсором
    // (mid-score смены размера учитываются).
    final curTs = score.effectiveTimeSignatureAt(_cursor.measure);
    final filledBeats = _filled(_activeVoice) * curTs.beatValue;
    final totalBeats = curTs.beats;

    return Scaffold(
      appBar: AppBar(
        title: GestureDetector(
          onTap: _rename,
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Flexible(child: Text(score.title, overflow: TextOverflow.ellipsis)),
              const SizedBox(width: 6),
              const Icon(Icons.edit, size: 16),
            ],
          ),
        ),
        // Действия редко-используемые (экспорт, параметры, темп, …) собраны в
        // нижнем листе «Ещё» (кнопка ⋯ в транспорте), а не в AppBar —
        // рабочая зона остаётся под большим пальцем. Сохранение автоматическое
        // (каждый _commit вызывает _persist), отдельная кнопка не нужна.
      ),
      body: Column(
        children: [
          Expanded(
            child: Container(
              color: Colors.white,
              child: InAppWebView(
                initialUrlRequest: URLRequest(url: WebUri(kEngineUrl)),
                initialSettings: InAppWebViewSettings(
                  javaScriptEnabled: true,
                  transparentBackground: false,
                  supportZoom: false,
                  // Разрешаем Web Audio стартовать без прямого DOM-жеста
                  // (воспроизведение запускается через мост из Flutter).
                  mediaPlaybackRequiresUserGesture: false,
                ),
                onWebViewCreated: (c) {
                  _web = c;
                  // Тап по ноте/паузе на партитуре -> перемещение курсора.
                  c.addJavaScriptHandler(
                    handlerName: 'onNoteTap',
                    callback: (args) {
                      if (args.isEmpty || args.first is! Map) return;
                      final data = args.first as Map;
                      _onNoteTap(
                        (data['measure'] as num).toInt(),
                        data['voice'] as String,
                        (data['index'] as num).toInt(),
                      );
                    },
                  );
                  // Движок сообщает об окончании воспроизведения -> сброс кнопки.
                  c.addJavaScriptHandler(
                    handlerName: 'onPlaybackEnded',
                    callback: (args) {
                      if (mounted && _isPlaying) {
                        setState(() => _isPlaying = false);
                      }
                    },
                  );
                },
                onLoadStop: (c, url) {
                  _ready = true;
                  _render();
                  _maybeLoadSamples();
                },
                onReceivedError: (c, request, error) => debugPrint(
                    'WebView error: ${error.type} ${error.description} (${request.url})'),
                onConsoleMessage: (c, msg) => debugPrint('JS: ${msg.message}'),
              ),
            ),
          ),
          _EditorPanel(
            score: score,
            cursor: _cursor,
            duration: _duration,
            dots: _dots,
            stackMode: _stackMode,
            tieOnCursor: _cursorOnNote && _activeVoice[_cursor.index].tieToNext,
            selArmed: _selAnchor != null,
            tupletOnCursor:
                _cursorOnNote && _activeVoice[_cursor.index].tuplet != null,
            canLiga: _cursorOnNote,
            cursorAccidental: _cursorAccidental,
            canDynamic: _canDynamic,
            cursorDynamic: _cursorDynamic,
            filledBeats: filledBeats,
            totalBeats: totalBeats,
            onDuration: (d) => setState(() => _duration = d),
            onDots: (v) => setState(() => _dots = v),
            onToggleStack: () => setState(() => _stackMode = !_stackMode),
            onToggleTie: _toggleTie,
            onToggleSlur: _toggleSlur,
            onTuplet: _onTuplet,
            hairpinOnCursor: _hairpinOnCursor,
            onHairpinCresc: () => _onHairpin(HairpinType.crescendo),
            onHairpinDim: () => _onHairpin(HairpinType.diminuendo),
            onAccidental: _setAccidental,
            onDynamic: _setDynamic,
            cursorArticulations: _cursorArticulations,
            onArticulation: _toggleArticulation,
            onInsert: (keys) => _insertNote(keys: keys),
            onRest: () => _insertNote(keys: const [], rest: true),
            onDelete: _deleteAtCursor,
            onMoveNote: _moveNote,
            onSwitchVoice: _switchVoice,
          ),
        ],
      ),
      bottomNavigationBar: _PlaybackBar(
        tempo: score.tempo,
        isPlaying: _isPlaying,
        metronomeOn: _metronome,
        followOn: _follow,
        canUndo: _history.canUndo,
        canRedo: _history.canRedo,
        onTogglePlay: _togglePlay,
        onToggleMetronome: _toggleMetronome,
        onToggleFollow: _toggleFollow,
        onUndo: _undo,
        onRedo: _redo,
        onTempoTap: _showMoreSheet,
        onOpenMore: _showMoreSheet,
      ),
    );
  }
}

// =====================================================================
//  Панель ввода нот
// =====================================================================
class _EditorPanel extends StatelessWidget {
  final Score score;
  final EditorCursor cursor;
  final String duration;
  final int dots;
  final bool stackMode;
  final bool tieOnCursor; // у ноты под курсором стоит лига длительности
  final bool selArmed; // активно выделение диапазона (якорь для slur/tuplet)
  final bool tupletOnCursor; // нота под курсором входит в tuplet-группу
  final bool canLiga; // курсор на реальной ноте — лиги/tuplet применимы
  final Accidental? cursorAccidental; // знак ноты под курсором (для подсветки)
  final bool canDynamic; // курсор на слоте — оттенок применим
  final DynamicMark? cursorDynamic; // оттенок на доле ноты под курсором
  final double filledBeats;
  final int totalBeats;
  final ValueChanged<String> onDuration;
  final ValueChanged<int> onDots;
  final VoidCallback onToggleStack;
  final VoidCallback onToggleTie;
  final VoidCallback onToggleSlur;
  final VoidCallback onTuplet;
  final bool hairpinOnCursor; // курсор внутри вилки (для подсветки/снятия)
  final VoidCallback onHairpinCresc;
  final VoidCallback onHairpinDim;
  final ValueChanged<Accidental> onAccidental;
  final ValueChanged<DynamicMark> onDynamic;
  final Set<Articulation> cursorArticulations; // знаки ноты под курсором
  final ValueChanged<Articulation> onArticulation;
  final ValueChanged<List<String>> onInsert;
  final VoidCallback onRest;
  final VoidCallback onDelete;
  final ValueChanged<int> onMoveNote;
  final ValueChanged<String> onSwitchVoice;

  const _EditorPanel({
    required this.score,
    required this.cursor,
    required this.duration,
    required this.dots,
    required this.stackMode,
    required this.tieOnCursor,
    required this.selArmed,
    required this.tupletOnCursor,
    required this.canLiga,
    required this.cursorAccidental,
    required this.canDynamic,
    required this.cursorDynamic,
    required this.filledBeats,
    required this.totalBeats,
    required this.onDuration,
    required this.onDots,
    required this.onToggleStack,
    required this.onToggleTie,
    required this.onToggleSlur,
    required this.onTuplet,
    required this.hairpinOnCursor,
    required this.onHairpinCresc,
    required this.onHairpinDim,
    required this.onAccidental,
    required this.onDynamic,
    required this.cursorArticulations,
    required this.onArticulation,
    required this.onInsert,
    required this.onRest,
    required this.onDelete,
    required this.onMoveNote,
    required this.onSwitchVoice,
  });

  bool get _isDrums => score.instrument == InstrumentType.drums;

  @override
  Widget build(BuildContext context) {
    return Material(
      elevation: 8,
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(8, 8, 8, 4),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              _durationRow(context), // Зона 1 — длительности
              const SizedBox(height: 6),
              _fillBar(context), // индикатор заполнения такта (оба инструмента)
              const SizedBox(height: 6),
              _editStrip(context), // Зона 2 — редактирование + аккорд-режим
              // Зона 2б — альтерация (только для клавишных; ударным неприменимо)
              if (!_isDrums) ...[
                const SizedBox(height: 6),
                _accidentalRow(context),
              ],
              // Зона 2в — динамика (оба инструмента)
              const SizedBox(height: 6),
              _dynamicsRow(context),
              // Зона 2г — артикуляции (оба инструмента)
              const SizedBox(height: 6),
              _articulationRow(context),
              const SizedBox(height: 8),
              // Зона 3 — ввод высоты/инструмента (вся ширина, зона большого пальца)
              SizedBox(
                height: _isDrums ? 76 : 104,
                child: _isDrums
                    ? _DrumPad(onInsert: onInsert)
                    : PianoKeyboard(
                        focusOctave: cursor.voice == 'bass' ? 3 : 4,
                        onInsert: onInsert,
                      ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  // --- Зона 1: длительности ---------------------------------------------
  // Равные сегменты во всю ширину (без горизонтального скролла) + тумблер
  // точки. Самое частое действие — крупные равные цели, всё видно сразу.
  Widget _durationRow(BuildContext context) {
    return Row(
      children: [
        for (final e in durations.entries)
          _durSeg(context,
              label: e.value,
              selected: duration == e.key,
              onTap: () => onDuration(e.key)),
        _durSeg(context,
            label: '♩.',
            selected: dots > 0,
            tooltip: 'Нота с точкой',
            onTap: () => onDots(dots > 0 ? 0 : 1)),
      ],
    );
  }

  Widget _durSeg(BuildContext context,
      {required String label,
      required bool selected,
      required VoidCallback onTap,
      String? tooltip}) {
    final scheme = Theme.of(context).colorScheme;
    Widget seg = Padding(
      padding: const EdgeInsets.symmetric(horizontal: 2),
      child: Material(
        color: selected
            ? scheme.secondaryContainer
            : scheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(8),
        child: InkWell(
          borderRadius: BorderRadius.circular(8),
          onTap: onTap,
          child: SizedBox(
            height: 46,
            child: Center(
              child: FittedBox(
                fit: BoxFit.scaleDown,
                child: Text(label,
                    style: TextStyle(
                        fontSize: 22,
                        color: selected
                            ? scheme.onSecondaryContainer
                            : scheme.onSurfaceVariant)),
              ),
            ),
          ),
        ),
      ),
    );
    if (tooltip != null) seg = Tooltip(message: tooltip, child: seg);
    return Expanded(child: seg);
  }

  // Тонкий индикатор заполнения активного такта (заменяет прежний текстовый
  // счётчик долей и работает для обоих инструментов). Переполнение — красным.
  Widget _fillBar(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final overfull = filledBeats > totalBeats + 1e-6;
    final value =
        totalBeats > 0 ? (filledBeats / totalBeats).clamp(0.0, 1.0) : 0.0;
    return ClipRRect(
      borderRadius: BorderRadius.circular(2),
      child: LinearProgressIndicator(
        value: value.toDouble(),
        minHeight: 3,
        backgroundColor: scheme.surfaceContainerHighest,
        color: overfull ? scheme.error : scheme.primary,
      ),
    );
  }

  // --- Зона 2: редактирование + режимы ----------------------------------
  // Слева — голос (фортепиано) и курсор ◀▶ (на границе такта он сам переходит
  // в соседний); номер такта; справа — режимы аккорда/лиг, пауза, удаление.
  // Кнопок много (Tie/Slur добавили ширины) — строка горизонтально
  // прокручиваема, чтобы не переполняться на узких экранах (6").
  Widget _editStrip(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    const tight = BoxConstraints(minWidth: 34, minHeight: 38);
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: [
          if (!_isDrums)
            SegmentedButton<String>(
              style: const ButtonStyle(visualDensity: VisualDensity.compact),
              segments: const [
                ButtonSegment(value: 'treble', label: Text('𝄞')),
                ButtonSegment(value: 'bass', label: Text('𝄢')),
              ],
              selected: {cursor.voice},
              onSelectionChanged: (s) => onSwitchVoice(s.first),
            ),
          IconButton(
            tooltip: 'Назад',
            visualDensity: VisualDensity.compact,
            padding: EdgeInsets.zero,
            constraints: tight,
            icon: const Icon(Icons.chevron_left),
            onPressed: () => onMoveNote(-1),
          ),
          IconButton(
            tooltip: 'Вперёд',
            visualDensity: VisualDensity.compact,
            padding: EdgeInsets.zero,
            constraints: tight,
            icon: const Icon(Icons.chevron_right),
            onPressed: () => onMoveNote(1),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 8),
            child: Text(
              'Такт ${cursor.measure + 1}/${score.measures.length}',
              maxLines: 1,
              style: Theme.of(context).textTheme.labelMedium,
            ),
          ),
          // Аккорд-режим: залитый фон при активности — постоянный индикатор.
          IconButton(
            tooltip: stackMode ? 'Аккорд-режим включён' : 'Аккорд-режим',
            isSelected: stackMode,
            visualDensity: VisualDensity.compact,
            padding: EdgeInsets.zero,
            constraints: tight,
            icon: const Icon(Icons.layers_outlined),
            selectedIcon: const Icon(Icons.layers),
            style: IconButton.styleFrom(
              backgroundColor: stackMode ? scheme.secondaryContainer : null,
              foregroundColor: stackMode ? scheme.onSecondaryContainer : null,
            ),
            onPressed: onToggleStack,
          ),
          // Tie — лига ДЛИТЕЛЬНОСТИ (тумблер на ноте под курсором).
          IconButton(
            tooltip: 'Лига длительности (Tie)',
            isSelected: tieOnCursor,
            visualDensity: VisualDensity.compact,
            padding: EdgeInsets.zero,
            constraints: tight,
            icon: const Icon(Icons.link),
            style: IconButton.styleFrom(
              backgroundColor: tieOnCursor ? scheme.secondaryContainer : null,
              foregroundColor: tieOnCursor ? scheme.onSecondaryContainer : null,
            ),
            onPressed: canLiga ? onToggleTie : null,
          ),
          // Slur — лига ФРАЗИРОВКИ (авто по выделению: якорь -> курсор).
          IconButton(
            tooltip: selArmed
                ? 'Лига фразировки: выберите второй конец'
                : 'Лига фразировки (Slur)',
            isSelected: selArmed,
            visualDensity: VisualDensity.compact,
            padding: EdgeInsets.zero,
            constraints: tight,
            icon: const Icon(Icons.gesture),
            style: IconButton.styleFrom(
              backgroundColor: selArmed ? scheme.tertiaryContainer : null,
              foregroundColor: selArmed ? scheme.onTertiaryContainer : null,
            ),
            onPressed: canLiga ? onToggleSlur : null,
          ),
          // Tuplet — нестандартная ритмика (операция над выделением). В группе
          // — снимает её; иначе: якорь -> выбор соотношения 3:2/5:4/…
          IconButton(
            tooltip: tupletOnCursor
                ? 'Убрать tuplet'
                : (selArmed
                    ? 'Tuplet: выберите второй конец'
                    : 'Tuplet (триоль/квинтоль/…)'),
            isSelected: tupletOnCursor,
            visualDensity: VisualDensity.compact,
            padding: EdgeInsets.zero,
            constraints: tight,
            icon: const Icon(Icons.data_array),
            style: IconButton.styleFrom(
              backgroundColor: tupletOnCursor ? scheme.secondaryContainer : null,
              foregroundColor:
                  tupletOnCursor ? scheme.onSecondaryContainer : null,
            ),
            onPressed: (canLiga || tupletOnCursor) ? onTuplet : null,
          ),
          // Crescendo (<) — вилка нарастания. В вилке — снимает; иначе якорь ->
          // второй конец (как slur). Подсвечена, когда курсор внутри вилки.
          IconButton(
            tooltip: hairpinOnCursor
                ? 'Убрать вилку'
                : (selArmed
                    ? 'Крещендо: выберите второй конец'
                    : 'Крещендо (<)'),
            isSelected: hairpinOnCursor,
            visualDensity: VisualDensity.compact,
            padding: EdgeInsets.zero,
            constraints: tight,
            icon: const Text('cresc', style: TextStyle(fontSize: 11)),
            style: IconButton.styleFrom(
              backgroundColor: hairpinOnCursor ? scheme.secondaryContainer : null,
              foregroundColor:
                  hairpinOnCursor ? scheme.onSecondaryContainer : null,
            ),
            onPressed: (canLiga || hairpinOnCursor) ? onHairpinCresc : null,
          ),
          // Diminuendo (>) — вилка спада. Поведение симметрично крещендо.
          IconButton(
            tooltip: hairpinOnCursor
                ? 'Убрать вилку'
                : (selArmed
                    ? 'Диминуэндо: выберите второй конец'
                    : 'Диминуэндо (>)'),
            isSelected: hairpinOnCursor,
            visualDensity: VisualDensity.compact,
            padding: EdgeInsets.zero,
            constraints: tight,
            icon: const Text('dim', style: TextStyle(fontSize: 11)),
            style: IconButton.styleFrom(
              backgroundColor: hairpinOnCursor ? scheme.secondaryContainer : null,
              foregroundColor:
                  hairpinOnCursor ? scheme.onSecondaryContainer : null,
            ),
            onPressed: (canLiga || hairpinOnCursor) ? onHairpinDim : null,
          ),
          IconButton.filledTonal(
            tooltip: 'Пауза',
            visualDensity: VisualDensity.compact,
            padding: EdgeInsets.zero,
            constraints: tight,
            icon: const Icon(Icons.music_off),
            onPressed: onRest,
          ),
          IconButton.filledTonal(
            tooltip: 'Стереть',
            visualDensity: VisualDensity.compact,
            padding: EdgeInsets.zero,
            constraints: tight,
            icon: const Icon(Icons.backspace_outlined),
            style: IconButton.styleFrom(
              backgroundColor: scheme.errorContainer,
              foregroundColor: scheme.onErrorContainer,
            ),
            onPressed: onDelete,
          ),
        ],
      ),
    );
  }

  /// Зона альтерации: ставит знак на ноту под курсором (per-notehead модель).
  /// Применяется только к выделенной/текущей ноте. Активный знак подсвечен.
  /// Используются нативные глифы; рисует знаки VexFlow на стане сам движок.
  Widget _accidentalRow(BuildContext context) {
    const items = <(Accidental, String, String)>[
      (Accidental.none, '♮?', 'Без знака (по тональности)'),
      (Accidental.natural, '♮', 'Бекар'),
      (Accidental.sharp, '♯', 'Диез'),
      (Accidental.flat, '♭', 'Бемоль'),
      (Accidental.doubleSharp, '𝄪', 'Дубль-диез'),
      (Accidental.doubleFlat, '𝄫', 'Дубль-бемоль'),
    ];
    final scheme = Theme.of(context).colorScheme;
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: [
          Padding(
            padding: const EdgeInsets.only(right: 6, left: 2),
            child: Text('Знак',
                style: Theme.of(context).textTheme.labelMedium),
          ),
          for (final (acc, glyph, tip) in items)
            Padding(
              padding: const EdgeInsets.only(right: 4),
              child: () {
                final active = cursorAccidental == acc;
                return SizedBox(
                  height: 38,
                  child: TextButton(
                    style: TextButton.styleFrom(
                      visualDensity: VisualDensity.compact,
                      padding: const EdgeInsets.symmetric(horizontal: 10),
                      minimumSize: const Size(34, 38),
                      backgroundColor:
                          active ? scheme.secondaryContainer : null,
                      foregroundColor: active
                          ? scheme.onSecondaryContainer
                          : scheme.onSurface,
                    ),
                    onPressed: canLiga ? () => onAccidental(acc) : null,
                    child: Tooltip(
                      message: tip,
                      child: Text(glyph, style: const TextStyle(fontSize: 18)),
                    ),
                  ),
                );
              }(),
            ),
        ],
      ),
    );
  }

  /// Зона артикуляций: переключает знак (staccato/staccatissimo/accent/marcato/
  /// tenuto) на ноте под курсором. Toggle: активный знак подсвечен, повторный тап
  /// снимает; несколько совместимых знаков сосуществуют. Влияние на playback
  /// (длительность/громкость/атака) движок считает сам (единое место). Доступно
  /// обоим инструментам (ударным accent/marcato особенно полезны).
  Widget _articulationRow(BuildContext context) {
    const items = <(Articulation, String, String)>[
      (Articulation.staccato, '𝅭', 'Стаккато'),
      (Articulation.staccatissimo, '𝆓', 'Стаккатиссимо'),
      (Articulation.accent, '>', 'Акцент'),
      (Articulation.marcato, '^', 'Маркато'),
      (Articulation.tenuto, '–', 'Тенуто'),
    ];
    final scheme = Theme.of(context).colorScheme;
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: [
          Padding(
            padding: const EdgeInsets.only(right: 6, left: 2),
            child: Text('Штрих',
                style: Theme.of(context).textTheme.labelMedium),
          ),
          for (final (art, glyph, tip) in items)
            Padding(
              padding: const EdgeInsets.only(right: 4),
              child: () {
                final active = cursorArticulations.contains(art);
                return SizedBox(
                  height: 38,
                  child: TextButton(
                    style: TextButton.styleFrom(
                      visualDensity: VisualDensity.compact,
                      padding: const EdgeInsets.symmetric(horizontal: 10),
                      minimumSize: const Size(34, 38),
                      backgroundColor:
                          active ? scheme.secondaryContainer : null,
                      foregroundColor: active
                          ? scheme.onSecondaryContainer
                          : scheme.onSurface,
                    ),
                    onPressed: canLiga ? () => onArticulation(art) : null,
                    child: Tooltip(
                      message: tip,
                      child: Text(glyph, style: const TextStyle(fontSize: 18)),
                    ),
                  ),
                );
              }(),
            ),
        ],
      ),
    );
  }

  /// Зона динамики: ставит оттенок (ppp..fff) на долю ноты под курсором.
  /// Оттенок действует до следующего знака; громкость воспроизведения движок
  /// разрешает сам. Активный оттенок подсвечен; повторный тап — снимает.
  Widget _dynamicsRow(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: [
          Padding(
            padding: const EdgeInsets.only(right: 6, left: 2),
            child: Text('Динам.',
                style: Theme.of(context).textTheme.labelMedium),
          ),
          for (final mark in DynamicMark.values)
            Padding(
              padding: const EdgeInsets.only(right: 4),
              child: () {
                final active = cursorDynamic == mark;
                return SizedBox(
                  height: 38,
                  child: TextButton(
                    style: TextButton.styleFrom(
                      visualDensity: VisualDensity.compact,
                      padding: const EdgeInsets.symmetric(horizontal: 10),
                      minimumSize: const Size(38, 38),
                      backgroundColor:
                          active ? scheme.secondaryContainer : null,
                      foregroundColor: active
                          ? scheme.onSecondaryContainer
                          : scheme.onSurface,
                    ),
                    onPressed: canDynamic ? () => onDynamic(mark) : null,
                    child: Text(mark.label,
                        style: const TextStyle(
                            fontSize: 16,
                            fontStyle: FontStyle.italic,
                            fontWeight: FontWeight.bold)),
                  ),
                );
              }(),
            ),
        ],
      ),
    );
  }
}

// =====================================================================
//  Мини-клавиатура пиано (удобный ввод высоты)
// =====================================================================
class PianoKeyboard extends StatefulWidget {
  final int focusOctave;
  final ValueChanged<List<String>> onInsert;
  const PianoKeyboard({
    super.key,
    required this.focusOctave,
    required this.onInsert,
  });

  @override
  State<PianoKeyboard> createState() => _PianoKeyboardState();
}

class _PianoKeyboardState extends State<PianoKeyboard> {
  static const List<int> _octaves = [2, 3, 4, 5, 6];
  static const List<String> _white = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  // Чёрная клавиша после белой с индексом i (диезы есть у C,D,F,G,A).
  static const Map<int, String> _black = {0: 'C', 1: 'D', 3: 'F', 4: 'G', 5: 'A'};

  static const double _whiteW = 34;
  static const double _blackW = 22;
  double get _octaveW => _white.length * _whiteW;

  final ScrollController _scroll = ScrollController();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _scrollToFocus(false));
  }

  @override
  void didUpdateWidget(PianoKeyboard old) {
    super.didUpdateWidget(old);
    if (old.focusOctave != widget.focusOctave) _scrollToFocus(true);
  }

  void _scrollToFocus(bool animate) {
    if (!_scroll.hasClients) return;
    final idx = _octaves.indexOf(widget.focusOctave);
    if (idx < 0) return;
    // центрируем нужную октаву в видимой области
    final target = (idx * _octaveW - _octaveW / 2)
        .clamp(0.0, _scroll.position.maxScrollExtent);
    if (animate) {
      _scroll.animateTo(target,
          duration: const Duration(milliseconds: 250), curve: Curves.easeOut);
    } else {
      _scroll.jumpTo(target);
    }
  }

  @override
  void dispose() {
    _scroll.dispose();
    super.dispose();
  }

  void _tap(String letter, bool sharp, int octave) {
    widget.onInsert(['${letter.toLowerCase()}${sharp ? '#' : ''}/$octave']);
  }

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(8),
      child: SingleChildScrollView(
        controller: _scroll,
        scrollDirection: Axis.horizontal,
        child: Row(
          children: [for (final o in _octaves) _octaveWidget(context, o)],
        ),
      ),
    );
  }

  Widget _octaveWidget(BuildContext context, int octave) {
    final scheme = Theme.of(context).colorScheme;
    return SizedBox(
      width: _octaveW,
      child: Stack(
        children: [
          // белые клавиши
          Row(
            children: [
              for (final l in _white)
                _key(
                  width: _whiteW,
                  height: double.infinity,
                  bg: Colors.white,
                  fg: Colors.black87,
                  label: '$l$octave',
                  onTap: () => _tap(l, false, octave),
                ),
            ],
          ),
          // чёрные клавиши поверх
          for (final entry in _black.entries)
            Positioned(
              left: (entry.key + 1) * _whiteW - _blackW / 2,
              top: 0,
              child: _key(
                width: _blackW,
                height: 60,
                bg: scheme.inverseSurface,
                fg: scheme.onInverseSurface,
                label: '${entry.value}♯',
                onTap: () => _tap(entry.value, true, octave),
              ),
            ),
        ],
      ),
    );
  }

  Widget _key({
    required double width,
    required double height,
    required Color bg,
    required Color fg,
    required String label,
    required VoidCallback onTap,
  }) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 1),
      child: Material(
        color: bg,
        borderRadius: BorderRadius.circular(4),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(4),
          child: SizedBox(
            width: width - 2,
            height: height,
            child: Align(
              alignment: Alignment.bottomCenter,
              child: Padding(
                padding: const EdgeInsets.only(bottom: 4),
                child: Text(label,
                    style: TextStyle(fontSize: 9, color: fg)),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

// =====================================================================
//  Барабанная панель
// =====================================================================
class _DrumPad extends StatelessWidget {
  final ValueChanged<List<String>> onInsert;
  const _DrumPad({required this.onInsert});

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: [
          for (final e in drumKit.entries)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 3),
              child: SizedBox(
                width: 88,
                child: FilledButton.tonal(
                  style: FilledButton.styleFrom(
                    padding: const EdgeInsets.symmetric(horizontal: 4),
                  ),
                  onPressed: () => onInsert(e.value),
                  child: Text(e.key,
                      textAlign: TextAlign.center,
                      style: const TextStyle(fontSize: 12)),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

// =====================================================================
//  Нижняя панель плеера
// =====================================================================
// Слим-транспорт (Зона 4): play/pause + Undo/Redo + метроном + follow +
// темп-чип (тап → лист «Ещё» с точным темпом) + ⋯ (лист «Ещё» с редкими
// действиями). Undo/Redo рядом с play — высокочастотные действия в зоне
// большого пальца; гаснут (disabled), когда стек пуст.
class _PlaybackBar extends StatelessWidget {
  final int tempo;
  final bool isPlaying;
  final bool metronomeOn;
  final bool followOn;
  final bool canUndo;
  final bool canRedo;
  final VoidCallback onTogglePlay;
  final VoidCallback onToggleMetronome;
  final VoidCallback onToggleFollow;
  final VoidCallback onUndo;
  final VoidCallback onRedo;
  final VoidCallback onTempoTap;
  final VoidCallback onOpenMore;

  const _PlaybackBar({
    required this.tempo,
    required this.isPlaying,
    required this.metronomeOn,
    required this.followOn,
    required this.canUndo,
    required this.canRedo,
    required this.onTogglePlay,
    required this.onToggleMetronome,
    required this.onToggleFollow,
    required this.onUndo,
    required this.onRedo,
    required this.onTempoTap,
    required this.onOpenMore,
  });

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return BottomAppBar(
      height: 60,
      padding: const EdgeInsets.symmetric(horizontal: 4),
      child: Row(
        children: [
          FloatingActionButton.small(
            elevation: 0,
            onPressed: onTogglePlay,
            child: Icon(isPlaying ? Icons.pause : Icons.play_arrow),
          ),
          IconButton(
            tooltip: 'Отменить',
            visualDensity: VisualDensity.compact,
            icon: const Icon(Icons.undo),
            onPressed: canUndo ? onUndo : null,
          ),
          IconButton(
            tooltip: 'Вернуть',
            visualDensity: VisualDensity.compact,
            icon: const Icon(Icons.redo),
            onPressed: canRedo ? onRedo : null,
          ),
          IconButton(
            tooltip: 'Метроном',
            isSelected: metronomeOn,
            visualDensity: VisualDensity.compact,
            icon: MetronomeIcon(
              size: 24,
              color: metronomeOn ? scheme.primary : null,
            ),
            color: metronomeOn ? scheme.primary : null,
            onPressed: onToggleMetronome,
          ),
          IconButton(
            tooltip: followOn
                ? 'Следовать за воспроизведением: вкл.'
                : 'Следовать за воспроизведением: выкл.',
            isSelected: followOn,
            visualDensity: VisualDensity.compact,
            icon: Icon(followOn ? Icons.swap_vert : Icons.swap_vert_outlined),
            color: followOn ? scheme.primary : null,
            onPressed: onToggleFollow,
          ),
          const Spacer(),
          // Темп — компактный чип-читалка; тап открывает лист «Ещё» (слайдер).
          // Без иконки-аватара: символ ♩ сам обозначает темп, экономит ширину.
          ActionChip(
            visualDensity: VisualDensity.compact,
            label: Text('♩=$tempo'),
            onPressed: onTempoTap,
          ),
          IconButton(
            tooltip: 'Ещё',
            icon: const Icon(Icons.more_horiz),
            onPressed: onOpenMore,
          ),
        ],
      ),
    );
  }
}
