import 'package:flutter/material.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';

import 'data/score_repository.dart';
import 'screens/library_screen.dart';

/// Локальный HTTP-сервер отдаёт ассеты движка по http://localhost, чтобы в
/// WebView резолвились относительные пути (js/vexflow.js) — offline-first.
const String kEngineUrl = 'http://localhost:8080/assets/www/index.html';

final InAppLocalhostServer _localhostServer = InAppLocalhostServer(shared: true);

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // Старт движка-сервера не должен блокировать запуск UI: при занятом порте
  // или сбое bind() приложение всё равно поднимется (WebView покажет
  // собственный фолбэк, если ассеты не отдаются).
  try {
    if (!_localhostServer.isRunning()) {
      await _localhostServer.start().timeout(const Duration(seconds: 5));
    }
  } catch (e) {
    debugPrint('InAppLocalhostServer start failed: $e');
  }
  runApp(const ScoreFlowApp());
}

class ScoreFlowApp extends StatelessWidget {
  const ScoreFlowApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'ScoreFlow',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: Colors.deepPurple,
          brightness: Brightness.dark,
        ),
        useMaterial3: true,
      ),
      home: LibraryScreen(repository: ScoreRepository()),
    );
  }
}
