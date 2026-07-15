import 'dart:convert';

import 'package:web/web.dart' as web;

import '../models/score.dart';

/// Browser score storage via `localStorage` (Flutter Web).
class ScoreRepositoryBackend {
  static const _indexKey = 'scoreflow.scores.index';

  String _key(String id) => 'scoreflow.score.$id';

  List<String> _readIndex() {
    final raw = web.window.localStorage.getItem(_indexKey);
    if (raw == null || raw.isEmpty) return [];
    try {
      final decoded = jsonDecode(raw);
      if (decoded is List) {
        return decoded.map((e) => e.toString()).toList();
      }
    } catch (_) {}
    return [];
  }

  void _writeIndex(List<String> ids) {
    web.window.localStorage.setItem(_indexKey, jsonEncode(ids));
  }

  Future<List<Score>> listAll() async {
    final scores = <Score>[];
    for (final id in _readIndex()) {
      final s = await load(id);
      if (s != null) scores.add(s);
    }
    scores.sort((a, b) => b.updatedAt.compareTo(a.updatedAt));
    return scores;
  }

  Future<Score?> load(String id) async {
    final raw = web.window.localStorage.getItem(_key(id));
    if (raw == null || raw.isEmpty) return null;
    try {
      return Score.decode(raw);
    } catch (_) {
      return null;
    }
  }

  Future<void> save(Score score) async {
    score.updatedAt = DateTime.now();
    web.window.localStorage.setItem(_key(score.id), score.encode());
    final ids = _readIndex();
    if (!ids.contains(score.id)) {
      ids.add(score.id);
      _writeIndex(ids);
    }
  }

  Future<void> delete(String id) async {
    web.window.localStorage.removeItem(_key(id));
    final ids = _readIndex()..remove(id);
    _writeIndex(ids);
  }
}
