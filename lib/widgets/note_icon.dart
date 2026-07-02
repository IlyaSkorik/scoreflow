import 'dart:math' as math;

import 'package:flutter/material.dart';

/// Гравированная нота для палитры длительностей (и любого UI, где нужен
/// нотный глиф): целая/половинная/четверть/восьмая/…/64-я, с точками.
///
/// Unicode-глифы (𝅝 ♩ ♪ 𝅘𝅥𝅯 …) рендерятся текстовым шрифтом непредсказуемо:
/// разный кегль и базовая линия между символами, на части платформ — вообще
/// tofu/эмодзи. Здесь — вектор в издательских пропорциях (та же школа, что
/// [TempoNoteIcon] и гравировка движка): наклонная овальная головка, штиль,
/// флажки, точка.
///
/// Бокс виджета — ТЕСНЫЙ (по фактическим чернилам глифа), поэтому обычный
/// [Center] честно центрирует ноту в ячейке палитры. Все длительности делят
/// одну единицу масштаба: [size] — высота ЧЕТВЕРТНОЙ ноты; целая ниже,
/// флажковые выше, ширина у всех своя. Цвет — [color], иначе цвет текста/темы.
class NoteIcon extends StatelessWidget {
  final String duration; // id VexFlow: 'w' 'h' 'q' '8' '16' '32' '64'
  final int dots;
  final double size;
  final Color? color;

  const NoteIcon({
    super.key,
    required this.duration,
    this.dots = 0,
    this.size = 26,
    this.color,
  });

  @override
  Widget build(BuildContext context) {
    final c = color ??
        DefaultTextStyle.of(context).style.color ??
        IconTheme.of(context).color ??
        Theme.of(context).colorScheme.onSurface;
    final u = size / _NotePainter.refH; // единица гравировки
    final ink = _NotePainter.inkUnits(duration, dots);
    return SizedBox(
      width: ink.width * u,
      height: ink.height * u,
      child: CustomPaint(painter: _NotePainter(duration, dots, c, u)),
    );
  }
}

class _NotePainter extends CustomPainter {
  final String duration;
  final int dots;
  final Color color;
  final double u; // px на единицу гравировки (головка = 10 единиц)
  _NotePainter(this.duration, this.dots, this.color, this.u);

  static const _flagsOf = {'8': 1, '16': 2, '32': 3, '64': 4};
  static const _headW = 11.9, _headH = 10.0, _stemW = 1.6;

  /// Высота четвертной (штиль 24 + полголовки) — референс масштаба [NoteIcon.size].
  static const refH = 29.0;

  static double _stemLen(int flags) =>
      flags > 0 ? 26.0 + (flags - 1) * 5.2 : 24.0;

  /// Габариты чернил глифа в единицах гравировки.
  static Size inkUnits(String duration, int dots) {
    double w, h;
    if (duration == 'w') {
      w = 14.6;
      h = 9.2;
    } else {
      final flags = _flagsOf[duration] ?? 0;
      h = _stemLen(flags) + _headH / 2;
      w = flags > 0 ? 20.5 : _headW;
    }
    if (dots > 0) {
      final headRight = duration == 'w' ? 14.6 : _headW;
      w = math.max(w, headRight + 3.8 + (dots - 1) * 4.5 + 1.7);
    }
    return Size(w, h);
  }

  @override
  void paint(Canvas canvas, Size size) {
    final fill = Paint()
      ..color = color
      ..style = PaintingStyle.fill
      ..isAntiAlias = true;

    if (duration == 'w') {
      // Целая: широкий горизонтальный овал с наклонным просветом, без штиля.
      final cy = size.height / 2;
      final outer = _tiltedOval(7.3 * u, cy, 14.6 * u, 9.2 * u, 0);
      final hole = _tiltedOval(7.3 * u, cy, 7.4 * u, 5.0 * u, -60);
      canvas.drawPath(
          Path.combine(PathOperation.difference, outer, hole), fill);
      _drawDots(canvas, fill, 14.6 * u, cy);
      return;
    }

    final flags = _flagsOf[duration] ?? 0;
    final stemLen = _stemLen(flags) * u;
    final headCy = stemLen; // штиль начинается у верхнего края чернил
    final headCx = _headW * u / 2;

    // --- Головка: наклонный овал (залитый; у половинной — с просветом) ---
    final outer =
        _tiltedOval(headCx, headCy, _headW * u * 1.04, _headH * u * 0.82, -21);
    if (duration == 'h') {
      final hole =
          _tiltedOval(headCx, headCy, _headW * u * 0.88, _headH * u * 0.40, -24);
      canvas.drawPath(
          Path.combine(PathOperation.difference, outer, hole), fill);
    } else {
      canvas.drawPath(outer, fill);
    }

    // --- Штиль: у правого края головки, вверх ---
    final stemX = (_headW - _stemW) * u;
    canvas.drawRect(
        Rect.fromLTRB(stemX, 0, stemX + _stemW * u, headCy - 1.0 * u), fill);

    // --- Флажки: свуш от штиля вправо-вниз, стопкой ---
    final flagPaint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.8 * u
      ..strokeCap = StrokeCap.round
      ..isAntiAlias = true;
    final sx = stemX + _stemW * u / 2;
    for (var i = 0; i < flags; i++) {
      final sy = i * 5.2 * u;
      final flag = Path()
        ..moveTo(sx, sy)
        ..cubicTo(sx + 6.5 * u, sy + 2.5 * u, sx + 8.5 * u, sy + 6.5 * u,
            sx + 5.5 * u, sy + 11.0 * u);
      canvas.drawPath(flag, flagPaint);
    }

    _drawDots(canvas, fill, _headW * u, headCy);
  }

  /// Точки: справа от головки, чуть выше её центра (издательская посадка).
  void _drawDots(Canvas canvas, Paint fill, double rightEdge, double headCy) {
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
      old.duration != duration ||
      old.dots != dots ||
      old.color != color ||
      old.u != u;
}
