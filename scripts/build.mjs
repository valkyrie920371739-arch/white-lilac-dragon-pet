import { cp, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import './validate-assets.mjs';
import { writePetPackage } from './package-pet.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'dist');
const files = ['index.html', 'styles.css', 'src', 'assets'];
for (const file of files) await stat(resolve(root, file));
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
for (const file of files) await cp(resolve(root, file), resolve(out, file), { recursive: true });
await writePetPackage(resolve(out, 'downloads'));
await writeFile(resolve(out, '.nojekyll'), '');
console.log('Built dist/ with relative URLs. No runtime dependencies or external service keys are required.');
