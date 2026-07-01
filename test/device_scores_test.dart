import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:scoreflow/models/score.dart';

/// Демо-партитуры для устройства (test/print/device_scores) обязаны
/// открываться приложением: формат хранилища ScoreRepository, ноты в
/// legacy-виде `keys` (мигрируются в Pitch при загрузке). Ломается формат —
/// ломается этот тест, а не молчаливый пропуск файла в библиотеке.
void main() {
  final dir = Directory('test/print/device_scores');

  test('демо-партитуры декодируются моделью Score', () {
    final files = dir
        .listSync()
        .whereType<File>()
        .where((f) => f.path.endsWith('.json'))
        .toList();
    expect(files, isNotEmpty,
        reason: 'нет файлов — запусти node test/print/gen_device_scores.mjs');

    for (final f in files) {
      final score = Score.decode(f.readAsStringSync());
      // Имя файла должно совпадать с id (репозиторий грузит по <id>.json).
      final name = f.uri.pathSegments.last;
      expect(name, '${score.id}.json');
      expect(score.measures, isNotEmpty);
      // Round-trip: сохранённое приложением заново декодируется.
      final again = Score.decode(score.encode());
      expect(again.encode(), score.encode());
      // Ноты мигрировали в Pitch (у не-пауз есть головки).
      final withNotes = score.measures
          .expand((m) => m.voices.values)
          .expand((v) => v)
          .where((n) => !n.rest);
      expect(withNotes.every((n) => n.pitches.isNotEmpty), isTrue);
      // renderPayload строится без исключений (это откроет редактор).
      expect(jsonDecode(score.renderPayload(EditorCursor())), isA<Map>());
    }
  });
}
