// TempoNoteIcon — гравированная четвертная в чипе темпа нижней панели.
// Регресс: CustomPaint не имеет baseline, поэтому иконка в строке «(нота) = N»
// живёт через Transform.translate, а НЕ Baseline (тот роняет layout чипа).
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:scoreflow/widgets/tempo_note_icon.dart';

void main() {
  testWidgets('TempoNoteIcon lays out inside a tempo chip', (tester) async {
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: Center(
          child: ActionChip(
            visualDensity: VisualDensity.compact,
            label: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Transform.translate(
                  offset: const Offset(0, -2),
                  child: const TempoNoteIcon(size: 18),
                ),
                const Text(' = 120'),
              ],
            ),
            onPressed: () {},
          ),
        ),
      ),
    ));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    expect(find.byType(TempoNoteIcon), findsOneWidget);
    expect(find.text(' = 120'), findsOneWidget);
    // Пропорции гравировки: узкий вертикальный глиф (головка + штиль).
    final box = tester.getSize(find.byType(TempoNoteIcon));
    expect(box.height, 18);
    expect(box.width, lessThan(box.height));
  });
}
