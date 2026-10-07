import { sendData } from './connection.js';
import { playSound } from './sounds.js'; // 音声モジュールをインポート
import { currentGameState } from './lobby.js'; // ロビーの参加者情報を取得

let isHostPlayer = false;
let lines = [];
let boxes = [];
let gameOver = false;

// --- 多人数対応用の変数 ---
const PLAYER_COLORS = ['#d32f2f', '#1976d2', '#388e3c', '#f57c00']; // 1P:赤, 2P:青, 3P:緑, 4P:橙
const PLAYER_ICONS = ['🔴', '🔵', '🟢', '🟠'];                      // 各プレイヤーのカラーに対応した玉アイコン
let players = [];
let scores = [];
let turnIndex = 0;

// --- ボードのサイズ設定（4人対応に合わせて4x4） ---
const BOARD_SIZE = 4;
const H_LINES_COUNT = (BOARD_SIZE + 1) * BOARD_SIZE;     // 20
const V_LINES_COUNT = BOARD_SIZE * (BOARD_SIZE + 1);     // 20
const TOTAL_LINES = H_LINES_COUNT + V_LINES_COUNT;       // 40
const TOTAL_BOXES = BOARD_SIZE * BOARD_SIZE;             // 16

// UI要素の安全な取得
function getElements() {
  return {
    turnText: document.getElementById('dots-turn-text'),
    scoreBoard: document.getElementById('dots-score-board'),
    board: document.getElementById('dots-board-container'),
    btnRematch: document.getElementById('btn-rematch-dots')
  };
}

export function initDotsGame(isHost) {
  isHostPlayer = isHost;
  
  // ロビー情報からプレイヤー抽出
  if (currentGameState && currentGameState.slots) {
    players = currentGameState.slots.filter(s => s.type !== 'none').map(s => ({
      connId: s.connId,
      type: s.type,
      name: s.name,
      slotId: s.slotId
    }));
  } else {
    players = [];
  }
  
  // フェールセーフ
  if (players.length === 0) {
    players = [
      { connId: 'host', type: 'host', name: '1P', slotId: 0 },
      { connId: 'guest-1', type: 'guest', name: '2P', slotId: 1 }
    ];
  }

  turnIndex = 0; 
  scores = new Array(players.length).fill(0);
  lines = new Array(TOTAL_LINES).fill(null);
  boxes = new Array(TOTAL_BOXES).fill(null);
  gameOver = false;
  
  const { btnRematch } = getElements();
  if (btnRematch) btnRematch.style.display = 'none';
  
  renderBoard();
  updateUI();
}

function renderBoard() {
  const { board } = getElements();
  if (!board) return;

  board.innerHTML = '';
  const gridSize = BOARD_SIZE * 2 + 1; // 9
  
  board.style.display = 'grid';
  board.style.gridTemplateColumns = `repeat(${gridSize}, auto)`;
  board.style.justifyContent = 'center';
  board.style.alignItems = 'center';
  board.style.gap = '0px';
  board.style.margin = '20px auto';

  // CSSに依存せずJavaScriptでサイズを自動設定
  const DOT_SIZE = '12px';
  const LINE_THICKNESS = '12px';
  const BOX_SIZE = '48px';

  for(let r = 0; r < gridSize; r++) {
    for(let c = 0; c < gridSize; c++) {
      const cell = document.createElement('div');
      cell.style.boxSizing = 'border-box';
      
      if(r % 2 === 0 && c % 2 === 0) {
        // ドット
        cell.className = 'dot';
        cell.style.width = DOT_SIZE;
        cell.style.height = DOT_SIZE;
        cell.style.backgroundColor = '#333';
        cell.style.borderRadius = '50%';
      } else if (r % 2 === 0 && c % 2 !== 0) {
        // 横の線
        const lineR = r / 2; 
        const lineC = Math.floor(c / 2); 
        const index = lineR * BOARD_SIZE + lineC;
        cell.className = 'line-h';
        cell.dataset.index = index;
        cell.style.width = BOX_SIZE;
        cell.style.height = LINE_THICKNESS;
        cell.style.backgroundColor = '#e0e0e0';
        cell.style.cursor = 'pointer';
        cell.style.borderRadius = '4px';
        cell.onclick = () => handleLineClick(index);
      } else if (r % 2 !== 0 && c % 2 === 0) {
        // 縦の線
        const lineR = Math.floor(r / 2); 
        const lineC = c / 2; 
        const index = H_LINES_COUNT + lineR * (BOARD_SIZE + 1) + lineC;
        cell.className = 'line-v';
        cell.dataset.index = index;
        cell.style.width = LINE_THICKNESS;
        cell.style.height = BOX_SIZE;
        cell.style.backgroundColor = '#e0e0e0';
        cell.style.cursor = 'pointer';
        cell.style.borderRadius = '4px';
        cell.onclick = () => handleLineClick(index);
      } else {
        // ボックス (陣地)
        const boxR = Math.floor(r / 2);
        const boxC = Math.floor(c / 2);
        const index = boxR * BOARD_SIZE + boxC;
        cell.className = 'box';
        cell.id = 'box-' + index;
        cell.style.width = BOX_SIZE;
        cell.style.height = BOX_SIZE;
        cell.style.backgroundColor = '#fafafa';
        cell.style.borderRadius = '4px';
      }
      board.appendChild(cell);
    }
  }
}

