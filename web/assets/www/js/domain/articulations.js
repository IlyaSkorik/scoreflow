// [ScoreFlow engine] Articulations domain — ЕДИНСТВЕННОЕ место правил артикуляций
// (staccato/staccatissimo/accent/marcato/tenuto): и проекция в глиф VexFlow для
// рендера, и влияние на playback-событие. Артикуляция принадлежит НОТЕ (головке),
// а не такту; в playback она — ПОСЛЕДНИЙ выразительный слой ПОСЛЕ динамики и
// вилок: модифицирует уже разрешённое событие, не планирует звук сама.
//
// Расширяемо БЕЗ редизайна: fermata/breath/caesura — новые записи в
// ARTICULATION_SPEC (глиф + при необходимости playback-множители). Гуманизация
// (attack/release/timing) ляжет на те же поля события attack/release.
//
// Проекция в VexFlow: коды глифов артикуляций (VF.Articulation):
//   staccato 'a.'  staccatissimo 'av'  accent 'a>'  marcato 'a^'  tenuto 'a-'.

// Спецификация каждой артикуляции:
//   glyph    — код VexFlow (VF.Articulation) для рендера (экран/PDF, единый);
//   duration — множитель длительности события (staccato короче, tenuto чуть длиннее);
//   velocity — множитель громкости (accent/marcato громче, tenuto мягче);
//   attack   — множитель атаки (>1 жёстче, <1 мягче) — поле события для будущей
//              гуманизации; слышимую часть несут duration/velocity (см. компилятор).
// Значения-константы ЖИВУТ ЗДЕСЬ (не в компиляторе) — без дублирования расчётов.
export const ARTICULATION_SPEC = {
    staccato: { glyph: 'a.', duration: 0.50, velocity: 1.00, attack: 1.00 },
    staccatissimo: { glyph: 'av', duration: 0.30, velocity: 1.00, attack: 1.00 },
    accent: { glyph: 'a>', duration: 1.00, velocity: 1.25, attack: 1.15 },
    marcato: { glyph: 'a^', duration: 0.80, velocity: 1.35, attack: 1.20 },
    tenuto: { glyph: 'a-', duration: 1.02, velocity: 0.95, attack: 0.90 },
};

// Потолок громкости после артикуляционного буста (accent/marcato на ff не должны
// уходить в бесконечность; сэмплер и так клампит пик).
export const ARTICULATION_VELOCITY_MAX = 1.30;

// Известный id артикуляции или null (неизвестное/пустое). Зеркало Dart
// Articulation.fromId (там неизвестное -> null, отбрасывается).
export function parseArticulation(id) {
    return Object.prototype.hasOwnProperty.call(ARTICULATION_SPEC, id) ? id : null;
}

// Код глифа VexFlow для id артикуляции или null.
export function articulationGlyph(id) {
    const s = ARTICULATION_SPEC[id];
    return s ? s.glyph : null;
}

// СОСТАВНОЙ эффект списка артикуляций (несколько на одной ноте — staccato+accent
// и т.п. компонуются мультипликативно). Возвращает { duration, velocity, attack }.
export function articulationEffect(artIds) {
    let duration = 1, velocity = 1, attack = 1;
    if (artIds) {
        for (let i = 0; i < artIds.length; i++) {
            const s = ARTICULATION_SPEC[artIds[i]];
            if (!s) continue;
            duration *= s.duration;
            velocity *= s.velocity;
            attack *= s.attack;
        }
    }
    return { duration: duration, velocity: velocity, attack: attack };
}

// Применить составной эффект артикуляций к playback-событию (мутирует и
// возвращает его). ПОСЛЕДНИЙ выразительный слой: velocity уже разрешён динамикой
// и вилками, здесь домножается. durationBeats/velocity слышны через существующий
// scheduler (он их уже читает) — планировщик НЕ меняется. attack/release — поля
// события для будущей гуманизации (release отражает укорочение хвоста).
export function applyArticulations(event, artIds) {
    if (!artIds || !artIds.length) return event;
    const eff = articulationEffect(artIds);
    event.durationBeats *= eff.duration;
    let v = (event.velocity == null ? 1 : event.velocity) * eff.velocity;
    if (v > ARTICULATION_VELOCITY_MAX) v = ARTICULATION_VELOCITY_MAX;
    event.velocity = v;
    event.attack = (event.attack == null ? 1 : event.attack) * eff.attack;
    event.release = (event.release == null ? 1 : event.release) * eff.duration;
    return event;
}
