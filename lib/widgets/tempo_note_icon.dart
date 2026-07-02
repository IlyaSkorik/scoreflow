import 'dart:math' as math;

import 'package:flutter/material.dart';

/// Гравированная четвертная нота для UI темпа (чип «♩ = N» и т.п.).
///
/// Unicode-глиф ♩ рендерится текстовым шрифтом непредсказуемо (кегль, базовая
/// линия, у части платформ — эмодзи) и выглядит слабее гравировки движка.
/// Здесь — вектор в тех же ИЗДАТЕЛЬСКИХ пропорциях, что метрономная метка
/// рендера (render/tempo.js): головка-эллипс с наклоном ~-21°, укороченный
/// штиль ~2.2 высоты головки справа. По схеме [MetronomeIcon].
///
/// [size] — ПОЛНАЯ высота ноты (головка + штиль). Цвет — из [color] либо
/// текущего [IconTheme]/темы, поэтому виджет корректен в чипах и кнопках.
class TempoNoteIcon extends StatelessWidget {
  final double size;
  final Color? color;

  const TempoNoteIcon({super.key, this.size = 18, this.color});

  @override
  Widget build(BuildContext context) {
    // Цвет — как у соседнего ТЕКСТА (нота стоит в строке «(нота) = N»), затем
    // иконочная/тематическая цепочка.
    final c = color ??
        DefaultTextStyle.of(context).style.color ??
        IconTheme.of(context).color ??
        Theme.of(context).colorScheme.onSurface;
    return SizedBox(
      // Пропорции гравировки: высота 27 ед. (головка 10 + штиль 22 с нахлёстом),
      // ширина — головка 11.9 + толщина штиля.
      width: size * (13.4 / 27.0),
      height: size,
      child: CustomPaint(painter: _TempoNotePainter(c)),
    );
  }
}

class _TempoNotePainter extends CustomPainter {
  final Color color;
  _TempoNotePainter(this.color);

  @override
  void paint(Canvas canvas, Size size) {
    final h = size.height;
    // Единицы гравировки: 27 ед. = полная высота ноты.
    final u = h / 27.0;
    final headH = 10.0 * u;   // высота головки = промежуток стана
    final headW = 11.9 * u;   // ширина головки (метрика noteheadBlack)
    final stemW = 1.6 * u;
    final fill = Paint()
      ..color = color
      ..style = PaintingStyle.fill
      ..isAntiAlias = true;

    // Головка: залитый эллипс с издательским наклоном (~-21°).
    final headCx = headW / 2;
    final headCy = h - headH / 2;
    canvas.save();
    canvas.translate(headCx, headCy);
    canvas.rotate(-21 * math.pi / 180);
    canvas.drawOval(
      Rect.fromCenter(
          center: Offset.zero, width: headW * 1.04, height: headH * 0.82),
      fill,
    );
    canvas.restore();

    // Штиль: у правого края головки, вверх до верха глифа (короткий,
    // метрономная пропорция — не 3.5 промежутка, как у нот стана).
    canvas.drawRect(
      Rect.fromLTRB(headW - stemW, 0, headW, headCy - 1.0 * u),
      fill,
    );
  }

  @override
  bool shouldRepaint(_TempoNotePainter old) => old.color != color;
}
