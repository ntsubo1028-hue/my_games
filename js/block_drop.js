/**
 * Block_drop Game Module - Version 1.1.9
 */
import { playSound } from './sounds.js';

// 変数の宣言のみ先に行う
let canvas, ctx, nextCanvas, nextCtx, holdCanvas, holdCtx;
let scoreEl, linesEl, btnRematch, block_dropScreenEl;

let holdPiece = null;
let canHold = true;
let holdTimer = null;

const ROWS = 20;
const COLS = 10;
const BLOCK_SIZE = 18;

const COLORS = [
  null,
  '#00FFFF', // I (水色)
  '#0000FF', // J (青)
  '#FFA500', // L (オレンジ)
  '#FFFF00', // O (黄色)
  '#00FF00', // S (緑)
  '#800080', // T (紫)
  '#FF0000'  // Z (赤)
];

const SHAPES = [
  [],
  [[0,0,0,0], [1,1,1,1], [0,0,0,0], [0,0,0,0]],
  [[2,0,0], [2,2,2], [0,0,0]],
  [[0,0,3], [3,3,3], [0,0,0]],
  [[4,4], [4,4]],
  [[0,5,5], [5,5,0], [0,0,0]],
  [[0,6,0], [6,6,6], [0,0,0]],
  [[7,7,0], [0,7,7], [0,0,0]]
];

let board = [];
let piece = null;
let nextPiece = null;
let dropCounter = 0;
let dropInterval = 1000;
let lastTime = 0;
let score = 0;
let lines = 0;
let animationId = null;
let isGameOver = false;

// 7-Bag（7種1巡）用変数
let block_dropBag = [];

// --- 演出用変数 ---
let particles = [];
let floatingTexts = [];
let shakeTime = 0;
let shakeIntensity = 0;

// タップ判定用タイマー管理
let tapTimeout = null;
let lastTapTime = 0;

function clearTapTimer() {
  if (tapTimeout) {
    clearTimeout(tapTimeout);
    tapTimeout = null;
  }
}

function createBoard() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(0));
}

// 7-Bagの袋を生成・シャッフルする関数
function generateBag() {
  let newBag = [1, 2, 3, 4, 5, 6, 7];
  for (let i = newBag.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newBag[i], newBag[j]] = [newBag[j], newBag[i]];
  }
  return newBag;
}

// 7-Bagからミノを取り出す関数
function getRandomPiece() {
  if (block_dropBag.length === 0) {
    block_dropBag = generateBag();
  }
  const typeId = block_dropBag.pop();
  return {
    matrix: SHAPES[typeId],
    typeId: typeId
  };
}

function spawnPiece() {
  clearTapTimer();
  cancelHold();
  canHold = true;
  if (!nextPiece) {
    nextPiece = getRandomPiece();
  }
  piece = {
    pos: { x: Math.floor(COLS / 2) - Math.floor(nextPiece.matrix[0].length / 2), y: 0 },
    matrix: nextPiece.matrix,
    typeId: nextPiece.typeId
  };
  
  nextPiece = getRandomPiece();
  drawNext();

  if (collide(board, piece)) {
    isGameOver = true;
    btnRematch.style.display = 'inline-block';
    playSound('win');
  }
}

function collide(board, piece) {
  const m = piece.matrix;
  for (let y = 0; y < m.length; y++) {
    for (let x = 0; x < m[y].length; x++) {
      if (m[y][x] !== 0 &&
         (board[y + piece.pos.y] && board[y + piece.pos.y][x + piece.pos.x]) !== 0) {
        return true;
      }
    }
  }
  return false;
}

function merge(board, piece) {
  piece.matrix.forEach((row, y) => {
    row.forEach((value, x) => {
      if (value !== 0) {
        board[y + piece.pos.y][x + piece.pos.x] = value;
      }
    });
  });
}

function triggerShake(intensity = 5, duration = 15) {
  shakeIntensity = intensity;
  shakeTime = duration;
}

