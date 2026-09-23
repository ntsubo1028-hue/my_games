import { sendData } from './connection.js';
import { playSound } from './sounds.js'; // ※ご自身のファイル名に合わせています

let isHostPlayer = false;
let isMyTurn = false;
let board = new Array(64).fill(null);
let gameOver = false;
let myColor = 'black'; 
let currentTurnColor = 'black';
let isAnimating = false; // 石が裏返っている最中のクリック防止用フラグ

// DOM elements
const boardEl = document.getElementById('board');
const turnText = document.getElementById('turn-text');
const scoreBlack = document.getElementById('score-black');
const scoreWhite = document.getElementById('score-white');
const btnRematch = document.getElementById('btn-rematch-othello'); // 再戦ボタン

export function initGame(isHost) {
  isHostPlayer = isHost;
  myColor = isHost ? 'black' : 'white';
  board = new Array(64).fill(null);
  
  // 初期配置
  board[27] = 'white'; board[28] = 'black';
  board[35] = 'black'; board[36] = 'white';
  
  currentTurnColor = 'black';
  isMyTurn = isHost; // ホスト（黒）が先手
  gameOver = false;
  isAnimating = false;
  btnRematch.style.display = 'none'; // 開始時は再戦ボタンを隠す
  
  updateBoard();
  updateUI();
}

function updateBoard() {
  boardEl.innerHTML = '';
  const validMoves = getValidMoves(currentTurnColor);

  for (let i = 0; i < 64; i++) {
    const cell = document.createElement('div');
    cell.className = 'cell';
    
    if (board[i]) {
      // 3Dフリップアニメーション用の構造を作成
      const disc = document.createElement('div');
      disc.className = `disc ${board[i]}`;
      
      const faceBlack = document.createElement('div');
      faceBlack.className = 'face face-black';
      const faceWhite = document.createElement('div');
      faceWhite.className = 'face face-white';
      
      disc.appendChild(faceBlack);
      disc.appendChild(faceWhite);
      cell.appendChild(disc);
    } else if (isMyTurn && !gameOver && !isAnimating && validMoves.includes(i)) {
      // 自分のターンで、かつアニメーション中でなければ置ける場所をハイライト
      cell.classList.add('valid-move');
      cell.onclick = () => handleCellClick(i);
    }
    
    boardEl.appendChild(cell);
  }
}

function updateUI() {
  const blackCount = board.filter(c => c === 'black').length;
  const whiteCount = board.filter(c => c === 'white').length;
  
  scoreBlack.innerText = `黒: ${blackCount}`;
  scoreWhite.innerText = `白: ${whiteCount}`;

  if (gameOver) {
    btnRematch.style.display = 'inline-block'; // ゲーム終了で再戦ボタン表示
    if (blackCount > whiteCount) turnText.innerText = "🏆 黒の勝ち！";
    else if (whiteCount > blackCount) turnText.innerText = "🏆 白の勝ち！";
    else turnText.innerText = "🤝 引き分け！";
  } else {
    turnText.innerText = isMyTurn ? "🟢 あなたのターン" : "🔴 相手のターン";
  }
}

function handleCellClick(index) {
  if (!isMyTurn || gameOver || isAnimating) return;
  
  const flipped = getFlippedStones(index, currentTurnColor);
  if (flipped.length > 0) {
    const moveData = {
      type: "ACTION_PUT_STONE",
      payload: { index, player: currentTurnColor, flipped }
    };
    
    if (isHostPlayer) {
      processAction(moveData);
    } else {
      sendData(moveData);
    }
  }
}

export function processAction(data) {
  if (data.type === "ACTION_PUT_STONE") {
    const { index, player, flipped } = data.payload;
    applyMove(index, player, flipped);
  }
}

