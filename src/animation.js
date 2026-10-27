/** Pure animation helpers. Coordinates use CSS pixels and screen axes. */

function finiteNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number.`);
  }
  return value;
}

function nonnegative(value, label) {
  finiteNumber(value, label);
  if (value < 0) throw new RangeError(`${label} must not be negative.`);
  return value;
}

/**
 * Return the frame containing elapsedMs. Exact boundaries start the next frame.
 * Non-looping playback holds its last frame once the animation has finished.
 */
export function frameIndexAt(durationsMs, elapsedMs, { loop = true } = {}) {
  if (!Array.isArray(durationsMs) || durationsMs.length === 0) {
    throw new TypeError('durationsMs must be a non-empty array.');
  }
  if (typeof loop !== 'boolean') throw new TypeError('loop must be a boolean.');
  nonnegative(elapsedMs, 'elapsedMs');
  let total = 0;
  for (const duration of durationsMs) {
    finiteNumber(duration, 'Frame duration');
    if (duration <= 0) throw new RangeError('Frame durations must be positive.');
    total += duration;
  }
  if (!Number.isFinite(total)) throw new RangeError('Animation duration is too large.');
  if (!loop && elapsedMs >= total) return durationsMs.length - 1;
  const position = loop ? elapsedMs % total : elapsedMs;
  let boundary = 0;
  for (let index = 0; index < durationsMs.length; index += 1) {
    boundary += durationsMs[index];
    if (position < boundary) return index;
  }
  // Only a floating-point rounding boundary can reach this branch.
  return durationsMs.length - 1;
}

/** Clockwise angle: 0 = up, 90 = right, 180 = down, 270 = left. */
export function angleFromVector(dx, dy) {
  finiteNumber(dx, 'dx');
  finiteNumber(dy, 'dy');
  if (dx === 0 && dy === 0) return 0;
  const degrees = Math.atan2(dx, -dy) * 180 / Math.PI;
  return ((degrees % 360) + 360) % 360;
}

/**
 * Return an existing direction entry, or null within the inclusive deadzone.
 * Circular distance handles the 337.5° -> 0° boundary. Exact ties keep the
 * first entry in the supplied list, so the result is deterministic.
 */
export function lookDirectionForPoint({ dx, dy, deadzone = 36 }, directions) {
  finiteNumber(dx, 'dx');
  finiteNumber(dy, 'dy');
  nonnegative(deadzone, 'deadzone');
  if (!Array.isArray(directions) || directions.length === 0) {
    throw new TypeError('directions must be a non-empty array.');
  }
  for (const direction of directions) {
    if (direction === null || typeof direction !== 'object') {
      throw new TypeError('Every direction must be an object.');
    }
    finiteNumber(direction.degrees, 'Direction degrees');
    if (direction.degrees < 0 || direction.degrees >= 360) {
      throw new RangeError('Direction degrees must be within [0, 360).');
    }
  }
  if (Math.hypot(dx, dy) <= deadzone) return null;
  const angle = angleFromVector(dx, dy);
  let selected = directions[0];
  let smallest = Infinity;
  for (const direction of directions) {
    const difference = Math.abs(direction.degrees - angle);
    const distance = Math.min(difference, 360 - difference);
    if (distance < smallest) {
      selected = direction;
      smallest = distance;
    }
  }
  return selected;
}

/**
 * Clamp a sprite's centre so its complete rectangular cell fits in the stage.
 * If a stage axis is smaller than the sprite, keep that axis centred.
 */
export function clampPosition(position, stageSize, spriteSize) {
  finiteNumber(position.x, 'position.x');
  finiteNumber(position.y, 'position.y');
  nonnegative(stageSize.width, 'stageSize.width');
  nonnegative(stageSize.height, 'stageSize.height');
  finiteNumber(spriteSize.width, 'spriteSize.width');
  finiteNumber(spriteSize.height, 'spriteSize.height');
  if (spriteSize.width <= 0 || spriteSize.height <= 0) {
    throw new RangeError('Sprite dimensions must be positive.');
  }
  const clampAxis = (point, available, occupied) => available <= occupied
    ? available / 2
    : Math.min(available - occupied / 2, Math.max(occupied / 2, point));
  return {
    x: clampAxis(position.x, stageSize.width, spriteSize.width),
    y: clampAxis(position.y, stageSize.height, spriteSize.height),
  };
}
