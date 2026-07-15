#!/usr/bin/env node
/**
 * fetch_audio_assets.mjs — reproducible offline audio asset pipeline.
 *
 * Reads piano/drums manifests, downloads every listed sample, verifies
 * integrity when checksums are available, and exits non-zero on failure.
 *
 *   npm run fetch-audio
 *   node tools/fetch_audio_assets.mjs
 *
 * Environment overrides (optional):
 *   SALAMANDER_BASE  — piano sample CDN prefix (default: Tone.js Salamander)
 *   DRUMS_BASE       — drums override prefix (same target filenames)
 *
 * Flags:
 *   --base-piano=URL
 *   --base-drums=URL
 *   --force          re-download even when file exists
 *   --no-verify      skip checksum verification on cache hits
 *   --write-checksums  regenerate tools/audio_checksums.json from local files
 */

import {
  access,
  mkdir,
  readFile,
  stat,
  writeFile,
} from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const PIANO_DIR = join(ROOT, 'assets', 'www', 'piano');
const DRUMS_DIR = join(ROOT, 'assets', 'www', 'drums');
const PIANO_MANIFEST = join(PIANO_DIR, 'manifest.json');
const DRUMS_MANIFEST = join(DRUMS_DIR, 'manifest.json');
const CHECKSUMS_PATH = join(__dirname, 'audio_checksums.json');

const AC = 'https://tonejs.github.io/audio/drum-samples/acoustic-kit/';
const BK = 'https://tonejs.github.io/audio/berklee/';

const DRUM_SOURCES = {
  'kick.mp3': AC + 'kick.mp3',
  'snare.mp3': AC + 'snare.mp3',
  'hihat_closed.mp3': AC + 'hihat.mp3',
  'tom_high.mp3': AC + 'tom1.mp3',
  'tom_mid.mp3': AC + 'tom2.mp3',
  'tom_floor.mp3': AC + 'tom3.mp3',
  'crash1.mp3': BK + 'crash_1.mp3',
  'crash2.mp3': BK + 'crash_2.mp3',
};

const MIN_BYTES = 512;

const argv = process.argv.slice(2);
const FORCE = argv.includes('--force');
const NO_VERIFY = argv.includes('--no-verify');
const WRITE_CHECKSUMS = argv.includes('--write-checksums');
const argPiano = (argv.find((a) => a.startsWith('--base-piano=')) || '').slice(13);
const argDrums = (argv.find((a) => a.startsWith('--base-drums=')) || '').slice(12);

const PIANO_BASE = (argPiano || process.env.SALAMANDER_BASE
  || 'https://tonejs.github.io/audio/salamander/').replace(/\/?$/, '/');

const DRUMS_OVERRIDE = (argDrums || process.env.DRUMS_BASE || '')
  .replace(/\/?$/, (m) => (m ? '/' : ''));

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function sha256File(path) {
  const buf = await readFile(path);
  return createHash('sha256').update(buf).digest('hex');
}

async function loadChecksums() {
  try {
    const raw = await readFile(CHECKSUMS_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return { piano: {}, drums: {} };
  }
}

function expectedFor(checksums, group, file, manifestMeta) {
  const fromManifest = {};
  if (manifestMeta?.size != null) fromManifest.size = manifestMeta.size;
  if (manifestMeta?.sha256) fromManifest.sha256 = manifestMeta.sha256;
  const fromFile = checksums[group]?.[file] || {};
  return { ...fromFile, ...fromManifest };
}

async function verifyLocal(path, expected) {
  const info = await stat(path);
  if (info.size < MIN_BYTES) {
    return { ok: false, reason: `too small (${info.size} B)` };
  }
  if (expected.size != null && info.size !== expected.size) {
    return {
      ok: false,
      reason: `size mismatch (local ${info.size}, expected ${expected.size})`,
    };
  }
  if (expected.sha256) {
    const hash = await sha256File(path);
    if (hash !== expected.sha256) {
      return { ok: false, reason: `sha256 mismatch` };
    }
  }
  return { ok: true, size: info.size };
}

async function download(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < MIN_BYTES) {
    throw new Error(`response too small (${buf.length} B)`);
  }
  return buf;
}

function verifyDownloaded(buf, expected, name) {
  if (expected.size != null && buf.length !== expected.size) {
    throw new Error(
      `${name}: downloaded ${buf.length} B, expected ${expected.size} B`,
    );
  }
  if (expected.sha256) {
    const hash = createHash('sha256').update(buf).digest('hex');
    if (hash !== expected.sha256) {
      throw new Error(`${name}: sha256 mismatch after download`);
    }
  }
}

async function ensureWebLink() {
  const webAssets = join(ROOT, 'web', 'assets');
  const link = join(webAssets, 'www');
  const target = resolve(ROOT, 'assets', 'www');
  await mkdir(webAssets, { recursive: true });
  if (await exists(link)) return;
  const { symlink } = await import('node:fs/promises');
  try {
    await symlink(target, link, 'dir');
    console.log(`Linked web/assets/www -> assets/www`);
  } catch (e) {
    console.warn(`Note: could not create web/assets/www symlink: ${e.message}`);
  }
}