function createParticles(yIndex, rowValues) {
  for (let x = 0; x < COLS; x++) {
    const colorVal = rowValues[x];
    if (!colorVal) continue;
    const px = x * BLOCK_SIZE + BLOCK_SIZE / 2;
    const py = yIndex * BLOCK_SIZE + BLOCK_SIZE / 2;

    for (let i = 0; i < 6; i++) {
      particles.push({
        x: px, y: py,
        vx: (Math.random() - 0.5) * 8,
        vy: (Math.random() - 0.5) * 8 - 2,
        size: Math.random() * 4 + 2,
        color: COLORS[colorVal],
        life: 1.0,
        decay: Math.random() * 0.03 + 0.02
      });
    }
  }
}

function addFloatingText(text, color = '#FFF') {
  floatingTexts.push({
    text: text,
    x: canvas.width / 2,
    y: canvas.height / 2,
    color: color,
    scale: 0.5,
    maxScale: 1.5,
    life: 1.0,
    decay: 0.02
  });
}

function sweep() {
  let rowCount = 0;
  
  for (let y = board.length - 1; y >= 0; y--) {
    let isFull = true;
    for (let x = 0; x < board[y].length; x++) {
      if (board[y][x] === 0) {
        isFull = false;
        break;
      }
    }

    if (isFull) {
      createParticles(y, [...board[y]]);
      const row = board.splice(y, 1)[0].fill(0);
      board.unshift(row);
      y++;
      rowCount++;
    }
  }

  if (rowCount > 0) {
    playSound('flip');
    lines += rowCount;
    score += [0, 100, 300, 500, 1200][rowCount] * (Math.floor(lines / 10) + 1);
    dropInterval = Math.max(100, 1000 - (Math.floor(lines / 10) * 100));
    updateScore();

    if (rowCount === 1) { triggerShake(3, 10); addFloatingText('SINGLE!', '#00FFFF'); }
    else if (rowCount === 2) { triggerShake(6, 12); addFloatingText('DOUBLE!!', '#00FF00'); }
    else if (rowCount === 3) { triggerShake(9, 15); addFloatingText('TRIPLE!!!', '#FFA500'); }
    else if (rowCount >= 4) { triggerShake(15, 25); addFloatingText('BLOCK_DROP!!!!', '#FF0055'); }
  }
}

export function moveBlock_drop(dir) {
  if (isGameOver) return;
  piece.pos.x += dir;
  if (collide(board, piece)) {
    piece.pos.x -= dir;
  }
}

export function dropBlock_drop() {
  if (isGameOver) return;
  piece.pos.y++;
  if (collide(board, piece)) {
    piece.pos.y--;
    merge(board, piece);
    playSound('put');
    spawnPiece();
    sweep();
  }
  dropCounter = 0;
}

export function rotateBlock_drop() {
  if (isGameOver) return;
  const pos = piece.pos.x;
  let offset = 1;
  rotateMatrix(piece.matrix);
  while (collide(board, piece)) {
    piece.pos.x += offset;
    offset = -(offset + (offset > 0 ? 1 : -1));
    if (offset > piece.matrix[0].length) {
      rotateMatrix(piece.matrix, -1);
      piece.pos.x = pos;
      return;
    }
  }
}

export function hardDropBlock_drop() {
  if (isGameOver) return;
  clearTapTimer();
  cancelHold();
  while (!collide(board, piece)) {
    piece.pos.y++;
  }
  piece.pos.y--;
  merge(board, piece);
  playSound('put');
  triggerShake(2, 6);
  spawnPiece();
  sweep();
  dropCounter = 0;
}

function rotateMatrix(matrix, dir = 1) {
  for (let y = 0; y < matrix.length; y++) {
    for (let x = 0; x < y; x++) {
      [matrix[x][y], matrix[y][x]] = [matrix[y][x], matrix[x][y]];
    }
  }
  if (dir > 0) { matrix.forEach(row => row.reverse()); }
  else { matrix.reverse(); }
}

function updateScore() {
  scoreEl.innerText = `スコア: ${score}`;
  linesEl.innerText = `ライン: ${lines}`;
}

