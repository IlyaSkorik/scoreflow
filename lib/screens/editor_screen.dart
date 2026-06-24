import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';

import '../data/score_repository.dart';
import '../main.dart' show kEngineUrl;
import '../models/palette.dart';
import '../models/reflow.dart';
import '../models/score.dart';

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
  String _duration = 'q';
  int _dots = 0; // 0 = без точки, 1 = пунктир (модель расширяема до 2–3)
  bool _stackMode = false; // Аккорд-режим: ввод наращивает созвучие, не двигая курсор
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
  double _filled(List<MusicNote> notes) => notes.fold(
      0.0, (s, n) => s + (n.auto ? 0 : noteFraction(n.duration, n.dots)));

  // --- мост к движку ---------------------------------------------------
  void _render() {
    if (!_ready || _web == null || _score == null) return;
    final payload = _score!.renderPayload(_cursor);
    final b64 = base64Encode(utf8.encode(payload));
    _web!.evaluateJavascript(
      source: "window.ScoreFlow && window.ScoreFlow.renderB64('$b64');",
    );
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
    setState(() {
      mutation();
      _normalize(); // соблюдение размера такта после любого изменения
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
        final filled = notes.fold(
            0.0, (sum, n) => sum + noteFraction(n.duration, n.dots));
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

      // 1) курсор на паузе -> заполняем её
      if (i >= 0 && i < notes.length && notes[i].rest) {
        notes[i]
          ..keys = _sortedKeys(keys)
          ..rest = rest
          ..duration = _duration
          ..dots = _dots
          ..auto = false;
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
    } else {
      n
        ..keys = _sortedKeys(set)
        ..rest = false;
    }
  }

  /// Удаление под курсором: нота превращается в паузу той же длительности
  /// (ритм не «съезжает»). Пауза остаётся на месте как держатель ритма —
  /// удалять её нечего.
  void _deleteAtCursor() {
    final notes = _activeVoice;
    if (notes.isEmpty || _cursor.index < 0) return;
    final n = notes[_cursor.index];
    if (n.rest) return;
    _commit(() {
      n
        ..keys = []
        ..rest = true;
    });
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
        actions: [
          IconButton(
            tooltip: _follow
                ? 'Следовать за воспроизведением: вкл.'
                : 'Следовать за воспроизведением: выкл.',
            isSelected: _follow,
            icon: Icon(_follow ? Icons.swap_vert : Icons.swap_vert_outlined),
            color: _follow ? Theme.of(context).colorScheme.primary : null,
            onPressed: _toggleFollow,
          ),
          IconButton(
            tooltip: 'Сохранить',
            icon: const Icon(Icons.save_outlined),
            onPressed: () {
              _persist();
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(
                    content: Text('Сохранено'),
                    duration: Duration(seconds: 1)),
              );
            },
          ),
          IconButton(
            tooltip: 'Экспорт в PDF',
            icon: const Icon(Icons.picture_as_pdf_outlined),
            onPressed: _exportPdf,
          ),
        ],
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
            filledBeats: filledBeats,
            totalBeats: totalBeats,
            onDuration: (d) => setState(() => _duration = d),
            onDots: (v) => setState(() => _dots = v),
            onToggleStack: () => setState(() => _stackMode = !_stackMode),
            onInsert: (keys) => _insertNote(keys: keys),
            onRest: () => _insertNote(keys: const [], rest: true),
            onDelete: _deleteAtCursor,
            onMoveNote: _moveNote,
            onMoveMeasure: (d) => _commit(() => _moveMeasure(d, toStart: true)),
            onAddMeasure: _addMeasure,
            onSwitchVoice: _switchVoice,
          ),
        ],
      ),
      bottomNavigationBar: _PlaybackBar(
        tempo: score.tempo.toDouble(),
        isPlaying: _isPlaying,
        metronomeOn: _metronome,
        showSustain: score.instrument == InstrumentType.piano,
        sustainOn: _sustain,
        onTempo: (v) {
          _commit(() => score.tempo = v.round());
          if (_isPlaying) _sendPlayback('PLAY');
        },
        onTogglePlay: _togglePlay,
        onToggleMetronome: _toggleMetronome,
        onToggleSustain: _toggleSustain,
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
  final double filledBeats;
  final int totalBeats;
  final ValueChanged<String> onDuration;
  final ValueChanged<int> onDots;
  final VoidCallback onToggleStack;
  final ValueChanged<List<String>> onInsert;
  final VoidCallback onRest;
  final VoidCallback onDelete;
  final ValueChanged<int> onMoveNote;
  final ValueChanged<int> onMoveMeasure;
  final VoidCallback onAddMeasure;
  final ValueChanged<String> onSwitchVoice;

  const _EditorPanel({
    required this.score,
    required this.cursor,
    required this.duration,
    required this.dots,
    required this.stackMode,
    required this.filledBeats,
    required this.totalBeats,
    required this.onDuration,
    required this.onDots,
    required this.onToggleStack,
    required this.onInsert,
    required this.onRest,
    required this.onDelete,
    required this.onMoveNote,
    required this.onMoveMeasure,
    required this.onAddMeasure,
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
              _topRow(context),
              const SizedBox(height: 8),
              _durationRow(context),
              const SizedBox(height: 10),
              SizedBox(
                height: _isDrums ? 76 : 104,
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Expanded(
                      child: _isDrums
                          ? _DrumPad(onInsert: onInsert)
                          : PianoKeyboard(
                              focusOctave: cursor.voice == 'bass' ? 3 : 4,
                              onInsert: onInsert,
                            ),
                    ),
                    const SizedBox(width: 8),
                    _sideActions(context),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _topRow(BuildContext context) {
    final overfull = filledBeats > totalBeats + 1e-6;
    final color = overfull
        ? Theme.of(context).colorScheme.error
        : Theme.of(context).colorScheme.onSurfaceVariant;
    final beatsText = _trim(filledBeats);

    return Row(
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
        // Счётчик такта/долей показываем только у ударных: на клавишной
        // строку занимает переключатель ключей, и счётчик в неё не помещается.
        if (_isDrums)
          Expanded(
            child: Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text('Такт ${cursor.measure + 1}/${score.measures.length}',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.labelMedium),
                  Text('доли $beatsText/$totalBeats',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context)
                          .textTheme
                          .labelSmall
                          ?.copyWith(color: color)),
                ],
              ),
            ),
          )
        else
          const Spacer(),
        _navButton(
            tooltip: 'Предыдущий такт',
            icon: Icons.first_page,
            onPressed: () => onMoveMeasure(-1)),
        _navButton(
            icon: Icons.chevron_left, onPressed: () => onMoveNote(-1)),
        _navButton(
            icon: Icons.chevron_right, onPressed: () => onMoveNote(1)),
        _navButton(
            tooltip: 'Следующий такт',
            icon: Icons.last_page,
            onPressed: () => onMoveMeasure(1)),
        _navButton(
          tooltip: 'Добавить такт',
          icon: Icons.playlist_add,
          onPressed: onAddMeasure,
        ),
      ],
    );
  }

  /// Компактная кнопка навигации: уменьшенные отступы, чтобы пять кнопок
  /// вместе со счётчиком тактов помещались в строку на узких экранах.
  Widget _navButton({
    String? tooltip,
    required IconData icon,
    required VoidCallback onPressed,
  }) {
    return IconButton(
      tooltip: tooltip,
      icon: Icon(icon),
      onPressed: onPressed,
      iconSize: 22,
      visualDensity: VisualDensity.compact,
      padding: EdgeInsets.zero,
      constraints: const BoxConstraints(minWidth: 36, minHeight: 36),
    );
  }

  Widget _durationRow(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Row(
      children: [
        // Длительности + пунктир — горизонтальный скролл (могут не влезть).
        Expanded(
          child: SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                for (final e in durations.entries)
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 3),
                    child: ChoiceChip(
                      label: Text(e.value, style: const TextStyle(fontSize: 22)),
                      labelPadding: const EdgeInsets.symmetric(horizontal: 10),
                      selected: duration == e.key,
                      onSelected: (_) => onDuration(e.key),
                    ),
                  ),
                // Тумблер пунктира: применяется к следующему вводимому слоту.
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 3),
                  child: ChoiceChip(
                    label: const Text('♩.', style: TextStyle(fontSize: 20)),
                    labelPadding: const EdgeInsets.symmetric(horizontal: 10),
                    tooltip: 'Нота с точкой',
                    selected: dots > 0,
                    onSelected: (_) => onDots(dots > 0 ? 0 : 1),
                  ),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(width: 6),
        // Аккорд-режим: закреплён вне скролла — постоянный индикатор режима
        // ввода (выкл = быстрый набор; вкл = ноты складываются в созвучие).
        ChoiceChip(
          avatar: Icon(Icons.layers,
              size: 18, color: stackMode ? scheme.onSecondaryContainer : null),
          label: const Text('Аккорд'),
          tooltip: stackMode
              ? 'Аккорд-режим включён: ноты складываются в одно созвучие'
              : 'Аккорд-режим: складывать ноты в одно созвучие',
          selected: stackMode,
          selectedColor: scheme.secondaryContainer,
          onSelected: (_) => onToggleStack(),
        ),
      ],
    );
  }

  Widget _sideActions(BuildContext context) {
    return Column(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Expanded(
          child: _ActionButton(
            icon: Icons.music_off,
            label: 'Пауза',
            onTap: onRest,
            color: Theme.of(context).colorScheme.secondaryContainer,
          ),
        ),
        const SizedBox(height: 6),
        Expanded(
          child: _ActionButton(
            icon: Icons.backspace_outlined,
            label: 'Стереть',
            onTap: onDelete,
            color: Theme.of(context).colorScheme.errorContainer,
          ),
        ),
      ],
    );
  }

  static String _trim(double v) {
    if ((v - v.roundToDouble()).abs() < 1e-6) return v.round().toString();
    return v.toStringAsFixed(2).replaceFirst(RegExp(r'0+$'), '');
  }
}

