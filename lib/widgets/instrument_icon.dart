import 'package:flutter/material.dart';

import '../models/score.dart';

/// Иконка инструмента. Фортепиано — стандартная Material-иконка,
/// ударная установка — векторный глиф (бас-барабан + тарелка на стойке),
/// которого нет в наборе Material Icons.
///
/// Цвет берётся из [color] либо из текущего [IconTheme] — поэтому виджет
/// одинаково корректно смотрится и в чипе, и в [CircleAvatar].
class InstrumentIcon extends StatelessWidget {
  final InstrumentType instrument;
  final double size;
  final Color? color;

  const InstrumentIcon(
    this.instrument, {
    super.key,
    this.size = 24,
    this.color,
  });

  @override
  Widget build(BuildContext context) {
    final c = color ??
        IconTheme.of(context).color ??
        Theme.of(context).colorScheme.onSurface;

    if (instrument == InstrumentType.piano) {
      return Icon(Icons.piano, size: size, color: c);
    }
    return SizedBox(
      width: size,
      height: size,
      child: CustomPaint(painter: _DrumKitPainter(c)),
    );
  }
}

class _DrumKitPainter extends CustomPainter {
  final Color color;
  _DrumKitPainter(this.color);

  @override
  void paint(Canvas canvas, Size size) {
    final s = size.shortestSide;
    final stroke = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = s * 0.07
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;

    Offset p(double x, double y) => Offset(x * s, y * s);

    // --- Бас-барабан (бочка) — большой круг с порт-отверстием ---
    final bass = p(0.40, 0.62);
    canvas.drawCircle(bass, s * 0.26, stroke);
    canvas.drawCircle(bass, s * 0.09, stroke);
    // ножки бочки
    canvas.drawLine(p(0.24, 0.82), p(0.16, 0.92), stroke);
    canvas.drawLine(p(0.56, 0.82), p(0.64, 0.92), stroke);

    // --- Тарелка на стойке (справа сверху) ---
    // стойка + основание
    canvas.drawLine(p(0.80, 0.30), p(0.80, 0.86), stroke);
    canvas.drawLine(p(0.72, 0.92), p(0.88, 0.92), stroke);
    // тарелка — плоский эллипс
    canvas.drawOval(
      Rect.fromCenter(center: p(0.80, 0.28), width: s * 0.38, height: s * 0.12),
      stroke,
    );
  }

  @override
  bool shouldRepaint(_DrumKitPainter old) => old.color != color;
}
