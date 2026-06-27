// JS-тест алгоритма размещения оттенков (node, ESM). Запуск:
//   node test/js/dynamics_layout.test.mjs
// Чистая геометрия: одна базовая линия на (система+голос), под нотами, с
// потолком. Тот же алгоритм у экрана и PDF -> идентичные позиции.
import { dynamicsBaseline, DYN_GLYPH_SIZE } from '../../assets/www/js/render/dynamics_layout.js';

let failed = 0;
function eq(name, got, want) {
    if (got === want) { console.log('  ok   ' + name); }
    else { failed++; console.log('  FAIL ' + name + '  got=' + got + ' want=' + want); }
}
function ok(name, cond, extra) {
    if (cond) { console.log('  ok   ' + name); }
    else { failed++; console.log('  FAIL ' + name + (extra ? '  ' + extra : '')); }
}

console.log('constants:');
ok('glyph size sane', DYN_GLYPH_SIZE >= 24 && DYN_GLYPH_SIZE <= 40);

console.log('default baseline (no notation below staff):');
{
    // Ничего ниже стана -> ровный зазор под нижней линейкой (STAFF_GAP=16).
    eq('staff 100, no notes', dynamicsBaseline(100, []), 116);
    eq('staff 100, notes on/above staff', dynamicsBaseline(100, [80, 95, 100]), 116);
    // Согласованность: соседние группы с одинаковой нотацией -> одинаковая база
    // (отсутствие «прыжков»).
    eq('consistent for same inputs', dynamicsBaseline(100, [90]),
        dynamicsBaseline(100, [88]));
}

console.log('push below low notation (low notes / stems / ledger lines):');
{
    // Самый низкий низ bbox = 130 -> база 130+NOTE_CLEAR(11)=141 (> 116).
    eq('one low note pushes baseline down', dynamicsBaseline(100, [130]), 141);
    // База берёт САМЫЙ низкий элемент группы (плотный аккорд/добавочные линейки).
    eq('lowest of many wins', dynamicsBaseline(100, [105, 150, 120]), 161);
    ok('low notation lowers baseline vs default',
        dynamicsBaseline(100, [150]) > dynamicsBaseline(100, []));
}

console.log('ceiling cap (grand staff: do not invade the lower staff):');
{
    // Очень длинный штиль вниз (низ 300), но потолок (верх bass) = 180 ->
    // база не глубже 180 - CAP_MARGIN(6) = 174.
    eq('capped at maxBaseline - margin', dynamicsBaseline(100, [300], 180), 174);
    // Если до потолка далеко — cap не вмешивается.
    eq('cap not triggered when above it', dynamicsBaseline(100, [120], 180), 131);
}

console.log('monotonic in lowest notation (no jitter):');
{
    let prev = -1, mono = true;
    for (const low of [90, 110, 130, 150, 170]) {
        const y = dynamicsBaseline(100, [low]);
        if (y < prev) mono = false;
        prev = y;
    }
    ok('baseline never decreases as notation goes lower', mono);
}

if (failed > 0) {
    console.log('\n' + failed + ' assertion(s) FAILED');
    process.exit(1);
} else {
    console.log('\nAll JS dynamics-layout tests passed.');
}