class _ActionButton extends StatelessWidget {
  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final Color color;
  const _ActionButton({
    required this.icon,
    required this.label,
    required this.onTap,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: color,
      borderRadius: BorderRadius.circular(10),
      child: InkWell(
        borderRadius: BorderRadius.circular(10),
        onTap: onTap,
        child: Container(
          width: 78,
          alignment: Alignment.center,
          padding: const EdgeInsets.symmetric(vertical: 4),
          // FittedBox гарантирует, что контент не переполнит слот любой высоты.
          child: FittedBox(
            fit: BoxFit.scaleDown,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(icon, size: 20),
                const SizedBox(height: 2),
                Text(label, style: const TextStyle(fontSize: 11)),
              ],
            ),
          ),
        ),
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
class _PlaybackBar extends StatelessWidget {
  final double tempo;
  final bool isPlaying;
  final bool metronomeOn;
  final bool showSustain;
  final bool sustainOn;
  final ValueChanged<double> onTempo;
  final VoidCallback onTogglePlay;
  final VoidCallback onToggleMetronome;
  final VoidCallback onToggleSustain;

  const _PlaybackBar({
    required this.tempo,
    required this.isPlaying,
    required this.metronomeOn,
    required this.showSustain,
    required this.sustainOn,
    required this.onTempo,
    required this.onTogglePlay,
    required this.onToggleMetronome,
    required this.onToggleSustain,
  });

  @override
  Widget build(BuildContext context) {
    return BottomAppBar(
      child: Row(
        children: [
          IconButton(
            tooltip: 'Метроном',
            isSelected: metronomeOn,
            icon: const Icon(Icons.av_timer),
            color: metronomeOn ? Theme.of(context).colorScheme.primary : null,
            onPressed: onToggleMetronome,
          ),
          if (showSustain)
            IconButton(
              tooltip: 'Демпфер-педаль (sustain)',
              isSelected: sustainOn,
              icon: const Icon(Icons.commit), // символ удержания/педали
              color: sustainOn ? Theme.of(context).colorScheme.primary : null,
              onPressed: onToggleSustain,
            ),
          const Icon(Icons.speed, size: 20),
          Expanded(
            child: Slider(
              value: tempo,
              min: 40,
              max: 240,
              divisions: 200,
              label: '${tempo.round()} BPM',
              onChanged: onTempo,
            ),
          ),
          Text('${tempo.round()}',
              style: const TextStyle(fontWeight: FontWeight.bold)),
          const SizedBox(width: 8),
          FloatingActionButton.small(
            onPressed: onTogglePlay,
            child: Icon(isPlaying ? Icons.pause : Icons.play_arrow),
          ),
          const SizedBox(width: 8),
        ],
      ),
    );
  }
}
