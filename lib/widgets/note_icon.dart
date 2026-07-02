import 'dart:math' as math;

import 'package:flutter/material.dart';

/// Гравированная нота для палитры длительностей (и любого UI, где нужен
/// нотный глиф): целая/половинная/четверть/восьмая/…/64-я, с точками.
///
/// Unicode-глифы (𝅝 ♩ ♪ 𝅘𝅥𝅯 …) рендерятся текстовым шрифтом непредсказуемо:
/// разный кегль и базовая линия между символами, на части платформ — вообще
/// tofu/эмодзи. Здесь — вектор в издательских пропорциях (та же школа, что
/// [TempoNoteIcon] и гравировка движка): наклонная овальная головка, штиль,
/// флажки, точка. Все длительности рисуются в ЕДИНОЙ системе координат
/// (головки на одном уровне) — ряд палитры выглядит как нотная строка.
///
/// [size] — высота бокса глифа. Цвет — [color], иначе цвет текста/темы.
class NoteIcon extends StatelessWidget {
  final String duration; // id VexFlow: 'w' 'h' 'q' '8' '16' '32' '64'
  final int dots;
  final double size;
  final Color? color;

  const NoteIcon({
    super.key,
    required this.duration,
    this.dots = 0,
    this.size = 34,
    this.color,
  });

  @override
  Widget build(BuildContext context) {
    final c = color ??
        DefaultTextStyle.of(context).style.color ??
        IconTheme.of(context).color ??
        Theme.of(context).colorScheme.onSurface;
    return SizedBox(
      width: size * (26.0 / 40.0),
      height: size,
      child: CustomPaint(painter: _NotePainter(duration, dots, c)),
    );
  }
}

class _NotePainter extends CustomPainter {
  final String duration;
  final int dots;
  final Color color;
  _NotePainter(this.duration, this.dots, this.color);

  static const _flagsOf = {'8': 1, '16': 2, '32': 3, '64': 4};

  @override
  void paint(Canvas canvas, Size size) {
    // Единицы гравировки: холст 40u высотой, головка 10u (промежуток стана).
    final u = size.height / 40.0;
    final fill = Paint()
      ..color = color
      ..style = PaintingStyle.fill
      ..isAntiAlias = true;

    final headCy = 34.0 * u; // головки ВСЕХ длительностей на одном уровне
    final headLeft = 1.5 * u;

    if (duration == 'w') {
      _wholeHead(canvas, fill, headLeft, headCy, u);
      _drawDots(canvas, fill, headLeft + 15.2 * u, headCy, u);
      return;
    }

    // --- Головка: наклонный овал (залитый; у половинной — с просветом) ---
    final headW = 11.9 * u, headH = 10.0 * u;
    final headCx = headLeft + headW / 2;
    final outer = _tiltedOval(headCx, headCy, headW * 1.04, headH * 0.82, -21);
    if (duration == 'h') {
      final hole =
          _tiltedOval(headCx, headCy, headW * 0.88, headH * 0.40, -24);
      canvas.drawPath(
          Path.combine(PathOperation.difference, outer, hole), fill);
    } else {
      canvas.drawPath(outer, fill);
    }

    // --- Штиль: у правого края головки, вверх ---
    final flags = _flagsOf[duration] ?? 0;
    final stemW = 1.6 * u;
    final stemX = headLeft + headW - stemW; // левый край штиля
    var stemLen = 24.0 * u + (flags > 0 ? (2.0 + (flags - 1) * 5.2) * u : 0);
    if (stemLen > headCy - 1.0 * u) stemLen = headCy - 1.0 * u;
    final stemTop = headCy - stemLen;
    canvas.drawRect(
        Rect.fromLTRB(stemX, stemTop, stemX + stemW, headCy - 1.0 * u), fill);

    // --- Флажки: свуш от штиля вправо-вниз, стопкой ---
    final flagPaint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.8 * u
      ..strokeCap = StrokeCap.round
      ..isAntiAlias = true;
    final sx = stemX + stemW / 2;
    for (var i = 0; i < flags; i++) {
      final sy = stemTop + i * 5.2 * u;
      final flag = Path()
        ..moveTo(sx, sy)
        ..cubicTo(sx + 6.5 * u, sy + 2.5 * u, sx + 8.5 * u, sy + 6.5 * u,
            sx + 5.5 * u, sy + 11.0 * u);
      canvas.drawPath(flag, flagPaint);
    }

    _drawDots(canvas, fill, headLeft + headW, headCy, u);
  }

  /// Целая: широкий горизонтальный овал с наклонным просветом, без штиля.
  void _wholeHead(Canvas canvas, Paint fill, double left, double cy, double u) {
    final cx = left + 7.3 * u;
    final outer = _tiltedOval(cx, cy, 14.6 * u, 9.2 * u, 0);
    final hole = _tiltedOval(cx, cy, 7.4 * u, 5.0 * u, -60);
    canvas.drawPath(Path.combine(PathOperation.difference, outer, hole), fill);
  }

  /// Точки: справа от головки, чуть выше её центра (издательская посадка).
  void _drawDots(
      Canvas canvas, Paint fill, double rightEdge, double headCy, double u) {
    for (var i = 0; i < dots; i++) {
      canvas.drawCircle(
        Offset(rightEdge + (3.8 + i * 4.5) * u, headCy - 1.0 * u),
        1.7 * u,
        fill,
      );
    }
  }

  Path _tiltedOval(double cx, double cy, double w, double h, double deg) {
    final oval = Path()
      ..addOval(Rect.fromCenter(center: Offset.zero, width: w, height: h));
    final m = Matrix4.identity()
      ..translateByDouble(cx, cy, 0, 1)
      ..rotateZ(deg * math.pi / 180);
    return oval.transform(m.storage);
  }

  @override
  bool shouldRepaint(_NotePainter old) =>
      old.duration != duration || old.dots != dots || old.color != color;
}