function collectPianoAssets(manifest, checksums) {
  const items = [];
  for (const zone of manifest.zones || []) {
    if (!zone.file) continue;
    items.push({
      group: 'piano',
      file: zone.file,
      dest: join(PIANO_DIR, zone.file),
      url: PIANO_BASE + zone.file,
      expected: expectedFor(checksums, 'piano', zone.file, zone),
    });
  }
  return items;
}

function collectDrumAssets(manifest, checksums) {
  const items = [];
  const instruments = manifest.instruments || {};
  for (const def of Object.values(instruments)) {
    for (const layer of def.layers || []) {
      if (!layer.file) continue;
      const file = layer.file;
      const url = DRUMS_OVERRIDE
        ? DRUMS_OVERRIDE + file
        : DRUM_SOURCES[file];
      if (!url) {
        throw new Error(`No download URL mapped for drums/${file}`);
      }
      items.push({
        group: 'drums',
        file,
        dest: join(DRUMS_DIR, file),
        url,
        expected: expectedFor(checksums, 'drums', file, layer),
      });
    }
  }
  return items;
}

async function processAsset(item, stats) {
  const label = `${item.group}/${item.file}`;
  const { dest, url, expected } = item;

  if (!FORCE && (await exists(dest))) {
    if (!NO_VERIFY) {
      try {
        const check = await verifyLocal(dest, expected);
        if (check.ok) {
          console.log(`= ${label} (cached, ${(check.size / 1024).toFixed(0)} KB)`);
          stats.skipped++;
          return;
        }
        console.log(`! ${label} (invalid cache: ${check.reason}, re-downloading)`);
      } catch (e) {
        console.log(`! ${label} (cache unreadable: ${e.message}, re-downloading)`);
      }
    } else {
      console.log(`= ${label} (cached, verify skipped)`);
      stats.skipped++;
      return;
    }
  }

  try {
    console.log(`↓ ${label} <- ${url}`);
    const buf = await download(url);
    verifyDownloaded(buf, expected, label);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, buf);
    stats.downloaded++;
    stats.bytes += buf.length;
    console.log(`✓ ${label} (${(buf.length / 1024).toFixed(0)} KB)`);
  } catch (e) {
    stats.failed.push({ label, error: e.message });
    console.error(`✗ ${label}: ${e.message}`);
  }
}

async function assertAllPresent(items) {
  const missing = [];
  for (const item of items) {
    if (!(await exists(item.dest))) missing.push(`${item.group}/${item.file}`);
  }
  return missing;
}

async function writeChecksumsFile(items) {
  const data = {
    _comment:
      'Known-good sizes and SHA-256 for offline audio samples. '
      + 'Used by tools/fetch_audio_assets.mjs.',
    piano: {},
    drums: {},
  };
  for (const item of items) {
    if (!(await exists(item.dest))) continue;
    const hash = await sha256File(item.dest);
    const info = await stat(item.dest);
    data[item.group][item.file] = { size: info.size, sha256: hash };
  }
  await writeFile(CHECKSUMS_PATH, `${JSON.stringify(data, null, 2)}\n`);
  console.log(`Wrote ${CHECKSUMS_PATH}`);
}

async function main() {
  const checksums = await loadChecksums();
  const pianoManifest = JSON.parse(await readFile(PIANO_MANIFEST, 'utf8'));
  const drumsManifest = JSON.parse(await readFile(DRUMS_MANIFEST, 'utf8'));

  const items = [
    ...collectPianoAssets(pianoManifest, checksums),
    ...collectDrumAssets(drumsManifest, checksums),
  ];

  // Deduplicate (same file referenced once).
  const seen = new Set();
  const unique = items.filter((item) => {
    const key = `${item.group}/${item.file}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  console.log('ScoreFlow audio asset pipeline');
  console.log(`Piano source: ${PIANO_BASE}`);
  console.log(
    `Drums source: ${DRUMS_OVERRIDE || 'Tone.js acoustic-kit + berklee'}`,
  );
  console.log(`Samples required: ${unique.length}\n`);

  const stats = { downloaded: 0, skipped: 0, bytes: 0, failed: [] };
  for (const item of unique) {
    await processAsset(item, stats);
  }

  const missing = await assertAllPresent(unique);
  await ensureWebLink();

  console.log('\n--- Summary ---');
  console.log(`Downloaded: ${stats.downloaded}`);
  console.log(`Skipped:    ${stats.skipped}`);
  console.log(`Failed:     ${stats.failed.length}`);
  console.log(`Bytes:      ${(stats.bytes / 1048576).toFixed(2)} MB`);

  if (stats.failed.length) {
    console.error('\nFailed downloads:');
    for (const f of stats.failed) {
      console.error(`  - ${f.label}: ${f.error}`);
    }
  }

  if (missing.length) {
    console.error('\nMissing required samples:');
    for (const m of missing) console.error(`  - ${m}`);
    process.exit(1);
  }

  if (stats.failed.length) process.exit(1);

  if (WRITE_CHECKSUMS) await writeChecksumsFile(unique);

  console.log('\nAll required audio samples are present.');
}

main().catch((e) => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