export function actionHold(immediate = false) {
  if (isGameOver || !canHold) return;

  const executeHold = () => {
    if (isGameOver || !canHold) return;

    if (holdPiece === null) {
      holdPiece = piece.typeId;
      spawnPiece();
    } else {
      const temp = piece.typeId;
      piece = {
        pos: { x: Math.floor(COLS / 2) - Math.floor(SHAPES[holdPiece][0].length / 2), y: 0 },
        matrix: SHAPES[holdPiece],
        typeId: holdPiece
      };
      holdPiece = temp;
      
      if (collide(board, piece)) {
        piece.pos.y--;
      }
    }
    
    canHold = false;
    drawHold();
  };

  if (immediate) {
    cancelHold();
    executeHold();
  } else {
    if (holdTimer) return;
    holdTimer = setTimeout(() => {
      holdTimer = null;
      executeHold();
    }, 100);
  }
}

export function cancelHold() {
  if (holdTimer) {
    clearTimeout(holdTimer);
    holdTimer = null;
  }
}

function drawHold() {
  if (!holdCtx) return;
  holdCtx.fillStyle = '#111';
  holdCtx.fillRect(0, 0, holdCanvas.width, holdCanvas.height);

  if (!holdPiece) return;
  const matrix = SHAPES[holdPiece];
  const size = 14;
  const rows = matrix.length;
  const cols = matrix[0].length;
  const offsetX = (holdCanvas.width - cols * size) / 2 / size;
  const offsetY = (holdCanvas.height - rows * size) / 2 / size;

  matrix.forEach((row, y) => {
    row.forEach((value, x) => {
      if (value !== 0) {
        drawBlock(holdCtx, x + offsetX, y + offsetY, value, size);
      }
    });
  });
}

function drawBlock(targetCtx, x, y, value, size) {
  if (!value) return;
  const px = x * size;
  const py = y * size;
  const bw = 2;

  targetCtx.fillStyle = COLORS[value];
  targetCtx.fillRect(px, py, size, size);

  targetCtx.fillStyle = 'rgba(255, 255, 255, 0.6)';
  targetCtx.beginPath();
  targetCtx.moveTo(px, py); targetCtx.lineTo(px + size, py);
  targetCtx.lineTo(px + size - bw, py + bw); targetCtx.lineTo(px + bw, py + bw);
  targetCtx.lineTo(px + bw, py + size - bw); targetCtx.lineTo(px, py + size);
  targetCtx.fill();

  targetCtx.strokeStyle = '#111';
  targetCtx.strokeRect(px, py, size, size);
}

function drawMatrix(matrix, offset) {
  matrix.forEach((row, y) => {
    row.forEach((value, x) => {
      if (value !== 0) {
        drawBlock(ctx, x + offset.x, y + offset.y, value, BLOCK_SIZE);
      }
    });
  });
}

function drawNext() {
  if (!nextCtx) return;
  nextCtx.fillStyle = '#111';
  nextCtx.fillRect(0, 0, nextCanvas.width, nextCanvas.height);

  if (!nextPiece) return;
  const matrix = nextPiece.matrix;
  const size = 14;
  const rows = matrix.length;
  const cols = matrix[0].length;
  const offsetX = (nextCanvas.width - cols * size) / 2 / size;
  const offsetY = (nextCanvas.height - rows * size) / 2 / size;

  matrix.forEach((row, y) => {
    row.forEach((value, x) => {
      if (value !== 0) {
        drawBlock(nextCtx, x + offsetX, y + offsetY, value, size);
      }
    });
  });
}

function getGhostY() {
  let ghost = {
    pos: { x: piece.pos.x, y: piece.pos.y },
    matrix: piece.matrix
  };
  while (!collide(board, ghost)) {
    ghost.pos.y++;
  }
  return ghost.pos.y - 1;
}

