import { frameIndexAt, lookDirectionForPoint, clampPosition } from './animation.js';

const manifestURL = new URL('../assets/pet.json', import.meta.url);
const preferenceKey = 'white-lilac-dragon.preferences.v1';
const actionOrder = ['waving', 'jumping', 'waiting', 'running', 'review', 'failed', 'idle', 'running-left', 'running-right'];
const oneShotStates = new Set(['waving', 'jumping', 'failed']);
const actionSymbols = { waving: '♡', jumping: '↑', waiting: '⌁', running: '⋯', review: '✓', failed: '⌢', idle: '☾', 'running-left': '←', 'running-right': '→' };
const directionKeys = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);
const tapDelayMs = 300;

const stage = document.getElementById('stage');
const petButton = document.getElementById('pet-button');
const canvas = document.getElementById('pet-canvas');
const fallback = document.getElementById('pet-fallback');
const loading = document.getElementById('loading');
const errorPanel = document.getElementById('error-panel');
const errorMessage = document.getElementById('error-message');
const retryButton = document.getElementById('retry-button');
const actionButtons = document.getElementById('action-buttons');
const stateLabel = document.getElementById('state-label');
const stateDescription = document.getElementById('state-description');
const pauseButton = document.getElementById('pause-button');
const pauseText = document.getElementById('pause-text');
const resetButton = document.getElementById('reset-button');
const followToggle = document.getElementById('follow-toggle');
const motionToggle = document.getElementById('motion-toggle');
const playbackStatus = document.getElementById('playback-status');
const playbackText = document.getElementById('playback-text');
const context = canvas.getContext('2d', { alpha: true });
const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');

let preferences = readPreferences();
let reducedMotion = typeof preferences.reducedMotion === 'boolean' ? preferences.reducedMotion : motionPreference.matches;
let followPointer = typeof preferences.followPointer === 'boolean' ? preferences.followPointer : true;
let paused = false;
let ready = false;
let manifest;
let atlas;
let states = new Map();
let currentState = 'idle';
let elapsed = 0;
let oneShot = false;
let position = null;
let previousStageSize = null;
let pointer = null;
let drag = null;
let tapTimer = 0;
let lastTap = 0;
let frameHandle = 0;
let previousTimestamp = null;
let lastDrawn = '';
let loadSequence = 0;
const heldKeys = new Set();

function readPreferences() {
  try {
    const value = JSON.parse(localStorage.getItem(preferenceKey) || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function savePreferences() {
  try {
    localStorage.setItem(preferenceKey, JSON.stringify(preferences));
  } catch {
    // Interaction remains available when storage is disabled or full.
  }
}

function resolveAsset(source) {
  if (typeof source !== 'string' || !source) throw new Error('形象清单中的资源地址无效。');
  const url = new URL(source, manifestURL);
  if (url.origin !== manifestURL.origin) throw new Error('形象资源需要与网页放在同一个站点。');
  return url;
}

function validateManifest(data) {
  if (!data || data.schemaVersion !== 1 || !data.sprite || !Array.isArray(data.states) || !data.look) {
    throw new Error('形象资源清单格式不正确。');
  }
  const sprite = data.sprite;
  for (const key of ['width', 'height', 'columns', 'rows', 'cellWidth', 'cellHeight']) {
    if (!Number.isInteger(sprite[key]) || sprite[key] <= 0) throw new Error('形象图集的尺寸信息不正确。');
  }
  if (sprite.width !== sprite.columns * sprite.cellWidth || sprite.height !== sprite.rows * sprite.cellHeight) {
    throw new Error('形象图集的网格与尺寸不一致。');
  }
  const ids = new Set();
  for (const state of data.states) {
    if (!state || typeof state.id !== 'string' || ids.has(state.id) || typeof state.label !== 'string' || typeof state.description !== 'string') {
      throw new Error('形象动作清单有重复或缺失的内容。');
    }
    ids.add(state.id);
    if (!Number.isInteger(state.row) || state.row < 0 || state.row >= sprite.rows || !Number.isInteger(state.frames) || state.frames < 1 || state.frames > sprite.columns || !Array.isArray(state.durationsMs) || state.frames !== state.durationsMs.length || state.durationsMs.some(value => !Number.isFinite(value) || value <= 0)) {
      throw new Error('形象动作的帧数或播放时长不正确。');
    }
  }
  if (actionOrder.some(id => !ids.has(id))) throw new Error('形象资源缺少必要的动作。');
  if (data.look.angleOrigin !== 'up' || data.look.angleDirection !== 'clockwise' || !Array.isArray(data.look.directions) || data.look.directions.length !== 16) {
    throw new Error('鼠标方向跟随的数据不完整。');
  }
  for (const direction of data.look.directions) {
    if (!Number.isFinite(direction.degrees) || direction.degrees < 0 || direction.degrees >= 360 || !Number.isInteger(direction.row) || !Number.isInteger(direction.column) || direction.row < 0 || direction.row >= sprite.rows || direction.column < 0 || direction.column >= sprite.columns) {
      throw new Error('鼠标方向跟随的数据不正确。');
    }
  }
  return data;
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('形象图片未能加载，请检查网络后重试。'));
    image.src = url.href;
  });
}

