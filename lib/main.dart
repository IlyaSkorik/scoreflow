import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_native_splash/flutter_native_splash.dart';

import 'data/score_repository.dart';
import 'engine/engine_bootstrap.dart';
import 'screens/splash_screen.dart';

void main() {
  final binding = WidgetsFlutterBinding.ensureInitialized();
  // Keep the native splash until SplashScreen's first frame. Bootstrap the
  // engine in the background — never block runApp (on web bootstrap is a no-op).
  FlutterNativeSplash.preserve(widgetsBinding: binding);
  unawaited(bootstrapEngine());
  runApp(ScoreFlowApp());
}

class ScoreFlowApp extends StatelessWidget {
  ScoreFlowApp({super.key});

  // Single repository instance shared splash → library → editor.
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
