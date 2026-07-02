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
            for (final d in durations.keys) NoteIcon(duration: d, size: 23),
            const NoteIcon(duration: 'q', dots: 1, size: 23),
            const NoteIcon(duration: 'h', dots: 2, size: 23),
          ],
        ),
      ),
    ));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    expect(find.byType(NoteIcon), findsNWidgets(durations.length + 2));
    // Бокс — тесный по чернилам (Center честно центрирует): целая ниже
    // четвертной (нет штиля), восьмая шире (флажок), 64-я выше восьмой
    // (стопка флажков), точка расширяет бокс.
    Size sizeOf(String d, [int dots = 0]) {
      final w = tester
          .widgetList<NoteIcon>(find.byType(NoteIcon))
          .firstWhere((n) => n.duration == d && n.dots == dots);
      return tester.getSize(find.byWidget(w));
    }

    expect(sizeOf('q').height, 23);
    expect(sizeOf('w').height, lessThan(sizeOf('q').height));
    expect(sizeOf('8').width, greaterThan(sizeOf('q').width));
    expect(sizeOf('64').height, greaterThan(sizeOf('8').height));
    expect(sizeOf('q', 1).width, greaterThan(sizeOf('q').width));
  });

  test('palette keeps every engine duration with a human name', () {
    expect(durations.keys.toList(), ['w', 'h', 'q', '8', '16', '32', '64']);
    expect(durations.keys.toSet(), durationFraction.keys.toSet());
    expect(durations.values.every((n) => n.isNotEmpty), isTrue);
  });
}
