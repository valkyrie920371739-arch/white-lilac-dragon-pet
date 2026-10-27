import { createServer } from 'node:http';
import { readFile, stat, realpath } from 'node:fs/promises';
import { dirname, extname, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writePetPackage } from './package-pet.mjs';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('Usage: node scripts/serve.mjs [--dist] [--port=4173] [--base=/demo/]');
  process.exit(0);
}
for (const arg of args) {
  if (arg !== '--dist' && !arg.startsWith('--port=') && !arg.startsWith('--base=')) {
    throw new Error(`Unknown argument: ${arg}`);
  }
}
const port = Number(args.find(arg => arg.startsWith('--port='))?.slice(7) ?? 4173);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Port must be an integer from 1024 to 65535.');
const base = args.find(arg => arg.startsWith('--base='))?.slice(7) ?? '/';
if (!/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(base)) throw new Error('Base must be a slash-delimited local path such as /demo/.');
const root = await realpath(resolve(project, args.includes('--dist') ? 'dist' : '.'));
if (!args.includes('--dist')) await writePetPackage(resolve(root, 'downloads'));
await stat(resolve(root, 'index.html'));
const types = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.json':'application/json; charset=utf-8', '.png':'image/png', '.mp4':'video/mp4', '.svg':'image/svg+xml', '.ico':'image/x-icon', '.zip':'application/zip' };
const publicRoots = new Set(['index.html', 'styles.css', 'src', 'assets', 'downloads', '.nojekyll']);

const server = createServer(async (request, response) => {
  const fail = (status, message) => { response.writeHead(status, {'Content-Type':'text/plain; charset=utf-8'}); response.end(message); };
  if (request.method !== 'GET' && request.method !== 'HEAD') return fail(405, 'Method not allowed');
  let pathname;
  try { pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); }
  catch { return fail(400, 'Invalid request URL'); }
  if (!pathname.startsWith(base)) return fail(404, 'Not found');
  let local = pathname.slice(base.length);
  if (!local || local.endsWith('/')) local += 'index.html';
  if (local.includes('\\') || !publicRoots.has(local.split('/')[0])) return fail(404, 'Not found');
  try {
    const target = await realpath(resolve(root, local));
    const rel = relative(root, target);
    if (rel.startsWith('..') || isAbsolute(rel)) return fail(403, 'Forbidden');
    if (!(await stat(target)).isFile()) return fail(404, 'Not found');
    const body = await readFile(target);
    response.writeHead(200, {'Content-Type':types[extname(target)] ?? 'application/octet-stream', 'Content-Length':body.length, 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff'});
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return fail(404, 'Not found');
    console.error('Static server:', error.message);
    return fail(500, 'Unable to read file');
  }
});
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => console.log(`Open http://127.0.0.1:${port}${base}`));
