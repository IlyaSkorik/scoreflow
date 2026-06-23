import 'palette.dart';
import 'score.dart';

/// Раскладывает поток нот одного голоса по тактам так, чтобы сумма
/// длительностей в каждом такте не превышала [capacity] (доля от целой ноты).
///
/// Ноты не расщепляются: если очередная нота не влезает в текущий такт, она
/// целиком переносится в следующий. Нота, чья длительность сама по себе больше
/// размера такта (редкий край), занимает отдельный такт. Всегда возвращает
/// минимум одну (возможно пустую) корзину.
List<List<MusicNote>> packVoice(List<MusicNote> notes, double capacity) {
  final bins = <List<MusicNote>>[];
  var current = <MusicNote>[];
  var sum = 0.0;

  for (final n in notes) {
    final f = durationFraction[n.duration] ?? 0;
    if (current.isNotEmpty && sum + f > capacity + 1e-6) {
      bins.add(current);
      current = <MusicNote>[];
      sum = 0;
    }
    current.add(n);
    sum += f;
  }
  if (current.isNotEmpty || bins.isEmpty) bins.add(current);
  return bins;
}
