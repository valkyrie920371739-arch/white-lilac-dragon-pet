import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, relative, isAbsolute } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = resolve(root, 'assets/pet.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
assert.equal(manifest.schemaVersion, 1, 'Unsupported asset manifest version');

function localAsset(src) {
  assert.equal(typeof src, 'string');
  assert(src.startsWith('./'), 'Asset paths must be local and manifest-relative');
  const target = resolve(dirname(manifestPath), src);
  const rel = relative(dirname(manifestPath), target);
  assert(!rel.startsWith('..') && !isAbsolute(rel), 'Asset path escapes assets/');
  return target;
}

const sprite = manifest.sprite;
const bytes = await readFile(localAsset(sprite.src));
assert(bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])), 'Sprite must be a PNG');
assert.equal(bytes.toString('ascii', 12, 16), 'IHDR');
assert.equal(bytes.readUInt32BE(16), sprite.width, 'PNG width differs from manifest');
assert.equal(bytes.readUInt32BE(20), sprite.height, 'PNG height differs from manifest');
assert.equal(bytes[25], 6, 'Sprite must retain RGBA transparency');
assert.equal(createHash('sha256').update(bytes).digest('hex'), sprite.sha256, 'Sprite checksum changed; revalidate the artwork before updating its manifest');
assert.equal(sprite.width, sprite.columns * sprite.cellWidth);
assert.equal(sprite.height, sprite.rows * sprite.cellHeight);
assert.equal(sprite.columns, 8);
assert.equal(sprite.rows, 11);
assert.equal(sprite.cellWidth, 192);
assert.equal(sprite.cellHeight, 208);

const expected = [['idle',6],['running-right',8],['running-left',8],['waving',4],['jumping',5],['failed',8],['waiting',6],['running',6],['review',6]];
assert.equal(manifest.states.length, expected.length);
for (const [row, [id, frames]] of expected.entries()) {
  const state = manifest.states[row];
  assert.equal(state.id, id);
  assert.equal(state.row, row);
  assert.equal(state.frames, frames);
  assert.equal(state.durationsMs.length, frames);
  assert(state.durationsMs.every(duration => Number.isInteger(duration) && duration > 0));
}
assert.equal(manifest.look.angleOrigin, 'up');
assert.equal(manifest.look.angleDirection, 'clockwise');
assert.deepEqual(manifest.look.neutralFrame, { row: 0, column: 0 });
assert.equal(manifest.look.directions.length, 16);
for (const [index, direction] of manifest.look.directions.entries()) {
  assert.equal(direction.degrees, index * 22.5);
  assert.equal(direction.row, 9 + Math.floor(index / 8));
  assert.equal(direction.column, index % 8);
}
for (const asset of [manifest.preview, manifest.videoPreview]) {
  assert((await stat(localAsset(asset.src))).isFile());
}
console.log('Asset check passed: verified RGBA sprite, checksum, 73 frames, timings and 16 directions.');
