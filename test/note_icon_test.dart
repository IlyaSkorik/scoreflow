// NoteIcon — гравированные глифы палитры длительностей (вместо Unicode).
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:scoreflow/models/palette.dart';
import 'package:scoreflow/widgets/note_icon.dart';

void main() {
  testWidgets('NoteIcon renders every palette duration incl. dotted',
      (tester) async {
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: Row(
          children: [
            for (final d in durations.keys) NoteIcon(duration: d, size: 36),
            const NoteIcon(duration: 'q', dots: 1, size: 36),
            const NoteIcon(duration: 'h', dots: 2, size: 36),
          ],
        ),
      ),
    ));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    expect(find.byType(NoteIcon), findsNWidgets(durations.length + 2));
    // Единая система координат: у всех глифов одинаковый бокс — ряд палитры
    // выравнивается сам, головки на одном уровне.
    final sizes = tester
        .widgetList(find.byType(NoteIcon))
        .map((w) => tester.getSize(find.byWidget(w)))
        .toSet();
    expect(sizes.length, 1);
  });

  test('palette keeps every engine duration with a human name', () {
    expect(durations.keys.toList(), ['w', 'h', 'q', '8', '16', '32', '64']);
    expect(durations.keys.toSet(), durationFraction.keys.toSet());
    expect(durations.values.every((n) => n.isNotEmpty), isTrue);
  });
}
