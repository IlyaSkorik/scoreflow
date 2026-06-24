import 'score.dart';

/// Лимит глубины Undo по умолчанию. При переполнении старейшие состояния
/// отбрасываются (см. [ScoreHistory.record]).
const int kUndoHistoryLimit = 50;

/// Снимок состояния редактора для Undo/Redo: партитура целиком + позиция
/// курсора. Партитура хранится как глубокая копия ([Score.copy]) — снимок
/// неизменяем относительно живого документа и переживает последующие правки.
class EditorSnapshot {
  final Score score;
  final int measure;
  final String voice;
  final int index;

  const EditorSnapshot({
    required this.score,
    required this.measure,
    required this.voice,
    required this.index,
  });
}

/// Snapshot-based история Undo/Redo.
///
/// Модель «до-состояний»: при каждом изменении документа вызывающий код
/// передаёт снимок состояния ДО правки в [record]. [undo] возвращает это
/// «до-состояние» (а текущее уходит в redo-стек); [redo] — обратно.
///
/// Любая запись через [record] очищает redo-стек — это стандартное поведение
/// редакторов: новое действие после Undo делает «будущее» недостижимым.
///
/// Класс не зависит от Flutter и тестируется напрямую.
class ScoreHistory {
  ScoreHistory({this.limit = kUndoHistoryLimit})
      : assert(limit > 0, 'limit должен быть положительным');

  final int limit;
  final List<EditorSnapshot> _undo = [];
  final List<EditorSnapshot> _redo = [];

  bool get canUndo => _undo.isNotEmpty;
  bool get canRedo => _redo.isNotEmpty;
  int get undoDepth => _undo.length;
  int get redoDepth => _redo.length;

  /// Зафиксировать переход: [before] — снимок состояния ДО изменения.
  void record(EditorSnapshot before) {
    _undo.add(before);
    _trim(_undo);
    _redo.clear();
  }

  /// Откат. [current] — снимок текущего состояния (уйдёт в redo-стек).
  /// Возвращает состояние, к которому нужно вернуться, либо null если нечего.
  EditorSnapshot? undo(EditorSnapshot current) {
    if (_undo.isEmpty) return null;
    _redo.add(current);
    _trim(_redo);
    return _undo.removeLast();
  }

  /// Повтор. [current] — снимок текущего состояния (уйдёт в undo-стек).
  /// Возвращает состояние, к которому нужно перейти, либо null если нечего.
  EditorSnapshot? redo(EditorSnapshot current) {
    if (_redo.isEmpty) return null;
    _undo.add(current);
    _trim(_undo);
    return _redo.removeLast();
  }

  void clear() {
    _undo.clear();
    _redo.clear();
  }

  /// Ограничение памяти: держим не более [limit] записей, отбрасывая старейшие.
  void _trim(List<EditorSnapshot> stack) {
    if (stack.length > limit) {
      stack.removeRange(0, stack.length - limit);
    }
  }
}
