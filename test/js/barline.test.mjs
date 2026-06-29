// JS-тест профессиональной системы тактовых черт (node, ESM). Запуск:
//   node test/js/barline.test.mjs
// Разрешение типа черты КАЖДОГО такта и проекция на гравировку (нативный тип
// VexFlow vs кастартная отрисовка) — в ОДНОМ месте (domain/barlines). Здесь
// проверяем: нормализацию id, действующие черты по тактам (чтение `_bar`),
// спецификацию native/custom каждого типа, маппинг на нативный тип VexFlow и
// инвариант раскладки невидимой черты (NONE — место сохраняется, линии нет).
// Сама ОТРИСОВКА (dashed/dotted/tick/short, PDF parity) проверяется визуально/
// в рендере: VexFlow и DOM в node недоступны (как в остальных JS-тестах).
import {
    BARLINE_SPEC,
    parseBarline,
    barlineSpec,
    isNativeBarline,
    effectiveBarlines,
    nativeBarType,
} from '../../assets/www/js/domain/barlines.js';
import {
    setupBarline,
    setupGrandBarline,
    drawGrandBarline,
} from '../../assets/www/js/render/barlines.js';

let failed = 0;
function eq(name, got, want) {
    const g = JSON.stringify(got);
    const w = JSON.stringify(want);
    if (g === w) {
        console.log('  ok   ' + name);
    } else {
        failed++;
        console.log('  FAIL ' + name + '  got=' + g + ' want=' + w);
    }
}

// Минимальный фейк VexFlow: Barline.type с нативными именами + Stave-заглушка,
// записывающая, какой тип ей назначили (проверяем выбор native vs NONE).
const FAKE_VF = {
    Barline: {
        type: {
            SINGLE: 1, DOUBLE: 2, END: 3,
            REPEAT_BEGIN: 4, REPEAT_END: 5, REPEAT_BOTH: 6, NONE: 7,
        },
    },
};
function fakeStave() {
    return { _end: undefined, setEndBarType(t) { this._end = t; } };
}

// Минимальный no-op 2D-контекст (кастартная отрисовка не должна падать в node).
function fakeCtx() {
    const noop = () => { };
    return {
        save: noop, restore: noop, beginPath: noop, moveTo: noop, lineTo: noop,
        stroke: noop, fill: noop, setLineWidth: noop, setStrokeStyle: noop,
        setFillStyle: noop, setLineDash: noop, setLineCap: noop,
    };
}

console.log('parseBarline — normalization:');
eq('known passes through', parseBarline('final'), 'final');
eq('unknown -> normal', parseBarline('nope'), 'normal');
eq('null -> normal', parseBarline(null), 'normal');
eq('undefined -> normal', parseBarline(undefined), 'normal');

console.log('BARLINE_SPEC — all eight types present:');
eq('type ids', Object.keys(BARLINE_SPEC).sort(),
    ['dashed', 'dotted', 'double', 'final', 'invisible', 'normal', 'short', 'tick']);

console.log('barlineSpec — native vs custom projection:');
eq('normal -> native SINGLE', barlineSpec('normal'), { native: 'SINGLE', custom: null });
eq('double -> native DOUBLE', barlineSpec('double'), { native: 'DOUBLE', custom: null });
eq('final -> native END', barlineSpec('final'), { native: 'END', custom: null });
eq('invisible -> native NONE', barlineSpec('invisible'), { native: 'NONE', custom: null });
eq('dashed -> custom', barlineSpec('dashed'), { native: null, custom: 'dashed' });
eq('dotted -> custom', barlineSpec('dotted'), { native: null, custom: 'dotted' });
eq('tick -> custom', barlineSpec('tick'), { native: null, custom: 'tick' });
eq('short -> custom', barlineSpec('short'), { native: null, custom: 'short' });

console.log('isNativeBarline — split native/custom:');
eq('native set', ['normal', 'double', 'final', 'invisible'].map(isNativeBarline),
    [true, true, true, true]);
eq('custom set', ['dashed', 'dotted', 'tick', 'short'].map(isNativeBarline),
    [false, false, false, false]);

console.log('effectiveBarlines — reads _bar per measure (no carry-forward):');
eq('per-measure, default normal',
    effectiveBarlines([{ _bar: 'final' }, {}, { _bar: 'dashed' }, { _bar: 'bogus' }]),
    ['final', 'normal', 'dashed', 'normal']);
eq('empty score -> []', effectiveBarlines([]), []);
eq('does NOT carry forward (unlike key/ts)',
    effectiveBarlines([{ _bar: 'double' }, {}]), ['double', 'normal']);

