// Генератор демо-партитур в ФОРМАТЕ ХРАНИЛИЩА приложения (ScoreRepository):
// оборачивает render-фикстуры (fixtures/*.json) в persistence-схему Score
// (id + даты + timeSignature объектом; ноты в legacy-виде `keys` приложение
// мигрирует в Pitch при загрузке). Файлы кладутся на устройство в
// `<app documents>/scoreflow/scores/<id>.json` (см. push_test_scores.bat).
// Запуск: node test/print/gen_fixtures.mjs && node test/print/gen_device_scores.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'device_scores');
mkdirSync(OUT, { recursive: true });

// Имя файла ДОЛЖНО совпадать с id: репозиторий сохраняет/грузит по `<id>.json`.
const SCORES = [
    { id: 'demo-sonata-fantasia', fixture: 'piano_full', updated: '2026-07-02T12:00:00.000' },
    { id: 'demo-drum-etude', fixture: 'drums', updated: '2026-07-02T11:00:00.000' },
    { id: 'demo-mixed-meters', fixture: 'dense', updated: '2026-07-02T10:00:00.000' },
];

function parseTs(vex) {
    const p = String(vex || '4/4').split('/');
    return { beats: Number(p[0]) || 4, beatValue: Number(p[1]) || 4 };
}

for (const s of SCORES) {
    const fx = JSON.parse(readFileSync(join(HERE, 'fixtures', s.fixture + '.json'), 'utf8'));
    const score = {
        id: s.id,
        title: fx.title || s.id,
        composer: fx.composer || '',
        instrument: fx.instrument || 'piano',
        keySignature: fx.keySignature || 'C',
        timeSignature: parseTs(fx.timeSignature),
        tempo: fx.tempo || 120,
        measures: fx.measures,
        createdAt: '2026-07-01T09:00:00.000',
        updatedAt: s.updated,
    };
    const path = join(OUT, s.id + '.json');
    writeFileSync(path, JSON.stringify(score, null, 1));
    console.log(`${path}: "${score.title}", ${score.measures.length} тактов`);
}