function updateAndDrawEffects() {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx; p.y += p.vy; p.vy += 0.2; p.life -= p.decay;
    if (p.life <= 0) { particles.splice(i, 1); continue; }
    ctx.save();
    ctx.globalAlpha = p.life;
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    ctx.restore();
  }

  for (let i = floatingTexts.length - 1; i >= 0; i--) {
    const ft = floatingTexts[i];
    ft.y -= 0.8;
    if (ft.scale < ft.maxScale) ft.scale += 0.1;
    ft.life -= ft.decay;
    if (ft.life <= 0) { floatingTexts.splice(i, 1); continue; }
    ctx.save();
    ctx.globalAlpha = ft.life;
    ctx.fillStyle = ft.color;
    ctx.font = `900 ${Math.floor(18 * ft.scale)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.shadowColor = '#000';
    ctx.shadowBlur = 6;
    ctx.fillText(ft.text, ft.x, ft.y);
    ctx.restore();
  }
}

function draw() {
  ctx.save();
  if (shakeTime > 0) {
    const dx = (Math.random() - 0.5) * shakeIntensity;
    const dy = (Math.random() - 0.5) * shakeIntensity;
    ctx.translate(dx, dy);
    shakeTime--;
  }

  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  drawMatrix(board, { x: 0, y: 0 });
  
  if (piece) {
    const ghostY = getGhostY();
    ctx.globalAlpha = 0.25;
    drawMatrix(piece.matrix, { x: piece.pos.x, y: ghostY });
    
    ctx.globalAlpha = 1.0;
    drawMatrix(piece.matrix, piece.pos);
  }

  updateAndDrawEffects();
  ctx.restore();

  if (isGameOver) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 22px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('GAME OVER', canvas.width / 2, canvas.height / 2);
  }
}

function update(time = 0) {
  if (!isGameOver) {
    const deltaTime = time - lastTime;
    lastTime = time;
    dropCounter += deltaTime;
    if (dropCounter > dropInterval) {
      dropBlock_drop();
    }
  }
  draw();
  animationId = requestAnimationFrame(update);
}

export function initBlock_drop() {
  // 初期化が実行されるタイミング（＝HTML要素が確実に存在する状態）で要素を取得する
  canvas = document.getElementById('block_drop-board');
  ctx = canvas ? canvas.getContext('2d') : null;
  nextCanvas = document.getElementById('block_drop-next');
  nextCtx = nextCanvas ? nextCanvas.getContext('2d') : null;
  holdCanvas = document.getElementById('block_drop-hold');
  holdCtx = holdCanvas ? holdCanvas.getContext('2d') : null;
  scoreEl = document.getElementById('block_drop-score');
  linesEl = document.getElementById('block_drop-lines');
  btnRematch = document.getElementById('btn-rematch-block_drop');
  block_dropScreenEl = document.getElementById('block_drop-game-screen');

  setupEventListeners();

  board = createBoard();
  holdPiece = null;
  canHold = true;
  block_dropBag = [];
  cancelHold();
  if (holdCtx) {
    holdCtx.fillStyle = '#111';
    holdCtx.fillRect(0, 0, holdCanvas.width, holdCanvas.height);
  }
  score = 0;
  lines = 0;
  dropInterval = 1000;
  isGameOver = false;
  particles = [];
  floatingTexts = [];
  shakeTime = 0;
  nextPiece = null;
  clearTapTimer();
  btnRematch.style.display = 'none';
  updateScore();
  spawnPiece();
  
  if (animationId) cancelAnimationFrame(animationId);
  lastTime = performance.now();
  update(lastTime);
}

export function stopBlock_drop() {
  clearTapTimer();
  cancelHold();
  if (animationId) {
    cancelAnimationFrame(animationId);
    animationId = null;
  }
}

// ==========================================
// PC & スマホ統合操作システムの実装
// ==========================================
const TILE_SENSITIVITY = 20;

let lastTouchEndTime = 0;
let lastMouseX = null;
let lastMouseY = null;
let dragStartX = 0;
let dragStartY = 0;
let lastTouchX = 0;
let lastTouchY = 0;
let isEventsSetup = false;

function setupEventListeners() {
  if (isEventsSetup || !block_dropScreenEl) return;
  isEventsSetup = true;

  block_dropScreenEl.addEventListener('mouseenter', (e) => {
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
  });

  block_dropScreenEl.addEventListener('mouseleave', () => {
    lastMouseX = null;
    lastMouseY = null;
    cancelHold();
  });

  block_dropScreenEl.addEventListener('mousemove', (e) => {
    if (!block_dropScreenEl.classList.contains('active') || isGameOver || lastMouseX === null || lastMouseY === null) return;

    const deltaX = e.clientX - lastMouseX;
    const deltaY = e.clientY - lastMouseY;

    if (Math.abs(deltaX) >= TILE_SENSITIVITY) {
      const steps = Math.trunc(deltaX / TILE_SENSITIVITY);
      if (steps !== 0) {
        moveBlock_drop(steps > 0 ? 1 : -1);
        lastMouseX += steps * TILE_SENSITIVITY;
      }
    }

    if (deltaY >= TILE_SENSITIVITY) {
      const stepsY = Math.trunc(deltaY / TILE_SENSITIVITY);
      if (stepsY > 0) {
        cancelHold();
        for (let i = 0; i < stepsY; i++) {
          dropBlock_drop();
        }
        lastMouseY += stepsY * TILE_SENSITIVITY;
      }
    }
  });

  block_dropScreenEl.addEventListener('mousedown', (e) => {
    if (!block_dropScreenEl.classList.contains('active') || isGameOver) return;
    if (new Date().getTime() - lastTouchEndTime < 500) return;

    if (e.button === 0) {
      cancelHold();
      hardDropBlock_drop();
    } else if (e.button === 2) {
      rotateBlock_drop();
    }
  });

  block_dropScreenEl.addEventListener('mouseup', () => {
    cancelHold();
  });

  block_dropScreenEl.addEventListener('contextmenu', (e) => {
    if (block_dropScreenEl.classList.contains('active')) {
      e.preventDefault();
    }
  });

  block_dropScreenEl.addEventListener('touchstart', (e) => {
    if (isGameOver) return;
    dragStartX = e.touches[0].clientX;
    dragStartY = e.touches[0].clientY;
    lastTouchX = dragStartX;
    lastTouchY = dragStartY;
  }, { passive: true });

  block_dropScreenEl.addEventListener('touchmove', (e) => {
    if (isGameOver) return;
    const currentX = e.touches[0].clientX;
    const currentY = e.touches[0].clientY;
    const deltaX = currentX - lastTouchX;
    const deltaY = currentY - lastTouchY;

    if (Math.abs(deltaX) >= TILE_SENSITIVITY) {
      const steps = Math.trunc(deltaX / TILE_SENSITIVITY);
      if (steps !== 0) {
        moveBlock_drop(steps > 0 ? 1 : -1);
        lastTouchX += steps * TILE_SENSITIVITY;
      }
    }

    if (deltaY >= TILE_SENSITIVITY) {
      const stepsY = Math.trunc(deltaY / TILE_SENSITIVITY);
      if (stepsY > 0) {
        cancelHold();
        for (let i = 0; i < stepsY; i++) {
          dropBlock_drop();
        }
        lastTouchY += stepsY * TILE_SENSITIVITY;
      }
    } else if (deltaY <= -TILE_SENSITIVITY) { 
      actionHold(false); 
      lastTouchY = currentY; 
    }
  }, { passive: true });

  block_dropScreenEl.addEventListener('touchend', (e) => {
    if (isGameOver) return;
    cancelHold();
    lastTouchEndTime = new Date().getTime();

    const touchEndX = e.changedTouches[0].clientX;
    const touchEndY = e.changedTouches[0].clientY;
    const totalDx = touchEndX - dragStartX;
    const totalDy = touchEndY - dragStartY;

    if (Math.abs(totalDx) < 10 && Math.abs(totalDy) < 10) {
      const currentTime = new Date().getTime();
      const tapInterval = lastTapTime ? (currentTime - lastTapTime) : 999;

      if (tapInterval < 180 && tapInterval > 0) {
        clearTapTimer();
        lastTapTime = 0;
        hardDropBlock_drop();
      } else {
        lastTapTime = currentTime;
        clearTapTimer();
        tapTimeout = setTimeout(() => {
          rotateBlock_drop();
          tapTimeout = null;
        }, 190);
      }
    }
  });
}

// キーボード操作
document.addEventListener('keydown', event => {
  if (block_dropScreenEl && block_dropScreenEl.classList.contains('active') && !isGameOver) {
    switch (event.keyCode) {
      case 37: moveBlock_drop(-1); break;
      case 39: moveBlock_drop(1); break;
      case 40: cancelHold(); dropBlock_drop(); break;
      case 38: rotateBlock_drop(); break;
      case 32: cancelHold(); hardDropBlock_drop(); break;
      case 67: 
      case 16: 
        actionHold(true); 
        break;
    }
  }
});

document.addEventListener('keyup', event => {
  if (event.keyCode === 67 || event.keyCode === 16) {
    cancelHold();
  }
});