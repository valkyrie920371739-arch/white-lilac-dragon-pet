import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  frameIndexAt,
  angleFromVector,
  lookDirectionForPoint,
  clampPosition,
} from '../src/animation.js';

const manifest = JSON.parse(await readFile(new URL('../assets/pet.json', import.meta.url), 'utf8'));
const waving = manifest.states.find((state) => state.id === 'waving');

test('actual greeting timing respects every frame boundary and loop wrap', () => {
  assert.deepEqual(waving.durationsMs, [140, 140, 140, 280]);
  for (const [milliseconds, expected] of [
    [0, 0], [139.999, 0], [140, 1], [279.999, 1],
    [280, 2], [419.999, 2], [420, 3], [699.999, 3],
    [700, 0], [840, 1], [1400, 0],
  ]) {
    assert.equal(frameIndexAt(waving.durationsMs, milliseconds), expected);
  }
});

test('non-looping actions hold their final frame without wrapping', () => {
  assert.equal(frameIndexAt(waving.durationsMs, 140, { loop: false }), 1);
  assert.equal(frameIndexAt(waving.durationsMs, 700, { loop: false }), 3);
  assert.equal(frameIndexAt(waving.durationsMs, 100_000, { loop: false }), 3);
});

test('screen-coordinate cardinal and diagonal angles are not inverted', () => {
  assert.equal(angleFromVector(0, -100), 0);
  assert.equal(angleFromVector(100, 0), 90);
  assert.equal(angleFromVector(0, 100), 180);
  assert.equal(angleFromVector(-100, 0), 270);
  assert.equal(angleFromVector(1, -1), 45);
  assert.equal(angleFromVector(-1, -1), 315);
  assert.equal(angleFromVector(0, 0), 0);
});

test('actual look rows select cardinals and preserve the circular upper-left edge', () => {
  const directions = manifest.look.directions;
  for (const [dx, dy, row, column] of [
    [0, -100, 9, 0], [100, 0, 9, 4],
    [0, 100, 10, 0], [-100, 0, 10, 4],
    [-38.2683432365, -92.3879532511, 10, 7],
    [-5, -100, 9, 0], [5, -100, 9, 0],
  ]) {
    const selected = lookDirectionForPoint({ dx, dy }, directions);
    assert.equal(selected.row, row);
    assert.equal(selected.column, column);
    assert.ok(directions.includes(selected), 'returns the manifest object, preserving its metadata');
  }
});

test('pointer deadzone includes its edge and avoids an arbitrary gaze at the centre', () => {
  assert.equal(lookDirectionForPoint({ dx: 0, dy: 0 }, manifest.look.directions), null);
  assert.equal(lookDirectionForPoint({ dx: 36, dy: 0 }, manifest.look.directions), null);
  assert.equal(lookDirectionForPoint({ dx: 36.001, dy: 0 }, manifest.look.directions).degrees, 90);
});

test('dragging constrains the entire 192x208 cell, including extreme pointer positions', () => {
  const stage = { width: 600, height: 400 };
  const sprite = { width: 192, height: 208 };
  assert.deepEqual(clampPosition({ x: -500, y: 10_000 }, stage, sprite), { x: 96, y: 296 });
  assert.deepEqual(clampPosition({ x: 10_000, y: -500 }, stage, sprite), { x: 504, y: 104 });
  assert.deepEqual(clampPosition({ x: 300, y: 200 }, stage, sprite), { x: 300, y: 200 });
});

test('a narrow or collapsed stage centres the oversized sprite instead of inverting bounds', () => {
  const sprite = { width: 192, height: 208 };
  assert.deepEqual(clampPosition({ x: -10, y: 400 }, { width: 100, height: 100 }, sprite), { x: 50, y: 50 });
  assert.deepEqual(clampPosition({ x: -10, y: 400 }, { width: 100, height: 400 }, sprite), { x: 50, y: 296 });
  assert.deepEqual(clampPosition({ x: 50, y: 50 }, { width: 0, height: 0 }, sprite), { x: 0, y: 0 });
});

test('malformed timing, geometry and direction data fail before reaching rendering', () => {
  for (const durations of [[], [0], [-1], [NaN], [Infinity], ['140']]) {
    assert.throws(() => frameIndexAt(durations, 0));
  }
  assert.throws(() => frameIndexAt([140], NaN), TypeError);
  assert.throws(() => frameIndexAt([140], -1), RangeError);
  assert.throws(() => angleFromVector(Infinity, 0), TypeError);
  assert.throws(() => lookDirectionForPoint({ dx: 100, dy: 0 }, []), TypeError);
  assert.throws(() => lookDirectionForPoint({ dx: 100, dy: 0 }, [{ degrees: 360 }]), RangeError);
  assert.throws(() => lookDirectionForPoint({ dx: 100, dy: 0, deadzone: -1 }, manifest.look.directions), RangeError);
  assert.throws(() => clampPosition({ x: NaN, y: 0 }, { width: 500, height: 500 }, { width: 192, height: 208 }), TypeError);
  assert.throws(() => clampPosition({ x: 0, y: 0 }, { width: -1, height: 500 }, { width: 192, height: 208 }), RangeError);
});