function cancelTap() {
  if (tapTimer) clearTimeout(tapTimer);
  tapTimer = 0;
  lastTap = 0;
}

function setStatus(label, description) {
  if (stateLabel.textContent !== label) stateLabel.textContent = label;
  if (stateDescription.textContent !== description) stateDescription.textContent = description;
}

function updatePlaybackControls() {
  pauseButton.setAttribute('aria-pressed', String(paused));
  pauseText.textContent = paused ? '继续动画' : '暂停动画';
  playbackStatus.classList.toggle('is-paused', paused || reducedMotion);
  playbackText.textContent = !ready ? '正在加载' : reducedMotion ? '静态展示' : paused ? '已暂停' : '动作播放中';
  followToggle.checked = followPointer;
  motionToggle.checked = reducedMotion;
  document.body.classList.toggle('reduce-motion', reducedMotion);
}

function updateActionButtons() {
  for (const button of actionButtons.querySelectorAll('button[data-state]')) {
    button.setAttribute('aria-pressed', String(button.dataset.state === currentState));
  }
}

function playState(id, { once = oneShotStates.has(id) } = {}) {
  if (!ready || !states.has(id)) return;
  cancelTap();
  currentState = id;
  elapsed = 0;
  oneShot = once;
  lastDrawn = '';
  updateActionButtons();
  render();
  startClock();
}

function representativeFrame(state) {
  if (state.id === 'idle' || state.id === 'jumping') return 0;
  return Math.min(2, state.frames - 1);
}

function render() {
  if (!ready || !context) return;
  const state = states.get(currentState);
  let row = state.row;
  let column = reducedMotion ? representativeFrame(state) : frameIndexAt(state.durationsMs, elapsed, { loop: !oneShot });
  let looking = false;
  if (currentState === 'idle' && followPointer && pointer && !drag && !paused && !reducedMotion) {
    const box = petButton.getBoundingClientRect();
    const direction = lookDirectionForPoint({ dx: pointer.x - (box.left + box.width / 2), dy: pointer.y - (box.top + box.height * 0.43), deadzone: 28 * box.width / manifest.sprite.cellWidth }, manifest.look.directions);
    if (direction) {
      row = direction.row;
      column = direction.column;
      looking = true;
    }
  }
  if (looking) setStatus('看向你', '在舞台内移动鼠标，她会跟着看。');
  else setStatus(state.label, state.description);
  const key = `${row}:${column}`;
  if (key === lastDrawn) return;
  const { cellWidth, cellHeight } = manifest.sprite;
  context.clearRect(0, 0, cellWidth, cellHeight);
  context.drawImage(atlas, column * cellWidth, row * cellHeight, cellWidth, cellHeight, 0, 0, cellWidth, cellHeight);
  lastDrawn = key;
  canvas.dataset.row = String(row);
  canvas.dataset.column = String(column);
  petButton.dataset.state = currentState;
}

