import 'dart:async';
import 'dart:convert';
import 'dart:js_interop';

import 'package:web/web.dart' as web;

import 'score_storage.dart';

ScoreStorage createScoreStorage() => IndexedDbScoreStorage();

/// IndexedDB score storage for Flutter Web (`scoreflow` / `scores`).
///
/// On first launch migrates legacy `localStorage` entries, verifies them,
/// then removes the old keys.
class IndexedDbScoreStorage implements ScoreStorage {
  static const _dbName = 'scoreflow';
  static const _storeName = 'scores';
  static const _dbVersion = 1;

  // Legacy localStorage layout (pre-IndexedDB web backend).
  static const _legacyIndexKey = 'scoreflow.scores.index';

  Future<void>? _ready;
  web.IDBDatabase? _db;

  Future<void> _ensureReady() {
    return _ready ??= _openAndMigrate();
  }

  Future<void> _openAndMigrate() async {
    _db = await _openDatabase();
    await _migrateFromLocalStorage(_db!);
  }

  web.IDBDatabase get _database {
    final db = _db;
    if (db == null) {
      throw StateError('IndexedDbScoreStorage not initialized');
    }
    return db;
  }

  Future<web.IDBDatabase> _openDatabase() {
    final completer = Completer<web.IDBDatabase>();
    final request = web.window.indexedDB.open(_dbName, _dbVersion);

    request.onupgradeneeded = ((web.Event event) {
      final req = event.target! as web.IDBOpenDBRequest;
      final db = req.result as web.IDBDatabase;
      if (!db.objectStoreNames.contains(_storeName)) {
        db.createObjectStore(_storeName);
      }
    }).toJS;

    request.onsuccess = ((web.Event event) {
      final req = event.target! as web.IDBOpenDBRequest;
      completer.complete(req.result as web.IDBDatabase);
    }).toJS;

    request.onerror = ((web.Event event) {
      final req = event.target! as web.IDBOpenDBRequest;
      completer.completeError(
        StateError('IndexedDB open failed: ${req.error?.message}'),
      );
    }).toJS;

    return completer.future;
  }

  Future<void> _migrateFromLocalStorage(web.IDBDatabase db) async {
    final indexRaw = web.window.localStorage.getItem(_legacyIndexKey);
    if (indexRaw == null || indexRaw.isEmpty) return;

    final ids = _parseLegacyIndex(indexRaw);
    if (ids.isEmpty) {
      web.window.localStorage.removeItem(_legacyIndexKey);
      return;
    }

    final legacy = <String, String>{};
    for (final id in ids) {
      final raw = web.window.localStorage.getItem(_legacyKey(id));
      if (raw != null && raw.isNotEmpty) legacy[id] = raw;
    }

    if (legacy.isEmpty) {
      web.window.localStorage.removeItem(_legacyIndexKey);
      return;
    }

    for (final entry in legacy.entries) {
      await _put(db, entry.key, entry.value);
    }

    for (final entry in legacy.entries) {
      final copied = await _get(db, entry.key);
      if (copied != entry.value) {
        throw StateError(
          'localStorage migration verify failed for score ${entry.key}',
        );
      }
    }

    for (final id in ids) {
      web.window.localStorage.removeItem(_legacyKey(id));
    }
    web.window.localStorage.removeItem(_legacyIndexKey);
  }

  List<String> _parseLegacyIndex(String raw) {
    try {
      final decoded = jsonDecode(raw);
      if (decoded is List) {
        return decoded.map((e) => e.toString()).toList();
      }
    } catch (_) {}
    return [];
  }

  String _legacyKey(String id) => 'scoreflow.score.$id';

  Future<void> _put(web.IDBDatabase db, String id, String json) {
    final completer = Completer<void>();
    final tx = db.transaction(_storeName.toJS, 'readwrite');
    final store = tx.objectStore(_storeName);
    final request = store.put(json.toJS, id.toJS);

    request.onsuccess = ((web.Event _) => completer.complete()).toJS;
    request.onerror = ((web.Event _) {
      completer.completeError(
        StateError('IndexedDB put failed: ${request.error?.message}'),
      );
    }).toJS;

    return completer.future;
  }

  Future<String?> _get(web.IDBDatabase db, String id) {
    final completer = Completer<String?>();
    final tx = db.transaction(_storeName.toJS, 'readonly');
    final store = tx.objectStore(_storeName);
    final request = store.get(id.toJS);

    request.onsuccess = ((web.Event _) {
      final value = request.result;
      if (value == null || value.isUndefinedOrNull) {
        completer.complete(null);
        return;
      }
      completer.complete(value.dartify() as String?);
    }).toJS;

    request.onerror = ((web.Event _) {
      completer.completeError(
        StateError('IndexedDB get failed: ${request.error?.message}'),
      );
    }).toJS;

    return completer.future;
  }

  @override
  Future<List<String>> listIds() async {
    await _ensureReady();
    final completer = Completer<List<String>>();
    final tx = _database.transaction(_storeName.toJS, 'readonly');
    final store = tx.objectStore(_storeName);
    final request = store.getAllKeys();

    request.onsuccess = ((web.Event _) {
      final keys = request.result;
      if (keys == null || keys.isUndefinedOrNull) {
        completer.complete([]);
        return;
      }
      final dart = keys.dartify();
      if (dart is List) {
        completer.complete(dart.map((e) => e.toString()).toList());
      } else {
        completer.complete([]);
      }
    }).toJS;

    request.onerror = ((web.Event _) {
      completer.completeError(
        StateError('IndexedDB getAllKeys failed: ${request.error?.message}'),
      );
    }).toJS;

    return completer.future;
  }

  @override
  Future<String?> readJson(String id) async {
    await _ensureReady();
    return _get(_database, id);
  }

  @override
  Future<void> writeJson(String id, String json) async {
    await _ensureReady();
    await _put(_database, id, json);
  }

  @override
  Future<void> delete(String id) async {
    await _ensureReady();
    final completer = Completer<void>();
    final tx = _database.transaction(_storeName.toJS, 'readwrite');
    final store = tx.objectStore(_storeName);
    final request = store.delete(id.toJS);

    request.onsuccess = ((web.Event _) => completer.complete()).toJS;
    request.onerror = ((web.Event _) {
      completer.completeError(
        StateError('IndexedDB delete failed: ${request.error?.message}'),
      );
    }).toJS;

    return completer.future;
  }
}
