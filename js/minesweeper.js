import { sendData } from './connection_2.js';
import { playSound } from './sounds.js';

const ROWS = 8;
const COLS = 8;
const BOMBS = 10;

let isSoloMode = false;
let isHostPlayer = false;
let myRole = 'host';

let board = []; // { isBomb, isOpened, bombCount }
let myFlags = []; // ローカル専用の旗保持（相手には同期しない）

let scores = { host: 0, guest: 0 };
let currentTurn = 'host';
let gameOver = false;

let openedInCurrentTurn = 0; // 現在のターンで開けたマス数
let currentInputMode = 'open'; // 'open' または 'flag'

// --- 一人用ゲーム初期化 ---
export function initSoloGame() {
  isSoloMode = true;
  gameOver = false;
  currentInputMode = 'open';
  myFlags = Array(ROWS * COLS).fill(false);

  generateBoard();
  
  document.getElementById('mine-score-board').style.display = 'none';
  document.getElementById('btn-mine-end-turn').style.display = 'none';
  const btnRematch = document.getElementById('btn-rematch-mine');
  if (btnRematch) btnRematch.style.display = 'none';

  updateModeButton();
  updateBoard();
  updateUI();
}

// --- 対戦ゲーム初期化 ---
export function initPvPGame(isHost) {
  isSoloMode = false;
  isHostPlayer = isHost;
  myRole = isHost ? 'host' : 'guest';
  gameOver = false;
  scores = { host: 0, guest: 0 };
  currentTurn = 'host';
  openedInCurrentTurn = 0;
  currentInputMode = 'open';
  myFlags = Array(ROWS * COLS).fill(false);

  document.getElementById('mine-score-board').style.display = 'flex';
  const btnRematch = document.getElementById('btn-rematch-mine');
  if (btnRematch) btnRematch.style.display = 'none';

  if (isHostPlayer) {
    generateBoard();
    syncStateToGuest();
  }

  updateModeButton();
  updateBoard();
  updateUI();
}

// 盤面と爆弾の生成
function generateBoard() {
  board = Array(ROWS * COLS).fill(null).map(() => ({
    isBomb: false,
    isOpened: false,
    bombCount: 0
  }));

  let placed = 0;
  while (placed < BOMBS) {
    const idx = Math.floor(Math.random() * (ROWS * COLS));
    if (!board[idx].isBomb) {
      board[idx].isBomb = true;
      placed++;
    }
  }

  // 周囲の爆弾数を計算
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const idx = r * COLS + c;
      if (board[idx].isBomb) continue;

      let count = 0;
      getNeighbors(r, c).forEach(nIdx => {
        if (board[nIdx].isBomb) count++;
      });
      board[idx].bombCount = count;
    }
  }
}

function getNeighbors(r, c) {
  const neighbors = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = r + dr;
      const nc = c + dc;
      if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS) {
        neighbors.push(nr * COLS + nc);
      }
    }
  }
  return neighbors;
}

// モード切り替え（開く ↔ 旗）
export function toggleInputMode() {
  currentInputMode = (currentInputMode === 'open') ? 'flag' : 'open';
  updateModeButton();
}

function updateModeButton() {
  const btnMode = document.getElementById('btn-mine-mode');
  if (btnMode) {
    if (currentInputMode === 'open') {
      btnMode.innerText = "モード: ⛏️ 開く";
      btnMode.style.backgroundColor = "#4caf50";
    } else {
      btnMode.innerText = "モード: 🚩 旗を立てる";
      btnMode.style.backgroundColor = "#e91e63";
    }
  }
}

// マスクリック処理（右クリック対応）
function handleCellClick(index, isRightClick = false) {
  if (gameOver) return;

  // 1. 右クリック、または「旗モード」の場合（自分専用のメモ。通信は起こさない）
  if (isRightClick || currentInputMode === 'flag') {
    if (!board[index].isOpened) {
      myFlags[index] = !myFlags[index];
      playSound('flip');
      updateBoard();
      updateUI();
    }
    return;
  }

  // 2. 開くモード
  if (myFlags[index]) return; // 自分のメモ用の旗が立っているマスは誤タップ防止

  if (isSoloMode) {
    handleSoloOpen(index);
  } else {
    if (currentTurn !== myRole) return; // 自分のターンでなければ不可
    if (board[index].isOpened) return;

    const actionData = {
      type: "MINE_OPEN",
      payload: { index, player: myRole }
    };

    if (isHostPlayer) {
      processAction(actionData);
    } else {
      sendData(actionData);
    }
  }
}

