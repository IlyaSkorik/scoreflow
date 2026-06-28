import 'package:flutter/material.dart';

/// Иконка метронома — классический корпус-трапеция с маятником и грузиком.
/// Настоящего метронома нет в наборе Material Icons (там лишь секундомеры),
/// поэтому рисуем векторный глиф — по той же схеме, что и [InstrumentIcon].
///
/// Цвет берётся из [color] либо из текущего [IconTheme] — поэтому виджет
/// корректно смотрится и в [IconButton], и в любом другом месте.
class MetronomeIcon extends StatelessWidget {
  final double size;
  final Color? color;

  const MetronomeIcon({super.key, this.size = 24, this.color});

  @override
  Widget build(BuildContext context) {
    final c = color ??
        IconTheme.of(context).color ??
        Theme.of(context).colorScheme.onSurface;
    return SizedBox(
      width: size,
      height: size,
      child: CustomPaint(painter: _MetronomePainter(c)),
    );
  }
}

class _MetronomePainter extends CustomPainter {
  final Color color;
  _MetronomePainter(this.color);

  @override
  void paint(Canvas canvas, Size size) {
    final s = size.shortestSide;
    final fill = Paint()
      ..color = color
      ..style = PaintingStyle.fill
      ..isAntiAlias = true;

    // --- Корпус — сплошная трапеция (узкий верх, широкое основание) ---
    final body = Path()
      ..moveTo(0.36 * s, 0.12 * s)
      ..lineTo(0.64 * s, 0.12 * s)
      ..lineTo(0.82 * s, 0.84 * s)
      ..lineTo(0.18 * s, 0.84 * s)
      ..close();

    // --- Основание (широкая полка снизу) ---
    final base = Path()
      ..addRRect(RRect.fromRectAndRadius(
        Rect.fromLTRB(0.12 * s, 0.84 * s, 0.88 * s, 0.92 * s),
        Radius.circular(0.03 * s),
      ));

    // --- Маятник: стержень + грузик-ромб — вырезаются из корпуса ---
    // Стержень — тонкий четырёхугольник вдоль линии качания (наклон вправо).
    final rod = Path()
      ..moveTo(0.565 * s, 0.252 * s)
      ..lineTo(0.635 * s, 0.268 * s)
      ..lineTo(0.535 * s, 0.808 * s)
      ..lineTo(0.465 * s, 0.792 * s)
      ..close();
    // Грузик — ромб на стержне, ближе к верху.
    final weight = Path()
      ..moveTo(0.58 * s, 0.275 * s)
      ..lineTo(0.675 * s, 0.37 * s)
      ..lineTo(0.58 * s, 0.465 * s)
      ..lineTo(0.485 * s, 0.37 * s)
      ..close();

    final pendulum = Path.combine(PathOperation.union, rod, weight);
    final shell = Path.combine(PathOperation.union, body, base);
    final glyph = Path.combine(PathOperation.difference, shell, pendulum);
    canvas.drawPath(glyph, fill);
  }

  @override
  bool shouldRepaint(_MetronomePainter old) => old.color != color;
}
