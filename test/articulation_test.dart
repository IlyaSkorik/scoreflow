import 'package:flutter_test/flutter_test.dart';
import 'package:scoreflow/models/history.dart';
import 'package:scoreflow/models/reflow.dart';
import 'package:scoreflow/models/score.dart';

MusicNote note(String key, {List<Articulation>? art}) =>
    MusicNote.fromKeys(keys: [key], duration: 'q', articulations: art);

Score scoreWith(List<MusicNote> treble) => Score(
      id: 'a1',
      title: 'Articulations',
      instrument: InstrumentType.piano,
      measures: [
        Measure({'treble': treble, 'bass': <MusicNote>[]}),
      ],
      createdAt: DateTime(2026),
      updatedAt: DateTime(2026),
    );

void main() {
  group('Articulation model', () {
    test('ids round-trip; unknown -> null', () {
      expect(Articulation.fromId('staccato'), Articulation.staccato);
      expect(Articulation.fromId('marcato'), Articulation.marcato);
      expect(Articulation.fromId('tenuto'), Articulation.tenuto);
      expect(Articulation.fromId('bogus'), isNull);
      expect(Articulation.accent.id, 'accent');
    });
  });

  group('serialization', () {
    test('articulations serialize only when present and round-trip', () {
      final s = scoreWith([
        note('c/4', art: [Articulation.staccato]),
        note('d/4'),
      ]);
      expect(s.measures[0].voice('treble')[0].toJson()['art'], ['staccato']);
      expect(s.measures[0].voice('treble')[1].toJson().containsKey('art'), isFalse);
      final back = Score.decode(s.encode());
      expect(back.measures[0].voice('treble')[0].articulations, [Articulation.staccato]);
      expect(back.measures[0].voice('treble')[1].articulations, isEmpty);
      // Render-проекция несёт тот же список id.
      expect(back.measures[0].voice('treble')[0].toRenderJson()['art'], ['staccato']);
    });

    test('multiple articulations per note round-trip (readiness)', () {
      final s = scoreWith([
        note('c/4', art: [Articulation.staccato, Articulation.accent]),
      ]);
      final back = Score.decode(s.encode());
      expect(back.measures[0].voice('treble')[0].articulations,
          [Articulation.staccato, Articulation.accent]);
    });

    test('legacy note without art loads unchanged', () {
      const legacy = '{"id":"old","title":"Old","composer":"",'
          '"instrument":"piano","keySignature":"C",'
          '"timeSignature":{"beats":4,"beatValue":4},"tempo":120,'
          '"measures":[{"treble":[{"pitches":[{"step":"c","octave":4}],'
          '"duration":"q","rest":false}],"bass":[]}],'
          '"createdAt":"2026-01-01T00:00:00.000",'
          '"updatedAt":"2026-01-01T00:00:00.000"}';
      final s = Score.decode(legacy);
      expect(s.measures[0].voice('treble')[0].articulations, isEmpty);
    });

    test('unknown articulation id is dropped on load', () {
      const raw = '{"id":"x","title":"X","composer":"","instrument":"piano",'
          '"keySignature":"C","timeSignature":{"beats":4,"beatValue":4},'
          '"tempo":120,"measures":[{"treble":[{"pitches":[{"step":"c","octave":4}],'
          '"duration":"q","rest":false,"art":["staccato","bogus"]}],"bass":[]}],'
          '"createdAt":"2026-01-01T00:00:00.000",'
          '"updatedAt":"2026-01-01T00:00:00.000"}';
      final s = Score.decode(raw);
      expect(s.measures[0].voice('treble')[0].articulations, [Articulation.staccato]);
    });
  });

  group('copy and undo/redo', () {
    test('copy is deep and independent', () {
      final s = scoreWith([note('c/4', art: [Articulation.accent])]);
      final c = s.copy();
      expect(c.measures[0].voice('treble')[0].articulations, [Articulation.accent]);
      c.measures[0].voice('treble')[0].articulations.clear();
      expect(s.measures[0].voice('treble')[0].articulations, [Articulation.accent]);
    });

    test('undo restores previous articulations', () {
      final history = ScoreHistory();
      final s = scoreWith([note('c/4')]);
      history.record(EditorSnapshot(
          score: s.copy(), measure: 0, voice: 'treble', index: 0));
      s.measures[0].voice('treble')[0].articulations.add(Articulation.staccato);
      final restored = history.undo(EditorSnapshot(
          score: s.copy(), measure: 0, voice: 'treble', index: 0));
      expect(restored!.score.measures[0].voice('treble')[0].articulations, isEmpty);
      final redone = history.redo(EditorSnapshot(
          score: restored.score.copy(), measure: 0, voice: 'treble', index: 0));
      expect(redone!.score.measures[0].voice('treble')[0].articulations,
          [Articulation.staccato]);
    });
  });

  group('reflow preservation', () {
    test('articulations stay attached to the note across repacking', () {
      // Two 4/4 measures worth of notes with articulations; repack (packVoice).
      final notes = [
        note('c/4', art: [Articulation.staccato]),
        note('d/4'),
        note('e/4', art: [Articulation.accent, Articulation.tenuto]),
        note('f/4'),
        note('g/4', art: [Articulation.marcato]),
      ];
      // Repack into 2/4 measures (capacity 0.5 whole note = 2 quarters each).
      final bins = packVoice(notes, 0.5);
      final flat = [for (final b in bins) ...b];
      // Articulations travel with the note objects (identity preserved).
      expect(flat[0].articulations, [Articulation.staccato]);
      expect(flat[2].articulations, [Articulation.accent, Articulation.tenuto]);
      expect(flat[4].articulations, [Articulation.marcato]);
      expect(flat[1].articulations, isEmpty);
    });
  });
}
