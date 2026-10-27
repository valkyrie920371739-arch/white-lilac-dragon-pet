import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

test('desktop install link targets the shipped atlas with the matching version and name', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8');
  const pet = JSON.parse(await readFile(new URL('desktop-pet.json', root), 'utf8'));
  const asset = JSON.parse(await readFile(new URL('assets/pet.json', root), 'utf8'));
  const href = html.match(/id="install-button"[^>]*href="([^"]+)"/)?.[1];
  assert(href, 'Install link must remain usable without JavaScript');
  const link = new URL(href.replaceAll('&amp;', '&'));
  assert.equal(link.protocol, 'codex:');
  assert.equal(link.hostname, 'pets');
  assert.equal(link.pathname, '/install');
  assert.deepEqual([...link.searchParams.keys()].sort(), ['description', 'imageUrl', 'name', 'spriteVersionNumber']);
  assert.equal(link.searchParams.get('name'), pet.displayName);
  assert.equal(pet.displayName, asset.name);
  assert.equal(link.searchParams.get('description'), pet.description);
  assert.equal(Number(link.searchParams.get('spriteVersionNumber')), asset.spriteVersion);
  assert.equal(pet.spriteVersionNumber, asset.spriteVersion);
  assert.equal(link.searchParams.get('imageUrl'), `https://raw.githubusercontent.com/valkyrie920371739-arch/white-lilac-dragon-pet/main/assets/${pet.spritesheetPath}`);
  assert.equal(pet.spritesheetPath, asset.sprite.src.slice(2));
});