function tick(timestamp) {
  frameHandle = 0;
  if (!ready || document.hidden) {
    previousTimestamp = null;
    return;
  }
  const delta = previousTimestamp === null ? 0 : Math.max(0, timestamp - previousTimestamp);
  previousTimestamp = timestamp;
  if (!paused && !reducedMotion) {
    elapsed += delta;
    const state = states.get(currentState);
    const total = state.durationsMs.reduce((sum, duration) => sum + duration, 0);
    if (oneShot && elapsed >= total) {
      currentState = 'idle';
      elapsed = 0;
      oneShot = false;
      updateActionButtons();
    }
  }
  render();
  if (!paused && !reducedMotion) frameHandle = requestAnimationFrame(tick);
}

function startClock() {
  if (!ready || document.hidden || frameHandle) return;
  previousTimestamp = null;
  frameHandle = requestAnimationFrame(tick);
}

function stopClock() {
  if (frameHandle) cancelAnimationFrame(frameHandle);
  frameHandle = 0;
  previousTimestamp = null;
}

function stageSize() {
  return { width: stage.clientWidth, height: stage.clientHeight };
}

function spriteSize() {
  return { width: petButton.offsetWidth, height: petButton.offsetHeight };
}

function movePet(next) {
  position = clampPosition(next, stageSize(), spriteSize());
  petButton.style.left = `${position.x}px`;
  petButton.style.top = `${position.y}px`;
}

function centerPet() {
  const size = stageSize();
  movePet({ x: size.width / 2, y: size.height * 0.51 });
  pointer = null;
  heldKeys.clear();
  if (ready) playState('idle', { once: false });
}

function resizeStage() {
  const next = stageSize();
  if (!position || !previousStageSize || previousStageSize.width <= 0 || previousStageSize.height <= 0) centerPet();
  else movePet({ x: position.x * next.width / previousStageSize.width, y: position.y * next.height / previousStageSize.height });
  previousStageSize = next;
  render();
}

function buildActionButtons() {
  const fragment = document.createDocumentFragment();
  for (const id of actionOrder) {
    const state = states.get(id);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'action-button';
    button.dataset.state = id;
    button.setAttribute('aria-pressed', String(id === currentState));
    button.title = state.description;
    const icon = document.createElement('span');
    icon.className = 'action-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = actionSymbols[id];
    const label = document.createElement('span');
    label.className = 'action-label';
    label.textContent = state.label;
    button.append(icon, label);
    fragment.append(button);
  }
  actionButtons.replaceChildren(fragment);
}

function finishDrag({ cancelled = false } = {}) {
  if (!drag) return;
  const old = drag;
  drag = null;
  petButton.classList.remove('is-dragging');
  if (petButton.hasPointerCapture(old.pointerId)) petButton.releasePointerCapture(old.pointerId);
  if (old.active || cancelled) {
    cancelTap();
    pointer = null;
    playState('idle', { once: false });
    return;
  }
  const now = performance.now();
  if (tapTimer && now - lastTap <= tapDelayMs) {
    cancelTap();
    playState('jumping');
  } else {
    cancelTap();
    lastTap = now;
    tapTimer = setTimeout(() => {
      tapTimer = 0;
      lastTap = 0;
      playState('waving');
    }, tapDelayMs);
  }
}

petButton.addEventListener('pointerdown', event => {
  if (!ready || event.button !== 0 || drag) return;
  event.preventDefault();
  petButton.focus({ preventScroll: true });
  drag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, startPosition: { ...position }, previousX: event.clientX, facing: 'running-right', active: false };
  petButton.setPointerCapture(event.pointerId);
});

