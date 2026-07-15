import '../models/score.dart';
import 'storage/score_storage.dart';

/// Shared repository backend — delegates persistence to [ScoreStorage].
class ScoreRepositoryBackend {
  final ScoreStorage _storage = createScoreStorage();

  Future<List<Score>> listAll() async {
    final scores = <Score>[];
    for (final id in await _storage.listIds()) {
      try {
        final raw = await _storage.readJson(id);
        if (raw != null) scores.add(Score.decode(raw));
      } catch (_) {
        // Skip corrupt documents without failing the whole list.
      }
    }
    scores.sort((a, b) => b.updatedAt.compareTo(a.updatedAt));
    return scores;
  }

  Future<Score?> load(String id) async {
    final raw = await _storage.readJson(id);
    if (raw == null || raw.isEmpty) return null;
    try {
      return Score.decode(raw);
    } catch (_) {
      return null;
    }
  }

  Future<void> save(Score score) async {
    score.updatedAt = DateTime.now();
    await _storage.writeJson(score.id, score.encode());
  }

  Future<void> delete(String id) async {
    await _storage.delete(id);
  }
}
