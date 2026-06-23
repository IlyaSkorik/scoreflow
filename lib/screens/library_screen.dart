import 'package:flutter/material.dart';
import 'package:uuid/uuid.dart';

import '../data/score_repository.dart';
import '../models/score.dart';
import 'editor_screen.dart';

/// «Кабинет» — локальная библиотека партитур: список, создание, удаление.
class LibraryScreen extends StatefulWidget {
  final ScoreRepository repository;
  const LibraryScreen({super.key, required this.repository});

  @override
  State<LibraryScreen> createState() => _LibraryScreenState();
}

class _LibraryScreenState extends State<LibraryScreen> {
  late Future<List<Score>> _future;

  @override
  void initState() {
    super.initState();
    _reload();
  }

  void _reload() {
    setState(() {
      _future = widget.repository.listAll();
    });
  }

  Future<void> _openEditor(Score score) async {
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => EditorScreen(
          scoreId: score.id,
          repository: widget.repository,
        ),
      ),
    );
    _reload(); // обновляем список (мог измениться заголовок/дата)
  }

  Future<void> _createScore() async {
    final result = await showDialog<_NewScoreSpec>(
      context: context,
      builder: (_) => const _NewScoreDialog(),
    );
    if (result == null) return;

    final score = Score.create(
      id: const Uuid().v4(),
      title: result.title,
      instrument: result.instrument,
      now: DateTime.now(),
    );
    await widget.repository.save(score);
    if (mounted) await _openEditor(score);
  }

  Future<void> _confirmDelete(Score score) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Удалить партитуру?'),
        content: Text('«${score.title}» будет удалена безвозвратно.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Отмена'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Удалить'),
          ),
        ],
      ),
    );
    if (ok == true) {
      await widget.repository.delete(score.id);
      _reload();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('ScoreFlow · Библиотека')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _createScore,
        icon: const Icon(Icons.add),
        label: const Text('Новая'),
      ),
      body: FutureBuilder<List<Score>>(
        future: _future,
        builder: (context, snap) {
          if (snap.connectionState != ConnectionState.done) {
            return const Center(child: CircularProgressIndicator());
          }
          final scores = snap.data ?? const <Score>[];
          if (scores.isEmpty) return const _EmptyState();
          return RefreshIndicator(
            onRefresh: () async => _reload(),
            child: ListView.separated(
              padding: const EdgeInsets.fromLTRB(12, 12, 12, 96),
              itemCount: scores.length,
              separatorBuilder: (_, __) => const SizedBox(height: 8),
              itemBuilder: (_, i) => _ScoreCard(
                score: scores[i],
                onOpen: () => _openEditor(scores[i]),
                onDelete: () => _confirmDelete(scores[i]),
              ),
            ),
          );
        },
      ),
    );
  }
}

class _ScoreCard extends StatelessWidget {
  final Score score;
  final VoidCallback onOpen;
  final VoidCallback onDelete;
  const _ScoreCard({
    required this.score,
    required this.onOpen,
    required this.onDelete,
  });

  @override
  Widget build(BuildContext context) {
    final isDrums = score.instrument == InstrumentType.drums;
    return Card(
      clipBehavior: Clip.antiAlias,
      child: ListTile(
        leading: CircleAvatar(
          child: Icon(isDrums ? Icons.album : Icons.piano),
        ),
        title: Text(
          score.title,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(fontWeight: FontWeight.w600),
        ),
        subtitle: Text(
          '${score.instrument.label} · ${score.timeSignature.vex} · '
          '${score.measures.length} тактов',
        ),
        trailing: IconButton(
          icon: const Icon(Icons.delete_outline),
          onPressed: onDelete,
        ),
        onTap: onOpen,
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState();
  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.library_music_outlined,
              size: 64, color: Theme.of(context).colorScheme.outline),
          const SizedBox(height: 16),
          const Text('Пока нет партитур'),
          const SizedBox(height: 4),
          Text('Нажмите «Новая», чтобы создать первую',
              style: Theme.of(context).textTheme.bodySmall),
        ],
      ),
    );
  }
}

/// Результат диалога создания партитуры.
class _NewScoreSpec {
  final String title;
  final InstrumentType instrument;
  _NewScoreSpec(this.title, this.instrument);
}

class _NewScoreDialog extends StatefulWidget {
  const _NewScoreDialog();
  @override
  State<_NewScoreDialog> createState() => _NewScoreDialogState();
}

class _NewScoreDialogState extends State<_NewScoreDialog> {
  final _titleCtrl = TextEditingController();
  InstrumentType _instrument = InstrumentType.piano;

  @override
  void dispose() {
    _titleCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Новая партитура'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          TextField(
            controller: _titleCtrl,
            autofocus: true,
            decoration: const InputDecoration(
              labelText: 'Название',
              hintText: 'Например: Этюд №1',
            ),
          ),
          const SizedBox(height: 16),
          SegmentedButton<InstrumentType>(
            segments: const [
              ButtonSegment(
                value: InstrumentType.piano,
                label: Text('Клавишные'),
                icon: Icon(Icons.piano),
              ),
              ButtonSegment(
                value: InstrumentType.drums,
                label: Text('Ударные'),
                icon: Icon(Icons.album),
              ),
            ],
            selected: {_instrument},
            onSelectionChanged: (s) => setState(() => _instrument = s.first),
          ),
        ],
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Отмена'),
        ),
        FilledButton(
          onPressed: () => Navigator.pop(
            context,
            _NewScoreSpec(_titleCtrl.text, _instrument),
          ),
          child: const Text('Создать'),
        ),
      ],
    );
  }
}