petButton.addEventListener('pointermove', event => {
  if (!drag || drag.pointerId !== event.pointerId) return;
  const dx = event.clientX - drag.startX;
  const dy = event.clientY - drag.startY;
  if (!drag.active && Math.hypot(dx, dy) > 6) {
    drag.active = true;
    cancelTap();
    petButton.classList.add('is-dragging');
  }
  if (!drag.active) return;
  event.preventDefault();
  const movement = event.clientX - drag.previousX;
  if (Math.abs(movement) > 0.5) drag.facing = movement > 0 ? 'running-right' : 'running-left';
  drag.previousX = event.clientX;
  movePet({ x: drag.startPosition.x + dx, y: drag.startPosition.y + dy });
  if (currentState !== drag.facing) playState(drag.facing, { once: false });
  render();
});

petButton.addEventListener('pointerup', event => {
  if (drag?.pointerId === event.pointerId) finishDrag();
});
petButton.addEventListener('pointercancel', event => {
  if (drag?.pointerId === event.pointerId) finishDrag({ cancelled: true });
});
petButton.addEventListener('lostpointercapture', event => {
  if (drag?.pointerId === event.pointerId) finishDrag({ cancelled: true });
});
petButton.addEventListener('click', event => {
  // Pointer taps are handled above so mouse and touch share double-tap timing.
  if (event.detail === 0 && ready) playState('waving');
});

stage.addEventListener('pointermove', event => {
  if (event.pointerType === 'touch' || drag) return;
  pointer = { x: event.clientX, y: event.clientY };
  render();
});
stage.addEventListener('pointerleave', () => {
  if (drag) return;
  pointer = null;
  render();
});

petButton.addEventListener('keydown', event => {
  if (!ready) return;
  if (directionKeys.has(event.key)) {
    event.preventDefault();
    cancelTap();
    heldKeys.add(event.key);
    const step = event.shiftKey ? 32 : 16;
    const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
    const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
    movePet({ x: position.x + dx, y: position.y + dy });
    const facing = dx < 0 ? 'running-left' : dx > 0 ? 'running-right' : currentState === 'running-left' ? 'running-left' : 'running-right';
    if (currentState !== facing) playState(facing, { once: false });
  } else if (event.code === 'Space') {
    event.preventDefault();
    if (!event.repeat) playState('jumping');
  } else if (event.key === 'Home') {
    event.preventDefault();
    centerPet();
  } else if (event.key === 'Escape') {
    event.preventDefault();
    heldKeys.clear();
    pointer = null;
    finishDrag({ cancelled: true });
    playState('idle', { once: false });
  }
});
petButton.addEventListener('keyup', event => {
  if (event.code === 'Space') event.preventDefault();
  if (directionKeys.has(event.key)) {
    heldKeys.delete(event.key);
    if (!heldKeys.size) {
      pointer = null;
      playState('idle', { once: false });
    }
  }
});
petButton.addEventListener('blur', () => {
  if (heldKeys.size) {
    heldKeys.clear();
    playState('idle', { once: false });
  }
});

actionButtons.addEventListener('click', event => {
  const button = event.target.closest('button[data-state]');
  if (!button || !actionButtons.contains(button)) return;
  pointer = null;
  heldKeys.clear();
  finishDrag({ cancelled: true });
  playState(button.dataset.state);
});

resetButton.addEventListener('click', () => {
  finishDrag({ cancelled: true });
  cancelTap();
  centerPet();
});
pauseButton.addEventListener('click', () => {
  paused = !paused;
  cancelTap();
  stopClock();
  updatePlaybackControls();
  render();
  if (!paused) startClock();
});
followToggle.addEventListener('change', () => {
  followPointer = followToggle.checked;
  preferences.followPointer = followPointer;
  savePreferences();
  render();
});

