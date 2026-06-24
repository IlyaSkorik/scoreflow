import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_native_splash/flutter_native_splash.dart';

import '../data/score_repository.dart';
import 'library_screen.dart';

/// Фон splash — совпадает с цветом нативного splash (`flutter_native_splash`),
/// поэтому переход native -> Flutter бесшовный (без вспышки/скачка).
const Color _splashBg = Color(0xFF141218);

/// Минимальное время показа splash, чтобы он не «проскакивал» при быстром
/// старте (бренд успевает прочитаться). Без анимаций — просто пауза.
const Duration _minHold = Duration(milliseconds: 3000);

/// Стартовый экран: тёмный фон + иконка + название и подзаголовок темой
/// приложения. Native splash рисует только фон и иконку (текст он не умеет) —
/// надпись добавляет этот Flutter-экран. Без анимаций иконки; короткая
/// задержка, затем переход в библиотеку.
class SplashScreen extends StatefulWidget {
  final ScoreRepository repository;
  const SplashScreen({super.key, required this.repository});

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen> {
  @override
  void initState() {
    super.initState();
    // Снимаем нативный splash после первого кадра — этот экран идентичен ему по
    // фону и иконке, поэтому передача эстафеты незаметна.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      FlutterNativeSplash.remove();
    });
    _goNext();
  }

  Future<void> _goNext() async {
    await Future<void>.delayed(_minHold);
    if (!mounted) return;
    Navigator.of(context).pushReplacement(
      PageRouteBuilder(
        transitionDuration: const Duration(milliseconds: 250),
        pageBuilder: (_, __, ___) =>
            LibraryScreen(repository: widget.repository),
        transitionsBuilder: (_, anim, __, child) =>
            FadeTransition(opacity: anim, child: child),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      backgroundColor: _splashBg,
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Image(
              image: AssetImage('assets/icon/icon.png'),
              height: 112,
              width: 112,
            ),
            SizedBox(height: 24),
            Text(
              'ScoreFlow',
              style: TextStyle(
                color: Colors.white,
                fontSize: 26,
                fontWeight: FontWeight.w600,
                letterSpacing: 0.5,
              ),
            ),
            SizedBox(height: 6),
            Text(
              'Create • Play • Print',
              style: TextStyle(
                color: Color(0x99FFFFFF), // ~60% white — приглушённый подзаголовок
                fontSize: 13,
                letterSpacing: 1.5,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
