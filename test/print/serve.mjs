// Статический сервер репозитория для печатного стенда (harness.html).
// Запуск: node test/print/serve.mjs [порт]   (по умолчанию 8123)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize, sep } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = normalize(join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const PORT = Number(process.argv[2]) || 8123;
const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.mp3': 'audio/mpeg',
};

createServer(async (req, res) => {
    try {
        const url = new URL(req.url, 'http://localhost');
        const path = normalize(join(ROOT, decodeURIComponent(url.pathname)));
        if (!path.startsWith(ROOT + sep)) throw new Error('outside root');
        const body = await readFile(path);
        res.writeHead(200, { 'Content-Type': MIME[extname(path)] || 'application/octet-stream' });
        res.end(body);
    } catch (e) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('not found');
    }
}).listen(PORT, () => console.log(`print harness: http://localhost:${PORT}/test/print/harness.html`));
