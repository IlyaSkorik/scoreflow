#!/usr/bin/env node
/**
 * Cross-platform symlink: web/assets/www -> assets/www
 * (Flutter Web serves the engine at /assets/www/...).
 */
import { access, mkdir, symlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const target = resolve(root, 'assets', 'www');
const linkParent = join(root, 'web', 'assets');
const link = join(linkParent, 'www');

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

await mkdir(linkParent, { recursive: true });
if (await exists(link)) {
  console.log(`Already linked: web/assets/www`);
  process.exit(0);
}

try {
  await symlink(target, link, 'dir');
  console.log(`Linked web/assets/www -> assets/www`);
} catch (e) {
  console.error(`Failed to link web/assets/www: ${e.message}`);
  process.exit(1);
}