// --- 一人用：マスオープン ---
function handleSoloOpen(index) {
  if (board[index].isOpened) return;

  board[index].isOpened = true;
  myFlags[index] = false;

  if (board[index].isBomb) {
    gameOver = true;
    playSound('win'); // ゲームオーバー演出
    revealAllBombs();
  } else {
    playSound('put');
    if (board[index].bombCount === 0) {
      autoOpenNeighbors(index);
    }
    checkSoloWin();
  }
  updateBoard();
  updateUI();
}

function checkSoloWin() {
  const unopenedNonBombs = board.filter(cell => !cell.isOpened && !cell.isBomb).length;
  if (unopenedNonBombs === 0) {
    gameOver = true;
    playSound('win');
  }
}

// --- 対戦用：アクション処理（ホストのみで実行） ---
export function processAction(data) {
  if (data.type === "MINE_END_TURN") {
    if (currentTurn === data.payload.player) {
      switchTurn();
    }
    return;
  }

  if (data.type === "MINE_OPEN") {
    const { index, player } = data.payload;
    if (player !== currentTurn || board[index].isOpened) return;

    board[index].isOpened = true;
    myFlags[index] = false;

    if (board[index].isBomb) {
      // ★ 爆弾を踏んだ：ペナルティで0点 ＆ ターン強制交替
      scores[player] = 0;
      playSound('flip');
      openedInCurrentTurn = 0;
      
      checkPvPGameEnd();
      if (!gameOver) {
        currentTurn = currentTurn === 'host' ? 'guest' : 'host';
      }
    } else {
      // 安全なマス：+1点（連鎖展開もすべて加算）
      const openedCount = 1 + (board[index].bombCount === 0 ? autoOpenNeighbors(index) : 0);
      scores[player] += openedCount;
      openedInCurrentTurn += openedCount;
      playSound('put');

      checkPvPGameEnd();
    }

    syncStateToGuest();
    updateBoard();
    updateUI();
  }
}

// 0マスの連鎖オープン
function autoOpenNeighbors(startIndex) {
  let openedCount = 0;
  const queue = [startIndex];

  while (queue.length > 0) {
    const currIdx = queue.shift();
    const r = Math.floor(currIdx / COLS);
    const c = currIdx % COLS;

    getNeighbors(r, c).forEach(nIdx => {
      if (!board[nIdx].isOpened && !board[nIdx].isBomb) {
        board[nIdx].isOpened = true;
        myFlags[nIdx] = false;
        openedCount++;
        if (board[nIdx].bombCount === 0) {
          queue.push(nIdx);
        }
      }
    });
  }
  return openedCount;
}

// ターン終了ボタンが押された時
export function endTurn() {
  if (isSoloMode || currentTurn !== myRole || openedInCurrentTurn === 0) return;

  const actionData = { type: "MINE_END_TURN", payload: { player: myRole } };
  if (isHostPlayer) {
    processAction(actionData);
  } else {
    sendData(actionData);
  }
}

function switchTurn() {
  currentTurn = currentTurn === 'host' ? 'guest' : 'host';
  openedInCurrentTurn = 0;
  syncStateToGuest();
  updateBoard();
  updateUI();
}

// ★ 対戦終了判定：すべての「爆弾以外のマス」が開いた場合
function checkPvPGameEnd() {
  const unopenedNonBombs = board.filter(cell => !cell.isOpened && !cell.isBomb).length;
  if (unopenedNonBombs === 0) {
    gameOver = true;
    revealAllBombs(); // 終了時に全爆弾を表示
    playSound('win');
  }
}

function revealAllBombs() {
  board.forEach(cell => {
    if (cell.isBomb) cell.isOpened = true;
  });
}