function updateUI() {
  const { turnText, scoreBoard, btnRematch } = getElements();

  // スコア表示の更新
  if (scoreBoard) {
    scoreBoard.innerHTML = '';
    players.forEach((p, i) => {
      const span = document.createElement('span');
      span.style.color = PLAYER_COLORS[i % PLAYER_COLORS.length];
      span.style.fontWeight = 'bold';
      span.style.margin = '0 8px';
      span.style.fontSize = '15px';
      span.innerText = `${p.name}: ${scores[i]}`;
      scoreBoard.appendChild(span);
    });
  }
  
  if (gameOver) {
    if (btnRematch) btnRematch.style.display = 'inline-block';
    
    let maxScore = Math.max(...scores);
    let winners = players.filter((p, i) => scores[i] === maxScore);
    if (turnText) {
      if (winners.length === 1) {
        turnText.innerText = `🏆 ${winners[0].name}の勝ち！`;
        turnText.style.color = PLAYER_COLORS[players.indexOf(winners[0]) % PLAYER_COLORS.length];
      } else {
        turnText.innerText = "🤝 引き分け！";
        turnText.style.color = '#333';
      }
    }
  } else {
    const currentPlayer = players[turnIndex] || players[0];
    if (turnText && currentPlayer) {
      const colorIndex = turnIndex % PLAYER_COLORS.length;
      turnText.style.color = PLAYER_COLORS[colorIndex];
      
      const myConnId = currentGameState ? currentGameState.myConnId : 'host';
      const icon = PLAYER_ICONS[colorIndex] || '🔴';
      
      if (currentPlayer.connId === myConnId) {
        turnText.innerText = `${icon} あなたのターン`;
      } else {
        turnText.innerText = `${icon} ${currentPlayer.name}のターン`;
      }
    }
  }

  // 線の描画
  lines.forEach((val, idx) => {
    const el = document.querySelector(`[data-index="${idx}"]`);
    if(el) {
      if (val !== null) {
        el.style.backgroundColor = PLAYER_COLORS[val % PLAYER_COLORS.length];
      } else {
        el.style.backgroundColor = '#e0e0e0'; 
      }
    }
  });

  // ボックス(陣地)の描画
  boxes.forEach((val, idx) => {
    const el = document.getElementById('box-' + idx);
    if(el) {
      if (val !== null) {
        el.style.backgroundColor = PLAYER_COLORS[val % PLAYER_COLORS.length];
        el.style.opacity = '0.45';
      } else {
        el.style.backgroundColor = '#fafafa';
        el.style.opacity = '1';
      }
    }
  });
}

function handleLineClick(index) {
  const currentPlayer = players[turnIndex];
  if (!currentPlayer) return;
  
  const myConnId = currentGameState ? currentGameState.myConnId : 'host';
  if (currentPlayer.connId !== myConnId || gameOver || lines[index] !== null) return;
  
  if (isHostPlayer) {
    applyMove({ index, playerIndex: turnIndex });
    syncDotsStateToGuest();
  } else {
    sendData({
      type: "ACTION_DRAW_LINE",
      payload: { index: index, playerIndex: turnIndex }
    });
  }
}

export function processDotsAction(data) {
  if (data.type === "ACTION_DRAW_LINE" && isHostPlayer) {
    if (data.payload.playerIndex === turnIndex) {
      applyMove(data.payload);
      syncDotsStateToGuest();
    }
  }
}

function applyMove({index, playerIndex}) {
  if (lines[index] !== null) return;

  lines[index] = playerIndex;
  playSound('line');
  
  let scored = false;
  for(let r = 0; r < BOARD_SIZE; r++){
    for(let c = 0; c < BOARD_SIZE; c++){
      const bIdx = r * BOARD_SIZE + c;
      if (boxes[bIdx] === null) {
        const top = r * BOARD_SIZE + c;
        const bottom = (r + 1) * BOARD_SIZE + c;
        const left = H_LINES_COUNT + r * (BOARD_SIZE + 1) + c;
        const right = H_LINES_COUNT + r * (BOARD_SIZE + 1) + (c + 1);
        
        if (lines[top] !== null && lines[bottom] !== null && lines[left] !== null && lines[right] !== null) {
          boxes[bIdx] = playerIndex;
          scores[playerIndex]++;
          scored = true;
        }
      }
    }
  }

  if (scored) {
    playSound('box'); 
  }

  if (boxes.every(b => b !== null)) {
    if (!gameOver) {
      gameOver = true;
      playSound('win');
    }
  } else {
    if (!scored) {
      turnIndex = (turnIndex + 1) % players.length;
    }
  }
  
  updateUI();
}

export function syncDotsStateToGuest() {
  if (isHostPlayer) {
    sendData({
      type: "STATE_SYNC_DOTS",
      payload: {
        players, lines, boxes, scores,
        turnIndex, gameOver
      }
    });
  }
}

export function updateDotsGameState(payload) {
  if (!isHostPlayer) {
    players = payload.players || players;
    lines = payload.lines;
    boxes = payload.boxes;
    scores = payload.scores;
    gameOver = payload.gameOver;
    turnIndex = payload.turnIndex; 
    
    const { board, btnRematch } = getElements();
    if (!gameOver && btnRematch) {
      btnRematch.style.display = 'none';
    }

    if (board && board.childElementCount === 0) {
      renderBoard();
    }

    updateUI();
  }
}

export function requestRematchDots() {
  if (isHostPlayer) {
    initDotsGame(true);
    syncDotsStateToGuest();
  } else {
    sendData({ type: "ACTION_REMATCH_DOTS" });
  }
}