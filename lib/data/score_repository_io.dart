import 'dart:io';

import 'package:path_provider/path_provider.dart';

import '../models/score.dart';

/// File-based score storage (Android / iOS).
class ScoreRepositoryBackend {
  Directory? _cachedDir;

  Future<Directory> _dir() async {
    if (_cachedDir != null) return _cachedDir!;
    final base = await getApplicationDocumentsDirectory();
    final dir = Directory('${base.path}/scoreflow/scores');
    if (!await dir.exists()) {
      await dir.create(recursive: true);
    }
    return _cachedDir = dir;
  }

  File _fileFor(Directory dir, String id) => File('${dir.path}/$id.json');

  Future<List<Score>> listAll() async {
    final dir = await _dir();
    final files = await dir
        .list()
        .where((e) => e is File && e.path.endsWith('.json'))
        .cast<File>()
        .toList();

    final scores = <Score>[];
    for (final f in files) {
      try {
        scores.add(Score.decode(await f.readAsString()));
      } catch (_) {
        // Skip corrupt files without failing the whole list.
      }
    }
    scores.sort((a, b) => b.updatedAt.compareTo(a.updatedAt));
    return scores;
  }

  Future<Score?> load(String id) async {
    final dir = await _dir();
    final f = _fileFor(dir, id);
    if (!await f.exists()) return null;
    return Score.decode(await f.readAsString());
  }

  Future<void> save(Score score) async {
    score.updatedAt = DateTime.now();
    final dir = await _dir();
    await _fileFor(dir, score.id).writeAsString(score.encode(), flush: true);
  }

  Future<void> delete(String id) async {
    final dir = await _dir();
    final f = _fileFor(dir, id);
    if (await f.exists()) await f.delete();
  }
}