function applyReducedMotion(value) {
  reducedMotion = value;
  cancelTap();
  stopClock();
  lastDrawn = '';
  updatePlaybackControls();
  render();
  if (!reducedMotion && !paused) startClock();
}
motionToggle.addEventListener('change', () => {
  preferences.reducedMotion = motionToggle.checked;
  savePreferences();
  applyReducedMotion(motionToggle.checked);
});
motionPreference.addEventListener('change', event => {
  if (typeof preferences.reducedMotion !== 'boolean') applyReducedMotion(event.matches);
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    cancelTap();
    const wasKeyboardMoving = heldKeys.size > 0;
    heldKeys.clear();
    if (drag) finishDrag({ cancelled: true });
    else if (wasKeyboardMoving) {
      pointer = null;
      playState('idle', { once: false });
    }
    stopClock();
  } else startClock();
});
window.addEventListener('blur', () => {
  cancelTap();
  if (drag) finishDrag({ cancelled: true });
  if (heldKeys.size) {
    heldKeys.clear();
    playState('idle', { once: false });
  }
});

new ResizeObserver(resizeStage).observe(stage);
retryButton.addEventListener('click', loadPet);

async function loadPet() {
  const sequence = ++loadSequence;
  ready = false;
  stopClock();
  cancelTap();
  loading.hidden = false;
  errorPanel.hidden = true;
  retryButton.disabled = true;
  petButton.disabled = true;
  pauseButton.disabled = true;
  resetButton.disabled = true;
  for (const button of actionButtons.querySelectorAll('button')) button.disabled = true;
  stage.setAttribute('aria-busy', 'true');
  updatePlaybackControls();
  try {
    if (!context) throw new Error('当前浏览器无法显示动画画布，请换用支持 Canvas 的浏览器。');
    if (location.protocol === 'file:') throw new Error('请通过本地预览服务或部署后的网页地址打开此页面。');
    const response = await fetch(manifestURL, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`形象清单读取失败（${response.status}），请重试。`);
    const nextManifest = validateManifest(await response.json());
    const imageURL = resolveAsset(nextManifest.sprite.src);
    if (typeof nextManifest.sprite.sha256 === 'string') imageURL.searchParams.set('v', nextManifest.sprite.sha256.slice(0, 16));
    const nextAtlas = await loadImage(imageURL);
    if (nextAtlas.naturalWidth !== nextManifest.sprite.width || nextAtlas.naturalHeight !== nextManifest.sprite.height) {
      throw new Error('形象图片与资源清单的尺寸不一致。');
    }
    if (sequence !== loadSequence) return;
    manifest = nextManifest;
    atlas = nextAtlas;
    states = new Map(manifest.states.map(state => [state.id, state]));
    canvas.width = manifest.sprite.cellWidth;
    canvas.height = manifest.sprite.cellHeight;
    context.imageSmoothingEnabled = true;
    currentState = 'idle';
    elapsed = 0;
    oneShot = false;
    pointer = null;
    lastDrawn = '';
    ready = true;
    buildActionButtons();
    canvas.hidden = false;
    fallback.hidden = true;
    loading.hidden = true;
    petButton.disabled = false;
    pauseButton.disabled = false;
    resetButton.disabled = false;
    stage.setAttribute('aria-busy', 'false');
    centerPet();
    updatePlaybackControls();
    startClock();
  } catch (error) {
    if (sequence !== loadSequence) return;
    loading.hidden = true;
    errorPanel.hidden = false;
    retryButton.disabled = false;
    stage.setAttribute('aria-busy', 'false');
    errorMessage.textContent = error instanceof Error ? error.message : '形象资源未能加载，请重试。';
    setStatus('等待重新加载', '资源准备完成后，就可以继续互动。');
    playbackText.textContent = '未能加载';
    console.error('Pet resource loading failed.', error);
  }
}

updatePlaybackControls();
loadPet();
