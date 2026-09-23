import { playSound } from './sounds.js';

const canvas = document.getElementById('tetris-board');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('tetris-score');
const linesEl = document.getElementById('tetris-lines');
const btnRematch = document.getElementById('btn-rematch-tetris');

const ROWS = 20;
const COLS = 10;
const BLOCK_SIZE = 20;

// テトリミノの色
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

// テトリミノの形
const SHAPES = [
  [],
  [[0,0,0,0], [1,1,1,1], [0,0,0,0], [0,0,0,0]], // I
  [[2,0,0], [2,2,2], [0,0,0]], // J
  [[0,0,3], [3,3,3], [0,0,0]], // L
  [[4,4], [4,4]], // O
  [[0,5,5], [5,5,0], [0,0,0]], // S
  [[0,6,0], [6,6,6], [0,0,0]], // T
  [[7,7,0], [0,7,7], [0,0,0]]  // Z
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

// 盤面生成
function createBoard() {
  return Array.from({length: ROWS}, () => Array(COLS).fill(0));
}

// 新しいピースの出現
function spawnPiece() {
  const typeId = Math.floor(Math.random() * 7) + 1;
  piece = {
    pos: { x: Math.floor(COLS / 2) - Math.floor(SHAPES[typeId][0].length / 2), y: 0 },
    matrix: SHAPES[typeId],
    typeId: typeId
  };
  
  // 出現直後に衝突したらゲームオーバー
  if (collide(board, piece)) {
    isGameOver = true;
    btnRematch.style.display = 'inline-block';
    playSound('win'); // ゲームオーバー音（ファンファーレ代用）
  }
}

// 衝突判定
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

// 盤面への固定
function merge(board, piece) {
  piece.matrix.forEach((row, y) => {
    row.forEach((value, x) => {
      if (value !== 0) {
        board[y + piece.pos.y][x + piece.pos.x] = value;
      }
    });
  });
}

// ライン消去
function sweep() {
  let rowCount = 0;
  outer: for (let y = board.length - 1; y >= 0; y--) {
    for (let x = 0; x < board[y].length; x++) {
      if (board[y][x] === 0) continue outer;
    }
    const row = board.splice(y, 1)[0].fill(0);
    board.unshift(row);
    y++;
    rowCount++;
  }
  if (rowCount > 0) {
    playSound('flip'); // 消えた音
    lines += rowCount;
    score += [0, 40, 100, 300, 1200][rowCount] * (Math.floor(lines / 10) + 1);
    dropInterval = Math.max(100, 1000 - (Math.floor(lines / 10) * 100)); // スピードアップ
    updateScore();
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
    playSound('put'); // 固定音
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
  if(isGameOver) return;
  while (!collide(board, piece)) {
    piece.pos.y++;
  }
  piece.pos.y--;
  merge(board, piece);
  playSound('put');
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

// 描画処理（立体感・光沢のあるブロックにアップデート）
function drawMatrix(matrix, offset) {
  matrix.forEach((row, y) => {
    row.forEach((value, x) => {
      if (value !== 0) {
        const px = (x + offset.x) * BLOCK_SIZE;
        const py = (y + offset.y) * BLOCK_SIZE;
        const size = BLOCK_SIZE;
        const bw = 4; // ベベル（立体枠）の太さ

        // 1. ベースカラーの描画
        ctx.fillStyle = COLORS[value];
        ctx.fillRect(px, py, size, size);

        // 2. 左と上のハイライト（光の反射）
        ctx.fillStyle = 'rgba(255, 255, 255, 0.7)'; // 白の半透明
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + size, py);
        ctx.lineTo(px + size - bw, py + bw);
        ctx.lineTo(px + bw, py + bw);
        ctx.lineTo(px + bw, py + size - bw);
        ctx.lineTo(px, py + size);
        ctx.fill();

        // 3. 右と下のシャドウ（影）
        ctx.fillStyle = 'rgba(0, 0, 0, 0.4)'; // 黒の半透明
        ctx.beginPath();
        ctx.moveTo(px + size, py + size);
        ctx.lineTo(px, py + size);
        ctx.lineTo(px + bw, py + size - bw);
        ctx.lineTo(px + size - bw, py + size - bw);
        ctx.lineTo(px + size - bw, py + bw);
        ctx.lineTo(px + size, py);
        ctx.fill();

        // 4. 中心部分のツヤ出し（さらに光沢感を強調）
        ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.fillRect(px + bw, py + bw, size - bw * 2, size - bw * 2);

        // 5. 全体の細い枠線
        ctx.strokeStyle = '#111';
        ctx.strokeRect(px, py, size, size);
      }
    });
  });
}

function draw() {
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  drawMatrix(board, {x: 0, y: 0});
  if (piece) drawMatrix(piece.matrix, piece.pos);
  
  if (isGameOver) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#fff';
    ctx.font = '24px sans-serif';
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

// キーボード操作対応（テトリス画面を開いている時だけ有効）
document.addEventListener('keydown', event => {
  if (document.getElementById('tetris-game-screen').classList.contains('active') && !isGameOver) {
    switch(event.keyCode) {
      case 37: moveTetris(-1); break; // 左
      case 39: moveTetris(1); break;  // 右
      case 40: dropTetris(); break;   // 下
      case 38: rotateTetris(); break; // 上
      case 32: hardDropTetris(); break; // スペース
    }
  }
});