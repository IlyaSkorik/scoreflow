import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:flutter_native_splash/flutter_native_splash.dart';

import 'data/score_repository.dart';
import 'screens/splash_screen.dart';

/// Локальный HTTP-сервер отдаёт ассеты движка по http://localhost, чтобы в
/// WebView резолвились относительные пути (js/vexflow.js) — offline-first.
const String kEngineUrl = 'http://localhost:8080/assets/www/index.html';

final InAppLocalhostServer _localhostServer = InAppLocalhostServer(shared: true);

void main() {
  final binding = WidgetsFlutterBinding.ensureInitialized();
  // Удерживаем нативный splash до первого кадра; снимет его SplashScreen
  // (бесшовно — фон совпадает). Сервер движка стартуем В ФОНЕ и НЕ ждём перед
  // runApp: иначе системный splash висел бы до старта сервера. Наш Flutter-
  // splash появляется сразу и держится свои 2.5с; сервер успевает подняться к
  // моменту открытия редактора.
  FlutterNativeSplash.preserve(widgetsBinding: binding);
  unawaited(_startEngineServer());
  runApp(ScoreFlowApp());
}

/// Поднимает локальный сервер ассетов движка. При занятом порте/сбое bind()
/// приложение всё равно работает (WebView покажет собственный фолбэк).
Future<void> _startEngineServer() async {
  try {
    if (!_localhostServer.isRunning()) {
      await _localhostServer.start().timeout(const Duration(seconds: 5));
    }
  } catch (e) {
    debugPrint('InAppLocalhostServer start failed: $e');
  }
}

class ScoreFlowApp extends StatelessWidget {
  ScoreFlowApp({super.key});

  // Единый экземпляр хранилища: splash -> библиотека получают один и тот же.
  final ScoreRepository _repository = ScoreRepository();

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
      home: SplashScreen(repository: _repository),
    );
  }
}
