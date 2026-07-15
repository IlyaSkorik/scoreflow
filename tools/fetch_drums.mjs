#!/usr/bin/env node
/** @deprecated Use `npm run fetch-audio` (tools/fetch_audio_assets.mjs). */
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = join(dirname(fileURLToPath(import.meta.url)), 'fetch_audio_assets.mjs');
const child = spawn(process.execPath, [script, ...process.argv.slice(2)], {
  stdio: 'inherit',
});
child.on('exit', (code) => process.exit(code ?? 1));
