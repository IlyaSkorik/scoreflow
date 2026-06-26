import 'package:flutter_test/flutter_test.dart';
import 'package:scoreflow/models/history.dart';
import 'package:scoreflow/models/palette.dart';
import 'package:scoreflow/models/reflow.dart';
import 'package:scoreflow/models/score.dart';

// =====================================================================
//  Тестовый harness — зеркало логики _EditorScreenState
// =====================================================================
// Воспроизводит commit/normalize/undo/redo редактора на РЕАЛЬНЫХ ScoreHistory,
// Score.copy() и примитивах reflow (packVoice/fillRests). Так сценарии Undo/Redo
// проверяются на той же механике, что и в приложении, без поднятия WebView.
class _Editor {
  _Editor(InstrumentType instrument, {TimeSignature? ts})
      : score = Score.create(
          id: 't',
          title: 'T',
          instrument: instrument,
          now: DateTime(2026),
          timeSignature: ts ?? TimeSignature.common,
        ) {
    cursor.voice = score.instrument.voiceIds.first;
    cursor.index = -1;
    _normalize();
  }

  Score score;
  final EditorCursor cursor = EditorCursor();
  final ScoreHistory history = ScoreHistory();

  double get _cap =>
      score.timeSignature.beats / score.timeSignature.beatValue;

  List<MusicNote> get _active =>
      score.measures[cursor.measure].voice(cursor.voice);

  EditorSnapshot _snapshot() => EditorSnapshot(
        score: score.copy(),
        measure: cursor.measure,
        voice: cursor.voice,
        index: cursor.index,
      );

  // --- порт _EditorScreenState._commit ---
  void commit(void Function() mutation) {
    final before = _snapshot();
    final beforeJson = before.score.encode();
    mutation();
    _normalize();
    if (score.encode() != beforeJson) history.record(before);
  }

  void undo() {
    final r = history.undo(_snapshot());
    if (r != null) _apply(r);
  }

  void redo() {
    final r = history.redo(_snapshot());
    if (r != null) _apply(r);
  }

  void _apply(EditorSnapshot s) {
    score = s.score;
    cursor
      ..measure = s.measure
      ..voice = s.voice
      ..index = s.index;
  }

  // --- порт _EditorScreenState._normalize (по всем голосам) ---
  void _normalize() {
    final cap = _cap;
    final beats = score.timeSignature.beats;
    final beatValue = score.timeSignature.beatValue;
    final keepCount = score.measures.length;

    final bins = <String, List<List<MusicNote>>>{};
    var maxBins = 1;
    for (final v in score.instrument.voiceIds) {
      final flat = <MusicNote>[];
      for (final m in score.measures) {
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
        for (final v in score.instrument.voiceIds)
          v: i < bins[v]!.length ? bins[v]![i] : <MusicNote>[],
      }));
    }
    for (final m in measures) {
      for (final v in score.instrument.voiceIds) {
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
    score.measures = measures;
    cursor.measure = cursor.measure.clamp(0, measures.length - 1);
  }

  // --- высокоуровневые операции (упрощённый ввод после курсора) ---
  void insert(List<String> keys, String dur, {int dots = 0, bool rest = false}) {
    commit(() {
      final notes = _active;
      final pos = (cursor.index + 1).clamp(0, notes.length);
      notes.insert(pos,
          MusicNote.fromKeys(keys: List.of(keys), duration: dur, dots: dots, rest: rest));
      cursor.index = pos;
    });
  }

  void deleteAtCursor() {
    commit(() {
      final n = _active[cursor.index];
      n
        ..keys = []
        ..rest = true;
    });
  }

  /// Реальный контент голоса (без авто-пауз) — для содержательных проверок.
  List<MusicNote> real(int measure, String voice) =>
      score.measures[measure].voice(voice).where((n) => !n.auto).toList();
}