// 石を置いて裏返す処理（アニメーションと音付き）
function applyMove(index, player, flipped) {
  isAnimating = true;
  board[index] = player;
  playSound('put'); // 置いた音
  updateBoard();

  // 1枚ずつ時間差で裏返す演出
  flipped.forEach((fl, i) => {
    setTimeout(() => {
      board[fl] = player;
      playSound('flip'); // 反転音
      updateBoard();
    }, (i + 1) * 100); // 100ミリ秒ずつズラす
  });

  // 全て裏返り終わるまで待ってから、ターンの処理へ進む
  setTimeout(() => {
    isAnimating = false;
    checkGameOverAndNextTurn(player);
  }, flipped.length * 100 + 100);
}

// ターン交代と終了判定
function checkGameOverAndNextTurn(lastPlayer) {
  const nextPlayer = lastPlayer === 'black' ? 'white' : 'black';
  const nextValidMoves = getValidMoves(nextPlayer);
  
  if (nextValidMoves.length > 0) {
    currentTurnColor = nextPlayer;
  } else {
    // 相手がパスの場合
    const lastPlayerValidMoves = getValidMoves(lastPlayer);
    if (lastPlayerValidMoves.length === 0) {
      // 両者置けない場合はゲーム終了
      gameOver = true;
      playSound('win'); // 勝敗決定のファンファーレ
    } else {
      currentTurnColor = lastPlayer; // ターン継続
    }
  }

  isMyTurn = (currentTurnColor === myColor);
  updateUI();
  
  // ホストなら最新状態をゲストに送る
  if (isHostPlayer) {
    syncStateToGuest();
  }
}

export function syncStateToGuest() {
  if (isHostPlayer) {
    sendData({
      type: "STATE_SYNC",
      payload: {
        board, currentTurnColor, gameOver, turn: currentTurnColor
      }
    });
  }
}

export function updateGameState(payload) {
  if (!isHostPlayer) {
    // ゲスト側：盤面の石が増えていれば、擬似的に音を鳴らす
    const oldStoneCount = board.filter(c => c !== null).length;
    const newStoneCount = payload.board.filter(c => c !== null).length;
    
    if (newStoneCount > oldStoneCount) {
      playSound('put');
      setTimeout(() => playSound('flip'), 150);
    }

    board = payload.board;
    currentTurnColor = payload.currentTurnColor;
    gameOver = payload.gameOver;
    isMyTurn = payload.turn === myColor;
    
    if (gameOver) {
       playSound('win');
       btnRematch.style.display = 'inline-block';
    }

    updateBoard();
    updateUI();
  }
}

// --- コアロジック：石を裏返せるかどうかの判定 ---
function getFlippedStones(index, player) {
  const opponent = player === 'black' ? 'white' : 'black';
  const r = Math.floor(index / 8);
  const c = index % 8;
  let flipped = [];
  const directions = [
    [-1, 0], [1, 0], [0, -1], [0, 1],
    [-1, -1], [-1, 1], [1, -1], [1, 1]
  ];

  directions.forEach(([dr, dc]) => {
    let nr = r + dr;
    let nc = c + dc;
    let temp = [];
    while (nr >= 0 && nr < 8 && nc >= 0 && nc < 8 && board[nr * 8 + nc] === opponent) {
      temp.push(nr * 8 + nc);
      nr += dr;
      nc += dc;
    }
    if (temp.length > 0 && nr >= 0 && nr < 8 && nc >= 0 && nc < 8 && board[nr * 8 + nc] === player) {
      flipped.push(...temp);
    }
  });
  return flipped;
}

function getValidMoves(player) {
  let valid = [];
  for (let i = 0; i < 64; i++) {
    if (!board[i]) {
      const flipped = getFlippedStones(i, player);
      if (flipped.length > 0) valid.push(i);
    }
  }
  return valid;
}

// --- 再戦リクエストの処理 ---
export function requestRematch() {
  if (isHostPlayer) {
    initGame(true);
    syncStateToGuest();
  } else {
    sendData({ type: "ACTION_REMATCH_OTHELLO" });
  }
}