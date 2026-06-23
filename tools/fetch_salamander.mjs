#!/usr/bin/env node
/**
 * fetch_salamander.mjs — одноразовая ПОДГОТОВКА СЭМПЛОВ концертного рояля.
 *
 * Скачивает опорные сэмплы Salamander Grand Piano (Yamaha C5, CC-BY 3.0)
 * в assets/www/piano/ согласно manifest.json. Запускается ОДИН РАЗ на машине
 * разработчика при наличии сети:
 *
 *     node tools/fetch_salamander.mjs
 *
 * После этого приложение работает полностью оффлайн — сэмплы попадают в bundle
 * и раздаются локальным сервером WebView. В рантайме сетевых запросов нет.
 *
 * Источник по умолчанию — публичный набор Salamander (single-velocity, mp3),
 * тот же, что использует Tone.js. Переопределяется переменной окружения:
 *     SALAMANDER_BASE=https://example.com/piano/ node tools/fetch_salamander.mjs
 *
 * MULTI-VELOCITY: добавьте в manifest.json зоны с полями loVel/hiVel и
 * соответствующими файлами (напр. A4_v1.mp3 / A4_v2.mp3 / A4_v3.mp3), затем
 * запустите скрипт повторно — он скачает всё, что перечислено в манифесте.
 * Качество звучания важнее размера: больше слоёв = реалистичнее динамика.
 */

import { readFile, mkdir, writeFile, access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PIANO_DIR = resolve(__dirname, '..', 'assets', 'www', 'piano');
const MANIFEST = join(PIANO_DIR, 'manifest.json');

// База-источник сэмплов: флаг --base=URL (кроссплатформенно) или env
// SALAMANDER_BASE; по умолчанию — публичный набор Salamander. Завершается '/'.
const argBase = (process.argv.find((a) => a.startsWith('--base=')) || '').slice(7);
const BASE = (argBase || process.env.SALAMANDER_BASE
  || 'https://tonejs.github.io/audio/salamander/').replace(/\/?$/, '/');

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} для ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(dest, buf);
  return buf.length;
}

async function main() {
  const manifest = JSON.parse(await readFile(MANIFEST, 'utf8'));
  const files = [];
  for (const z of manifest.zones || []) {
    if (z.file) files.push(z.file);
    if (z.release) files.push(z.release); // release-сэмплы, если заданы
  }
  const unique = [...new Set(files)];

  await mkdir(PIANO_DIR, { recursive: true });
  console.log(`Источник: ${BASE}`);
  console.log(`Файлов в манифесте: ${unique.length}\n`);

  let ok = 0, skip = 0, total = 0;
  for (const f of unique) {
    const dest = join(PIANO_DIR, f);
    if (await exists(dest)) { console.log(`= ${f} (уже есть)`); skip++; continue; }
    try {
      const bytes = await download(BASE + f, dest);
      total += bytes;
      ok++;
      console.log(`✓ ${f} (${(bytes / 1024).toFixed(0)} КБ)`);
    } catch (e) {
      console.error(`✗ ${f}: ${e.message}`);
    }
  }

  console.log(`\nГотово: скачано ${ok}, пропущено ${skip}, ` +
    `объём ${(total / 1048576).toFixed(1)} МБ`);
  if (ok + skip < unique.length) {
    console.error('ВНИМАНИЕ: часть файлов не скачалась — проверьте источник/сеть.');
    process.exit(1);
  }
}

main().catch((e) => { console.error('Сбой:', e.message); process.exit(1); });
