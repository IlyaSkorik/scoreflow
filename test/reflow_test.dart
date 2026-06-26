import 'package:flutter_test/flutter_test.dart';
import 'package:scoreflow/models/reflow.dart';
import 'package:scoreflow/models/score.dart';

MusicNote n(String dur, {bool rest = false}) =>
    MusicNote.fromKeys(keys: rest ? const [] : const ['c/4'], duration: dur, rest: rest);

void main() {
  const cap = 1.0; // 4/4

  test('четыре четверти = один такт', () {
    final bins = packVoice([n('q'), n('q'), n('q'), n('q')], cap);
    expect(bins.length, 1);
    expect(bins.first.length, 4);
  });

  test('пять четвертей переносят пятую в новый такт', () {
    final bins = packVoice([n('q'), n('q'), n('q'), n('q'), n('q')], cap);
    expect(bins.length, 2);
    expect(bins[0].length, 4);
    expect(bins[1].length, 1);
  });

  test('смесь нот и пауз соблюдает размер', () {
    // q + qr + q + qr = 4 доли -> один такт; следующая q -> новый такт
    final bins = packVoice(
      [n('q'), n('q', rest: true), n('q'), n('q', rest: true), n('q')],
      cap,
    );
    expect(bins.length, 2);
    expect(bins[0].length, 4);
    expect(bins[1].length, 1);
  });

  test('половинная + целая пауза не влезают в один такт', () {
    final bins = packVoice([n('h'), n('w', rest: true)], cap);
    expect(bins.length, 2);
  });

  test('пустой вход даёт одну пустую корзину', () {
    final bins = packVoice([], cap);
    expect(bins.length, 1);
    expect(bins.first, isEmpty);
  });

  test('3/4: три четверти = такт, четвёртая переносится', () {
    final bins = packVoice([n('q'), n('q'), n('q'), n('q')], 0.75);
    expect(bins.length, 2);
    expect(bins[0].length, 3);
    expect(bins[1].length, 1);
  });
}
