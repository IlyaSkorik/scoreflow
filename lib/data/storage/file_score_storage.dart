import 'dart:io';

import 'package:path_provider/path_provider.dart';

import 'score_storage.dart';

ScoreStorage createScoreStorage() => FileScoreStorage();

/// JSON file storage under `<app documents>/scoreflow/scores/<id>.json`.
class FileScoreStorage implements ScoreStorage {
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

  @override
  Future<List<String>> listIds() async {
    final dir = await _dir();
    final files = await dir
        .list()
        .where((e) => e is File && e.path.endsWith('.json'))
        .cast<File>()
        .toList();
    return files
        .map((f) => f.uri.pathSegments.last.replaceAll('.json', ''))
        .toList();
  }

  @override
  Future<String?> readJson(String id) async {
    final dir = await _dir();
    final f = _fileFor(dir, id);
    if (!await f.exists()) return null;
    return f.readAsString();
  }

  @override
  Future<void> writeJson(String id, String json) async {
    final dir = await _dir();
    await _fileFor(dir, id).writeAsString(json, flush: true);
  }

  @override
  Future<void> delete(String id) async {
    final dir = await _dir();
    final f = _fileFor(dir, id);
    if (await f.exists()) await f.delete();
  }
}