// 描画更新
function updateBoard() {
  const boardEl = document.getElementById('mine-board');
  if (!boardEl) return;

  boardEl.innerHTML = '';
  board.forEach((cell, index) => {
    const cellEl = document.createElement('div');
    cellEl.className = 'mine-cell';

    if (cell.isOpened) {
      cellEl.classList.add('opened');
      if (cell.isBomb) {
        cellEl.classList.add('bomb');
        cellEl.innerText = '💣';
      } else if (cell.bombCount > 0) {
        cellEl.innerText = cell.bombCount;
        cellEl.classList.add(`mine-num-${cell.bombCount}`);
      } else {
        cellEl.innerText = '';
      }
    } else {
      // 開いていないマス（自分の旗があれば優先表示）
      if (myFlags[index]) {
        cellEl.innerText = '🚩';
      } else {
        cellEl.innerText = '';
      }
      
      // 通常クリック（左クリック / タップ）
      cellEl.onclick = () => handleCellClick(index, false);
      
      // 右クリック（PC向け）
      cellEl.oncontextmenu = (e) => {
        e.preventDefault();
        handleCellClick(index, true);
      };
    }
    boardEl.appendChild(cellEl);
  });
}

function updateUI() {
  const turnText = document.getElementById('mine-turn-text');
  const btnEndTurn = document.getElementById('btn-mine-end-turn');
  const scoreHostEl = document.getElementById('mine-score-host');
  const scoreGuestEl = document.getElementById('mine-score-guest');
  const btnRematch = document.getElementById('btn-rematch-mine');
  const remainingCountEl = document.getElementById('mine-remaining-count');

  // ★ 残り爆弾数の表示更新（10 - 自分の立てている旗の数）
  if (remainingCountEl) {
    const flagCount = myFlags.filter(f => f).length;
    remainingCountEl.innerText = Math.max(0, BOMBS - flagCount);
  }

  if (!isSoloMode) {
    if (scoreHostEl) scoreHostEl.innerText = `ホスト: ${scores.host}点`;
    if (scoreGuestEl) scoreGuestEl.innerText = `ゲスト: ${scores.guest}点`;
  }

  if (gameOver) {
    if (btnRematch) btnRematch.style.display = 'inline-block';
    if (btnEndTurn) btnEndTurn.style.display = 'none';

    if (isSoloMode) {
      turnText.innerText = board.some(c => c.isBomb && c.isOpened) ? "💥 爆発！ゲームオーバー" : "🎉 クリアおめでとう！";
    } else {
      if (scores.host > scores.guest) {
        turnText.innerText = "🏆 ホストの勝ち！";
      } else if (scores.guest > scores.host) {
        turnText.innerText = "🏆 ゲストの勝ち！";
      } else {
        turnText.innerText = "🤝 引き分け！";
      }
    }
  } else {
    if (isSoloMode) {
      turnText.innerText = "💣 マインスイーパー (一人用)";
    } else {
      const turnName = currentTurn === 'host' ? 'ホスト' : 'ゲスト';
      turnText.innerText = (currentTurn === myRole) ? `🟢 あなたのターン (${turnName})` : `🔴 相手のターン (${turnName})`;

      // 最低1マス開けたら「ターン終了」ボタンを表示
      if (btnEndTurn) {
        if (currentTurn === myRole && openedInCurrentTurn > 0) {
          btnEndTurn.style.display = 'inline-block';
        } else {
          btnEndTurn.style.display = 'none';
        }
      }
    }
  }
}

export function updateGameState(payload) {
  if (!isHostPlayer && !isSoloMode) {
    board = payload.board;
    scores = payload.scores;
    currentTurn = payload.currentTurn;
    gameOver = payload.gameOver;
    openedInCurrentTurn = payload.openedInCurrentTurn;

    if (gameOver) playSound('win');

    updateBoard();
    updateUI();
  }
}

export function syncStateToGuest() {
  if (isHostPlayer && !isSoloMode) {
    sendData({
      type: "MINE_STATE_SYNC",
      payload: { board, scores, currentTurn, gameOver, openedInCurrentTurn }
    });
  }
}

export function requestRematch() {
  if (isSoloMode) {
    initSoloGame();
  } else {
    if (isHostPlayer) {
      initPvPGame(true);
      syncStateToGuest();
    } else {
      sendData({ type: "MINE_REMATCH" });
    }
  }
}