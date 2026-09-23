import { playSound } from './sounds.js';

const canvas = document.getElementById('tetris-board');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('tetris-score');
const linesEl = document.getElementById('tetris-lines');
const btnRematch = document.getElementById('btn-rematch-tetris');

const ROWS = 20;
const COLS = 10;
const BLOCK_SIZE = 20;

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
let dropCounter = 0;
let dropInterval = 1000;
let lastTime = 0;
let score = 0;
let lines = 0;
let animationId = null;
let isGameOver = false;

// --- 演出用変数 ---
let particles = [];
let floatingTexts = [];
let shakeTime = 0;
let shakeIntensity = 0;

function createBoard() {
  return Array.from({length: ROWS}, () => Array(COLS).fill(0));
}

function spawnPiece() {
  const typeId = Math.floor(Math.random() * 7) + 1;
  piece = {
    pos: { x: Math.floor(COLS / 2) - Math.floor(SHAPES[typeId][0].length / 2), y: 0 },
    matrix: SHAPES[typeId],
    typeId: typeId
  };
  
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

// 演出：画面を揺らす
function triggerShake(intensity = 5, duration = 15) {
  shakeIntensity = intensity;
  shakeTime = duration;
}

// 演出：パーティクル（飛び散る破片）を生成
function createParticles(yIndex, rowValues) {
  for (let x = 0; x < COLS; x++) {
    const colorVal = rowValues[x];
    if (!colorVal) continue;
    const px = x * BLOCK_SIZE + BLOCK_SIZE / 2;
    const py = yIndex * BLOCK_SIZE + BLOCK_SIZE / 2;

    // 1マスあたり6個の破片を発散
    for (let i = 0; i < 6; i++) {
      particles.push({
        x: px,
        y: py,
        vx: (Math.random() - 0.5) * 8,
        vy: (Math.random() - 0.5) * 8 - 2, // やや上に吹き飛ぶ
        size: Math.random() * 5 + 3,
        color: COLORS[colorVal],
        life: 1.0,  // 不透明度・寿命
        decay: Math.random() * 0.03 + 0.02
      });
    }
  }
}

// 演出：ポップアップテキストを生成
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

// ライン消去
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
      // 消去されるラインの情報を元にパーティクル生成
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

    // 消した数に応じた演出切り替え
    if (rowCount === 1) {
      triggerShake(3, 10);
      addFloatingText('SINGLE!', '#00FFFF');
    } else if (rowCount === 2) {
      triggerShake(6, 12);
      addFloatingText('DOUBLE!!', '#00FF00');
    } else if (rowCount === 3) {
      triggerShake(9, 15);
      addFloatingText('TRIPLE!!!', '#FFA500');
    } else if (rowCount >= 4) {
      triggerShake(15, 25);
      addFloatingText('TETRIS!!!!', '#FF0055');
    }
  }
}

// 操作処理群
export function moveTetris(dir) {
  if (isGameOver) return;
  piece.pos.x += dir;
  if (collide(board, piece)) {
    piece.pos.x -= dir;
  }
}

