import '../models/score.dart';

/// Backend used when neither IO nor web is available.
class ScoreRepositoryBackend {
  Future<List<Score>> listAll() async =>
      throw UnsupportedError('ScoreRepository is not available on this platform.');

  Future<Score?> load(String id) async =>
      throw UnsupportedError('ScoreRepository is not available on this platform.');

  Future<void> save(Score score) async =>
      throw UnsupportedError('ScoreRepository is not available on this platform.');

  Future<void> delete(String id) async =>
      throw UnsupportedError('ScoreRepository is not available on this platform.');
}
