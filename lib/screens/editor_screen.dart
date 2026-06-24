import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';

import '../data/score_repository.dart';
import '../main.dart' show kEngineUrl;
import '../models/history.dart';
import '../models/palette.dart';
import '../models/reflow.dart';
import '../models/score.dart';

/// Тональности для пикера в листе «Ещё» (формат VexFlow keySignature).
const List<String> _keySignatures = [
  'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'F', 'Bb', 'Eb', 'Ab', 'Db'
];

/// Размеры такта для пикера в листе «Ещё».
const List<String> _timeSignatures = [
  '4/4', '3/4', '2/4', '2/2', '6/8', '9/8', '12/8', '5/8', '7/8', '3/8'
];

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

  double get _capacity =>
      _score!.timeSignature.beats / _score!.timeSignature.beatValue;

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
    final cap = _capacity;
    final beats = s.timeSignature.beats;
    final beatValue = s.timeSignature.beatValue;
    final cv = _cursor.voice;
    final keepCount = s.measures.length;

    // нота под курсором (по ссылке), чтобы потом вернуть курсор на неё.
    // Авто-паузы добивки пересоздаются — на них курсор не закрепляем.
    final curList = _voiceOf(s, _cursor.measure, cv);
    final MusicNote? cursorNote =
        (_cursor.index >= 0 && _cursor.index < curList.length &&
                !curList[_cursor.index].auto)
            ? curList[_cursor.index]
            : null;

    // упаковка каждого голоса в «корзины» (такты) по capacity.
    // Авто-паузы выбрасываем перед упаковкой — иначе добивка накапливалась бы.
    final bins = <String, List<List<MusicNote>>>{};
    var maxBins = 1;
    for (final v in s.instrument.voiceIds) {
      final flat = <MusicNote>[];
      for (final m in s.measures) {
        flat.addAll(m.voice(v).where((n) => !n.auto));
      }
      final packed = packVoice(flat, cap);
      bins[v] = packed;
      if (packed.length > maxBins) maxBins = packed.length;
    }

    final count = maxBins > keepCount ? maxBins : keepCount;
    final measures = <Measure>[];
    for (var i = 0; i < count; i++) {
      measures.add(Measure({
        for (final v in s.instrument.voiceIds)
          v: i < bins[v]!.length ? bins[v]![i] : <MusicNote>[],
      }));
    }

    // Целостность такта: каждый частично заполненный такт добиваем
    // каноническими паузами. Полностью пустые такты оставляем пустыми —
    // движок рисует им целую паузу (центрированную, как принято).
    for (final m in measures) {
      for (final v in s.instrument.voiceIds) {
        final notes = m.voice(v);
        if (notes.isEmpty) continue;
        final filled = notes.fold(0.0, (sum, n) => sum + noteTime(n));
        final remainder = cap - filled;
        if (remainder > 1e-6) {
          notes.addAll(fillRests(filled, remainder, beats, beatValue));
        }
      }
    }
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
          MusicNote(
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
                if (isPiano)
                  ListTile(
                    contentPadding: const EdgeInsets.symmetric(horizontal: 8),
                    leading: const Icon(Icons.music_note),
                    title: const Text('Тональность'),
                    trailing: DropdownButton<String>(
                      value: _keySignatures.contains(score.keySignature)
                          ? score.keySignature
                          : null,
                      hint: Text(score.keySignature),
                      items: [
                        for (final k in _keySignatures)
                          DropdownMenuItem(value: k, child: Text(k))
                      ],
                      onChanged: (v) {
                        if (v == null) return;
                        _commit(() => score.keySignature = v);
                        setSheet(() {});
                      },
                    ),
                  ),
                ListTile(
                  contentPadding: const EdgeInsets.symmetric(horizontal: 8),
                  leading: const Icon(Icons.straighten),
                  title: const Text('Размер'),
                  trailing: DropdownButton<String>(
                    value: _timeSignatures.contains(score.timeSignature.vex)
                        ? score.timeSignature.vex
                        : null,
                    hint: Text(score.timeSignature.vex),
                    items: [
                      for (final t in _timeSignatures)
                        DropdownMenuItem(value: t, child: Text(t))
                    ],
                    onChanged: (v) {
                      if (v == null) return;
                      _commit(
                          () => score.timeSignature = TimeSignature.parse(v));
                      setSheet(() {});
                    },
                  ),
                ),
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

    final filledBeats = _filled(_activeVoice) * score.timeSignature.beatValue;
    final totalBeats = score.timeSignature.beats;

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
            filledBeats: filledBeats,
            totalBeats: totalBeats,
            onDuration: (d) => setState(() => _duration = d),
            onDots: (v) => setState(() => _dots = v),
            onToggleStack: () => setState(() => _stackMode = !_stackMode),
            onToggleTie: _toggleTie,
            onToggleSlur: _toggleSlur,
            onTuplet: _onTuplet,
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
  final double filledBeats;
  final int totalBeats;
  final ValueChanged<String> onDuration;
  final ValueChanged<int> onDots;
  final VoidCallback onToggleStack;
  final VoidCallback onToggleTie;
  final VoidCallback onToggleSlur;
  final VoidCallback onTuplet;
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
    required this.filledBeats,
    required this.totalBeats,
    required this.onDuration,
    required this.onDots,
    required this.onToggleStack,
    required this.onToggleTie,
    required this.onToggleSlur,
    required this.onTuplet,
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
            icon: const Icon(Icons.av_timer),
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
