#!/usr/bin/env node
/**
 * fetch_drums.mjs — одноразовая ПОДГОТОВКА СЭМПЛОВ ударной установки.
 *
 *     node tools/fetch_drums.mjs
 *
 * Скачивает готовые MP3 акустической установки в assets/www/drums/ по прямым
 * ссылкам (как fetch_salamander.mjs для рояля). Без ffmpeg, без архивов, без
 * ручного поиска. Приложение в рантайме остаётся полностью оффлайн.
 *
 * Источник — открытые демо-сэмплы Tone.js (MIT-проект):
 *   acoustic-kit: kick, snare, hihat (closed), tom1..tom3;
 *   berklee:      crash_1, crash_2 (живые тарелки).
 * Это single-velocity сэмплы (как и наш Salamander-набор для рояля) — динамика
 * по velocity делается громкостью/яркостью в звуковом движке.
 *
 * Недостающие партии (открытый/педальный хай-хэт, ride, ride bell) звучат через
 * синтез-fallback — приложение не ломается. Источник можно заменить флагом
 * --base= (если зеркалите файлы у себя с теми же именами).
 */

import { mkdir, writeFile, access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DRUMS_DIR = resolve(__dirname, '..', 'assets', 'www', 'drums');

const AC = 'https://tonejs.github.io/audio/drum-samples/acoustic-kit/';
const BK = 'https://tonejs.github.io/audio/berklee/';

// Необязательное переопределение источника: --base=URL (ожидаются те же имена,
// что и целевые файлы) или env DRUMS_BASE.
const argBase = (process.argv.find((a) => a.startsWith('--base=')) || '').slice(7);
const OVERRIDE = (argBase || process.env.DRUMS_BASE || '').replace(/\/?$/, m => m ? '/' : '');

// целевой файл в assets/www/drums/  ->  URL источника
const SOURCES = {
  'kick.mp3':         AC + 'kick.mp3',
  'snare.mp3':        AC + 'snare.mp3',
  'hihat_closed.mp3': AC + 'hihat.mp3',
  'tom_high.mp3':     AC + 'tom1.mp3',
  'tom_mid.mp3':      AC + 'tom2.mp3',
  'tom_floor.mp3':    AC + 'tom3.mp3',
  'crash1.mp3':       BK + 'crash_1.mp3',
  'crash2.mp3':       BK + 'crash_2.mp3',
};

async function exists(p) { try { await access(p); return true; } catch { return false; } }

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} для ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(dest, buf);
  return buf.length;
}

async function main() {
  await mkdir(DRUMS_DIR, { recursive: true });
  const targets = Object.keys(SOURCES);
  console.log(`Папка: ${DRUMS_DIR}\nФайлов: ${targets.length}` +
    (OVERRIDE ? `\nИсточник (override): ${OVERRIDE}` : '') + '\n');

  let ok = 0, skip = 0, total = 0;
  for (const name of targets) {
    const dest = join(DRUMS_DIR, name);
    if (await exists(dest)) { console.log(`= ${name} (уже есть)`); skip++; continue; }
    const url = OVERRIDE ? OVERRIDE + name : SOURCES[name];
    try {
      const bytes = await download(url, dest);
      total += bytes; ok++;
      console.log(`✓ ${name} (${(bytes / 1024).toFixed(0)} КБ)`);
    } catch (e) {
      console.error(`✗ ${name}: ${e.message}`);
    }
  }

  console.log(`\nГотово: скачано ${ok}, пропущено ${skip}, ` +
    `объём ${(total / 1048576).toFixed(2)} МБ`);
  console.log('Недостающие партии (hihat open/pedal, ride, ride bell) — синтез-fallback.');
  if (ok + skip < targets.length) {
    console.error('ВНИМАНИЕ: часть файлов не скачалась — проверьте сеть/источник.');
    process.exit(1);
  }
}

main().catch((e) => { console.error('Сбой:', e.message); process.exit(1); });
