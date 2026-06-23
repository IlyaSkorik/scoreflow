import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';

import '../data/score_repository.dart';
import '../main.dart' show kEngineUrl;
import '../models/palette.dart';
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
  int _octave = 4;
  bool _sharp = false;
  bool _isPlaying = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final s = await widget.repository.load(widget.scoreId);
    if (s == null) {
      if (mounted) Navigator.pop(context);
      return;
    }
    // Курсор в начало: первый голос инструмента, последняя нота (или пусто).
    _cursor.voice = s.instrument.voiceIds.first;
    _cursor.measure = 0;
    _cursor.index = _voiceOf(s, 0, _cursor.voice).length - 1;
    _octave = defaultOctave[_cursor.voice] ?? 4;
    setState(() => _score = s);
    _render();
  }

  // --- доступ к данным -------------------------------------------------
  List<MusicNote> _voiceOf(Score s, int measure, String voice) =>
      s.measures[measure].voice(voice);

  List<MusicNote> get _activeVoice =>
      _voiceOf(_score!, _cursor.measure, _cursor.voice);

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

  /// Применяет изменение: перерисовать + автосохранить.
  void _commit(VoidCallback mutation) {
    setState(mutation);
    _render();
    _persist();
  }

  // --- операции редактирования ----------------------------------------
  void _insertNote({required List<String> keys, bool rest = false}) {
    _commit(() {
      final notes = _activeVoice;
      final pos = (_cursor.index + 1).clamp(0, notes.length);
      notes.insert(pos, MusicNote(keys: keys, duration: _duration, rest: rest));
      _cursor.index = pos;
    });
  }

  void _addPianoNote(String letter) {
    final key = '${letter.toLowerCase()}${_sharp ? '#' : ''}/$_octave';
    _insertNote(keys: [key]);
  }

  void _deleteAtCursor() {
    final notes = _activeVoice;
    if (notes.isEmpty || _cursor.index < 0) return;
    _commit(() {
      notes.removeAt(_cursor.index);
      _cursor.index = notes.isEmpty ? -1 : (_cursor.index - 1).clamp(0, notes.length - 1);
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
      _octave = defaultOctave[voice] ?? 4;
    });
  }

  void _togglePlay() {
    setState(() => _isPlaying = !_isPlaying);
    _sendPlayback(_isPlaying ? 'PLAY' : 'PAUSE');
  }

  Future<void> _rename() async {
    final ctrl = TextEditingController(text: _score!.title);
    final title = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Переименовать'),
        content: TextField(controller: ctrl, autofocus: true),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Отмена')),
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

  // --- UI --------------------------------------------------------------
  @override
  Widget build(BuildContext context) {
    final score = _score;
    if (score == null) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }

    return Scaffold(
      appBar: AppBar(
        title: GestureDetector(
          onTap: _rename,
          child: Text(score.title, overflow: TextOverflow.ellipsis),
        ),
        actions: [
          IconButton(
            tooltip: 'Сохранить',
            icon: const Icon(Icons.save_outlined),
            onPressed: () {
              _persist();
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('Сохранено'), duration: Duration(seconds: 1)),
              );
            },
          ),
          IconButton(
            tooltip: 'Экспорт в PDF (скоро)',
            icon: const Icon(Icons.picture_as_pdf_outlined),
            onPressed: () => ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(content: Text('PDF-экспорт — в следующей итерации')),
            ),
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
                ),
                onWebViewCreated: (c) => _web = c,
                onLoadStop: (c, url) {
                  _ready = true;
                  _render();
                },
                onReceivedError: (c, request, error) =>
                    debugPrint('WebView error: ${error.type} ${error.description} '
                        '(${request.url})'),
                onConsoleMessage: (c, msg) => debugPrint('JS: ${msg.message}'),
              ),
            ),
          ),
          _EditorPanel(
            score: score,
            cursor: _cursor,
            duration: _duration,
            octave: _octave,
            sharp: _sharp,
            onDuration: (d) => setState(() => _duration = d),
            onOctave: (v) => setState(() => _octave = (_octave + v).clamp(1, 7)),
            onSharp: () => setState(() => _sharp = !_sharp),
            onPianoNote: _addPianoNote,
            onDrum: (keys) => _insertNote(keys: keys),
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
        onTempo: (v) {
          _commit(() => score.tempo = v.round());
          if (_isPlaying) _sendPlayback('PLAY');
        },
        onTogglePlay: _togglePlay,
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
  final int octave;
  final bool sharp;
  final ValueChanged<String> onDuration;
  final ValueChanged<int> onOctave;
  final VoidCallback onSharp;
  final ValueChanged<String> onPianoNote;
  final ValueChanged<List<String>> onDrum;
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
    required this.octave,
    required this.sharp,
    required this.onDuration,
    required this.onOctave,
    required this.onSharp,
    required this.onPianoNote,
    required this.onDrum,
    required this.onRest,
    required this.onDelete,
    required this.onMoveNote,
    required this.onMoveMeasure,
    required this.onAddMeasure,
    required this.onSwitchVoice,
  });

  @override
  Widget build(BuildContext context) {
    final isDrums = score.instrument == InstrumentType.drums;
    return Material(
      elevation: 8,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(8, 6, 8, 6),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            _navRow(context, isDrums),
            const SizedBox(height: 6),
            _durationRow(),
            const SizedBox(height: 6),
            isDrums ? _drumRow() : _pianoRow(),
          ],
        ),
      ),
    );
  }

  Widget _navRow(BuildContext context, bool isDrums) {
    return Row(
      children: [
        if (!isDrums)
          SegmentedButton<String>(
            style: const ButtonStyle(visualDensity: VisualDensity.compact),
            segments: const [
              ButtonSegment(value: 'treble', label: Text('𝄞')),
              ButtonSegment(value: 'bass', label: Text('𝄢')),
            ],
            selected: {cursor.voice},
            onSelectionChanged: (s) => onSwitchVoice(s.first),
          ),
        const Spacer(),
        Text('Такт ${cursor.measure + 1}/${score.measures.length}',
            style: Theme.of(context).textTheme.labelMedium),
        const Spacer(),
        IconButton(icon: const Icon(Icons.first_page), onPressed: () => onMoveMeasure(-1)),
        IconButton(icon: const Icon(Icons.chevron_left), onPressed: () => onMoveNote(-1)),
        IconButton(icon: const Icon(Icons.chevron_right), onPressed: () => onMoveNote(1)),
        IconButton(icon: const Icon(Icons.last_page), onPressed: () => onMoveMeasure(1)),
        IconButton(
          tooltip: 'Добавить такт',
          icon: const Icon(Icons.playlist_add),
          onPressed: onAddMeasure,
        ),
      ],
    );
  }

  Widget _durationRow() {
    return Wrap(
      spacing: 6,
      children: durations.entries
          .map((e) => ChoiceChip(
                label: Text(e.value, style: const TextStyle(fontSize: 18)),
                selected: duration == e.key,
                onSelected: (_) => onDuration(e.key),
              ))
          .toList(),
    );
  }

  Widget _pianoRow() {
    return Row(
      children: [
        IconButton(icon: const Icon(Icons.remove), onPressed: () => onOctave(-1)),
        Text('окт $octave'),
        IconButton(icon: const Icon(Icons.add), onPressed: () => onOctave(1)),
        FilterChip(
          label: const Text('♯', style: TextStyle(fontSize: 18)),
          selected: sharp,
          onSelected: (_) => onSharp(),
        ),
        const SizedBox(width: 6),
        Expanded(
          child: SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                for (final l in pianoLetters)
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 2),
                    child: ActionChip(label: Text(l), onPressed: () => onPianoNote(l)),
                  ),
                _restChip(),
                _deleteChip(),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _drumRow() {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: [
          for (final e in drumKit.entries)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 2),
              child: ActionChip(label: Text(e.key), onPressed: () => onDrum(e.value)),
            ),
          _restChip(),
          _deleteChip(),
        ],
      ),
    );
  }

  Widget _restChip() => Padding(
        padding: const EdgeInsets.symmetric(horizontal: 2),
        child: ActionChip(
          avatar: const Icon(Icons.music_off, size: 18),
          label: const Text('Пауза'),
          onPressed: onRest,
        ),
      );

  Widget _deleteChip() => Padding(
        padding: const EdgeInsets.symmetric(horizontal: 2),
        child: ActionChip(
          avatar: const Icon(Icons.backspace_outlined, size: 18),
          label: const Text('Удалить'),
          onPressed: onDelete,
        ),
      );
}

// =====================================================================
//  Нижняя панель плеера
// =====================================================================
class _PlaybackBar extends StatelessWidget {
  final double tempo;
  final bool isPlaying;
  final ValueChanged<double> onTempo;
  final VoidCallback onTogglePlay;

  const _PlaybackBar({
    required this.tempo,
    required this.isPlaying,
    required this.onTempo,
    required this.onTogglePlay,
  });

  @override
  Widget build(BuildContext context) {
    return BottomAppBar(
      child: Row(
        children: [
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
          Text('${tempo.round()}', style: const TextStyle(fontWeight: FontWeight.bold)),
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
