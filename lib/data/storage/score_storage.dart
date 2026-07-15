import 'score_storage_stub.dart'
    if (dart.library.io) 'file_score_storage.dart'
    if (dart.library.js_interop) 'indexed_db_score_storage.dart' as impl;

/// Persistence backend for score JSON documents (platform-selected).
abstract class ScoreStorage {
  /// All stored score ids.
  Future<List<String>> listIds();

  /// Raw JSON document written by [Score.encode], or null if absent.
  Future<String?> readJson(String id);

  /// Persists [json] verbatim (caller sets [Score.updatedAt]).
  Future<void> writeJson(String id, String json);

  /// Removes a score document.
  Future<void> delete(String id);
}

/// Platform-appropriate [ScoreStorage] (file on mobile, IndexedDB on web).
ScoreStorage createScoreStorage() => impl.createScoreStorage();
