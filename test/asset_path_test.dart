// Временная проверка: резолвит ли rootBundle путь с префиксом './'
// (так его формирует InAppLocalhostServer при documentRoot='./').
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('rootBundle resolves dot-slash prefixed asset path', () async {
    final html = await rootBundle.loadString('./assets/www/index.html');
    expect(html.contains('ScoreFlow'), true);
  });

  test('vexflow asset is present', () async {
    final js = await rootBundle.loadString('./assets/www/js/vexflow.js');
    expect(js.contains('VexFlow'), true);
  });
}