console.log('nativeBarType — maps id to VexFlow Barline.type constant:');
eq('normal -> SINGLE(1)', nativeBarType(FAKE_VF, 'normal'), 1);
eq('double -> DOUBLE(2)', nativeBarType(FAKE_VF, 'double'), 2);
eq('final -> END(3)', nativeBarType(FAKE_VF, 'final'), 3);
eq('invisible -> NONE(7)', nativeBarType(FAKE_VF, 'invisible'), 7);
eq('dashed (custom) -> null', nativeBarType(FAKE_VF, 'dashed'), null);

console.log('setupBarline — native type on stave, NONE for custom/invisible:');
{
    const s = fakeStave();
    setupBarline(FAKE_VF, s, 'final');
    eq('final stave end = END(3)', s._end, 3);
}
{
    const s = fakeStave();
    setupBarline(FAKE_VF, s, 'double');
    eq('double stave end = DOUBLE(2)', s._end, 2);
}
{
    // Невидимая = нативный NONE: место сохраняется (ширину задаёт layout),
    // линия не рисуется.
    const s = fakeStave();
    setupBarline(FAKE_VF, s, 'invisible');
    eq('invisible stave end = NONE(7)', s._end, 7);
}
{
    // Кастартные типы: на стан ставится NONE (VexFlow не рисует линию — рисуем
    // сами в drawCustomBarline поверх стана).
    for (const id of ['dashed', 'dotted', 'tick', 'short']) {
        const s = fakeStave();
        setupBarline(FAKE_VF, s, id);
        eq(id + ' stave end = NONE(7) (custom drawn separately)', s._end, 7);
    }
}

console.log('grand staff (accolade) — one spanning barline, not per-stave:');
{
    // Фейк StaveConnector: записывает выбранный тип; фейк стана отдаёт геометрию.
    let lastConn = null;
    const VF2 = {
        Barline: { type: { NONE: 7 } },
        StaveConnector: function () {
            return {
                setType(t) { lastConn = t; return this; },
                setContext() { return this; },
                draw() { },
            };
        },
    };
    VF2.StaveConnector.type =
        { SINGLE_RIGHT: 0, THIN_DOUBLE: 7, BOLD_DOUBLE_RIGHT: 6 };
    const grandStave = () => ({
        _end: undefined,
        setEndBarType(t) { this._end = t; },
        getX() { return 0; },
        getWidth() { return 100; },
        getYForLine(n) { return n * 10; },
    });

    // setupGrandBarline гасит ОБЕ правые черты (спан рисуем сами).
    const t = grandStave(), b = grandStave();
    setupGrandBarline(VF2, t, b);
    eq('treble end = NONE', t._end, 7);
    eq('bass end = NONE', b._end, 7);

    // drawGrandBarline выбирает правый коннектор по типу (одна линия через
    // всю аколаду, не две на каждом стане).
    lastConn = null; drawGrandBarline(VF2, null, t, b, 'normal');
    eq('normal -> SINGLE_RIGHT', lastConn, 0);
    lastConn = null; drawGrandBarline(VF2, null, t, b, 'double');
    eq('double -> THIN_DOUBLE', lastConn, 7);
    lastConn = null; drawGrandBarline(VF2, null, t, b, 'final');
    eq('final -> BOLD_DOUBLE_RIGHT', lastConn, 6);
    lastConn = null; drawGrandBarline(VF2, null, t, b, 'invisible');
    eq('invisible -> no connector', lastConn, null);
    // Кастартные (dashed/dotted/tick/short) не используют коннектор —
    // рисуются своей линией (ctx тут не вызывается, коннектор не трогается).
    lastConn = null; drawGrandBarline(VF2, fakeCtx(), t, b, 'dashed');
    eq('dashed -> custom (no connector)', lastConn, null);
}

console.log('extensibility — repeat types are native (future Repeat System):');
// Документируем контракт: добавить репризы = одна строка в BARLINE_SPEC,
// маппинг на уже существующие нативные типы VexFlow REPEAT_*.
eq('VexFlow exposes REPEAT_* natively',
    [FAKE_VF.Barline.type.REPEAT_BEGIN, FAKE_VF.Barline.type.REPEAT_END,
     FAKE_VF.Barline.type.REPEAT_BOTH],
    [4, 5, 6]);

if (failed > 0) {
    console.log('\n' + failed + ' assertion(s) FAILED');
    process.exit(1);
} else {
    console.log('\nAll JS barline tests passed.');
}