void main() {
  // ===================================================================
  //  ScoreHistory — изолированная логика стеков
  // ===================================================================
  group('ScoreHistory', () {
    EditorSnapshot snap(String id) => EditorSnapshot(
        score: Score.create(
            id: id,
            title: id,
            instrument: InstrumentType.piano,
            now: DateTime(2026)),
        measure: 0,
        voice: 'treble',
        index: 0);

    test('пустая история — нечего отменять/повторять', () {
      final h = ScoreHistory();
      expect(h.canUndo, false);
      expect(h.canRedo, false);
      expect(h.undo(snap('cur')), isNull);
      expect(h.redo(snap('cur')), isNull);
    });

    test('record → undo возвращает «до-состояние», redo — обратно', () {
      final h = ScoreHistory();
      h.record(snap('A')); // до-состояние = A, текущее = B
      expect(h.canUndo, true);

      final undone = h.undo(snap('B'));
      expect(undone!.score.id, 'A'); // вернулись к A
      expect(h.canUndo, false);
      expect(h.canRedo, true);

      final redone = h.redo(snap('A'));
      expect(redone!.score.id, 'B'); // вернули B
      expect(h.canRedo, false);
      expect(h.canUndo, true);
    });

    test('новое действие после undo очищает redo-стек', () {
      final h = ScoreHistory();
      h.record(snap('A'));
      h.undo(snap('B'));
      expect(h.canRedo, true);
      h.record(snap('C')); // новое действие
      expect(h.canRedo, false);
    });

    test('лимит истории отбрасывает старейшие состояния', () {
      final h = ScoreHistory(limit: 3);
      for (var i = 0; i < 5; i++) {
        h.record(snap('s$i'));
      }
      expect(h.undoDepth, 3);
      // старейшие (s0,s1) вытеснены — на дне s2
      expect(h.undo(snap('cur'))!.score.id, 's4');
      expect(h.undo(snap('cur'))!.score.id, 's3');
      expect(h.undo(snap('cur'))!.score.id, 's2');
      expect(h.canUndo, false);
    });
  });

  // ===================================================================
  //  Score.copy — глубина копии
  // ===================================================================
  group('Score.copy', () {
    test('правка копии не затрагивает оригинал', () {
      final s = Score.create(
          id: 'x',
          title: 'X',
          instrument: InstrumentType.piano,
          now: DateTime(2026));
      s.measures[0].voice('treble').add(MusicNote.fromKeys(keys: ['c/4'], duration: 'q'));

      final c = s.copy();
      c.measures[0].voice('treble').first.keys = ['g/4'];
      c.measures[0].voice('treble').add(MusicNote.fromKeys(keys: ['e/4'], duration: 'q'));
      c.tempo = 200;

      expect(s.measures[0].voice('treble').length, 1);
      expect(s.measures[0].voice('treble').first.keys, ['c/4']);
      expect(s.tempo, 120);
    });

    test('флаг auto сохраняется в копии (важно для restore без normalize)', () {
      final s = Score.create(
          id: 'x',
          title: 'X',
          instrument: InstrumentType.piano,
          now: DateTime(2026));
      s.measures[0].voice('treble').add(
          MusicNote.fromKeys(keys: const [], duration: 'h', rest: true, auto: true));
      final c = s.copy();
      expect(c.measures[0].voice('treble').first.auto, true);
    });
  });

  // ===================================================================
  //  Сценарии редактора (через harness)
  // ===================================================================
  group('Undo/Redo сценарии', () {
    test('мелодия: несколько undo подряд, затем несколько redo', () {
      final e = _Editor(InstrumentType.piano);
      final states = <String>[e.score.encode()]; // снимок после каждого ввода
      for (final k in ['c/4', 'd/4', 'e/4', 'f/4']) {
        e.insert([k], 'q');
        states.add(e.score.encode());
      }
      expect(e.real(0, 'treble').length, 4);

      // 4 undo -> к пустому старту
      for (var i = 0; i < 4; i++) {
        e.undo();
      }
      expect(e.real(0, 'treble').length, 0);
      expect(e.score.encode(), states[0]);

      // 4 redo -> снова полная мелодия, состояние идентично
      for (var i = 0; i < 4; i++) {
        e.redo();
      }
      expect(e.real(0, 'treble').map((n) => n.keys.first).toList(),
          ['c/4', 'd/4', 'e/4', 'f/4']);
      expect(e.score.encode(), states[4]);
    });

    test('каждое промежуточное состояние восстанавливается точь-в-точь', () {
      final e = _Editor(InstrumentType.piano);
      final s0 = e.score.encode();
      e.insert(['c/4'], 'q');
      final s1 = e.score.encode();
      e.insert(['d/4'], 'q');

      e.undo();
      expect(e.score.encode(), s1);
      e.undo();
      expect(e.score.encode(), s0);
      e.redo();
      expect(e.score.encode(), s1);
    });

    test('аккорд (multi-key) откатывается целиком', () {
      final e = _Editor(InstrumentType.piano);
      e.insert(['c/4', 'e/4', 'g/4'], 'q');
      expect(e.real(0, 'treble').first.keys.length, 3);
      e.undo();
      expect(e.real(0, 'treble').length, 0);
      e.redo();
      expect(e.real(0, 'treble').first.keys, ['c/4', 'e/4', 'g/4']);
    });

    test('ударные: ввод и откат', () {
      final e = _Editor(InstrumentType.drums);
      expect(e.cursor.voice, 'perc');
      e.insert(['g/5/x2'], 'q');
      e.insert(['f/4'], 'q');
      expect(e.real(0, 'perc').length, 2);
      e.undo();
      expect(e.real(0, 'perc').length, 1);
      e.undo();
      expect(e.real(0, 'perc').length, 0);
    });

    test('точка (dotted): откат восстанавливает длительность и точки', () {
      final e = _Editor(InstrumentType.piano);
      e.insert(['c/4'], 'q', dots: 1);
      final n = e.real(0, 'treble').first;
      expect(n.dots, 1);
      expect(n.duration, 'q');
      e.undo();
      expect(e.real(0, 'treble').length, 0);
      e.redo();
      expect(e.real(0, 'treble').first.dots, 1);
    });

    test('удаление (нота→пауза) откатывается обратно в ноту', () {
      final e = _Editor(InstrumentType.piano);
      e.insert(['c/4'], 'q');
      e.deleteAtCursor();
      expect(e.real(0, 'treble').first.rest, true);
      e.undo();
      final n = e.real(0, 'treble').first;
      expect(n.rest, false);
      expect(n.keys, ['c/4']);
    });

    test('reflow: переполнение такта и откат восстанавливают раскладку', () {
      final e = _Editor(InstrumentType.piano); // 4/4
      // 4 четверти = ровно один такт
      for (var i = 0; i < 4; i++) {
        e.insert(['c/4'], 'q');
      }
      expect(e.score.measures.length, 1);
      final oneBar = e.score.encode();

      // 5-я четверть -> reflow создаёт второй такт
      e.insert(['d/4'], 'q');
      expect(e.score.measures.length, 2);
      expect(e.real(1, 'treble').length, 1);

      // undo -> снова один такт, состояние идентично дореflow
      e.undo();
      expect(e.score.measures.length, 1);
      expect(e.score.encode(), oneBar);

      // redo -> опять два такта
      e.redo();
      expect(e.score.measures.length, 2);
    });

    test('навигация/без-изменений не засоряет историю', () {
      final e = _Editor(InstrumentType.piano);
      e.insert(['c/4'], 'q');
      expect(e.history.undoDepth, 1);
      // commit без реального изменения документа (только курсор) — не пишется
      e.commit(() => e.cursor.index = 0);
      expect(e.history.undoDepth, 1);
    });
  });
}