export function dropTetris() {
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

export function rotateTetris() {
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

export function hardDropTetris() {
  if (isGameOver) return;
  while (!collide(board, piece)) {
    piece.pos.y++;
  }
  piece.pos.y--;
  merge(board, piece);
  playSound('put');
  triggerShake(2, 6); // ハードドロップ時も軽く揺らす
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
  if (dir > 0) {
    matrix.forEach(row => row.reverse());
  } else {
    matrix.reverse();
  }
}

function updateScore() {
  scoreEl.innerText = `スコア: ${score}`;
  linesEl.innerText = `ライン: ${lines}`;
}

// 光沢ブロック描画
function drawMatrix(matrix, offset) {
  matrix.forEach((row, y) => {
    row.forEach((value, x) => {
      if (value !== 0) {
        const px = (x + offset.x) * BLOCK_SIZE;
        const py = (y + offset.y) * BLOCK_SIZE;
        const size = BLOCK_SIZE;
        const bw = 3;

        ctx.fillStyle = COLORS[value];
        ctx.fillRect(px, py, size, size);

        ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + size, py);
        ctx.lineTo(px + size - bw, py + bw);
        ctx.lineTo(px + bw, py + bw);
        ctx.lineTo(px + bw, py + size - bw);
        ctx.lineTo(px, py + size);
        ctx.fill();

        ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
        ctx.beginPath();
        ctx.moveTo(px + size, py + size);
        ctx.lineTo(px, py + size);
        ctx.lineTo(px + bw, py + size - bw);
        ctx.lineTo(px + size - bw, py + size - bw);
        ctx.lineTo(px + size - bw, py + bw);
        ctx.lineTo(px + size, py);
        ctx.fill();

        ctx.strokeStyle = '#111';
        ctx.strokeRect(px, py, size, size);
      }
    });
  });
}

// 演出の更新＆描画処理
function updateAndDrawEffects() {
  // 1. パーティクルの更新・描画
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.2; // 簡易的な重力
    p.life -= p.decay;

    if (p.life <= 0) {
      particles.splice(i, 1);
      continue;
    }

    ctx.save();
    ctx.globalAlpha = p.life;
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    ctx.restore();
  }

  // 2. ポップアップテキストの更新・描画
  for (let i = floatingTexts.length - 1; i >= 0; i--) {
    const ft = floatingTexts[i];
    ft.y -= 0.8; // ゆっくり上昇
    if (ft.scale < ft.maxScale) ft.scale += 0.1;
    ft.life -= ft.decay;

    if (ft.life <= 0) {
      floatingTexts.splice(i, 1);
      continue;
    }

    ctx.save();
    ctx.globalAlpha = ft.life;
    ctx.fillStyle = ft.color;
    ctx.font = `900 ${Math.floor(20 * ft.scale)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.shadowColor = '#000';
    ctx.shadowBlur = 6;
    ctx.fillText(ft.text, ft.x, ft.y);
    ctx.restore();
  }
}

// 全体描画
function draw() {
  ctx.save();

  // 画面揺れ（スクリーンシェイク）の適用
  if (shakeTime > 0) {
    const dx = (Math.random() - 0.5) * shakeIntensity;
    const dy = (Math.random() - 0.5) * shakeIntensity;
    ctx.translate(dx, dy);
    shakeTime--;
  }

  // 盤面描画
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  drawMatrix(board, {x: 0, y: 0});
  if (piece) drawMatrix(piece.matrix, piece.pos);

  // エフェクト描画（破片・テキスト）
  updateAndDrawEffects();

  ctx.restore(); // 画面揺れの座標リセット

  // ゲームオーバー画面
  if (isGameOver) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 24px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('GAME OVER', canvas.width / 2, canvas.height / 2);
  }
}

// メインループ
function update(time = 0) {
  if (!isGameOver) {
    const deltaTime = time - lastTime;
    lastTime = time;
    dropCounter += deltaTime;
    if (dropCounter > dropInterval) {
      dropTetris();
    }
  }
  draw();
  animationId = requestAnimationFrame(update);
}

// 外部インターフェース
export function initTetris() {
  board = createBoard();
  score = 0;
  lines = 0;
  dropInterval = 1000;
  isGameOver = false;
  particles = [];
  floatingTexts = [];
  shakeTime = 0;
  btnRematch.style.display = 'none';
  updateScore();
  spawnPiece();
  
  if (animationId) cancelAnimationFrame(animationId);
  lastTime = performance.now();
  update(lastTime);
}

export function stopTetris() {
  if (animationId) {
    cancelAnimationFrame(animationId);
    animationId = null;
  }
}

// キーボード操作対応
document.addEventListener('keydown', event => {
  if (document.getElementById('tetris-game-screen').classList.contains('active') && !isGameOver) {
    switch(event.keyCode) {
      case 37: moveTetris(-1); break;
      case 39: moveTetris(1); break;
      case 40: dropTetris(); break;
      case 38: rotateTetris(); break;
      case 32: hardDropTetris(); break;
    }
  }
});