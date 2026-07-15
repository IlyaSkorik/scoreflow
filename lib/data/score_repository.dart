import '../models/score.dart';
import 'score_repository_stub.dart'
    if (dart.library.io) 'score_repository_backend.dart'
    if (dart.library.js_interop) 'score_repository_backend.dart' as impl;

/// Local score storage (offline-first, no backend).
///
/// Android/iOS: JSON files under application documents.
/// Web: IndexedDB (`scoreflow` / `scores`).
class ScoreRepository {
  final impl.ScoreRepositoryBackend _backend = impl.ScoreRepositoryBackend();

  /// All scores, newest [Score.updatedAt] first.
  Future<List<Score>> listAll() => _backend.listAll();

  Future<Score?> load(String id) => _backend.load(id);

  Future<void> save(Score score) => _backend.save(score);

  Future<void> delete(String id) => _backend.delete(id);
}
