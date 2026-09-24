import { sendData } from './connection.js';
import { playSound } from './sounds.js';

const ROWS = 8;
const COLS = 8;
const BOMBS = 10;
const TURN_TIME_LIMIT = 10; // 2手目以降の制限時間（秒）

let isSoloMode = false;
let isHostPlayer = false;
let myRole = 'host';

let board = []; // { isBomb, isOpened, bombCount }
let myFlags = []; // ローカル専用の旗保持

let scores = { host: 0, guest: 0 };
let currentTurn = 'host';
let gameOver = false;

let openedInCurrentTurn = 0; // 現在のターンで開けたマス数
let currentInputMode = 'open'; // 'open' または 'flag'

// タイマー制御用変数
let turnTimer = null;
let remainingTime = TURN_TIME_LIMIT;

// --- 一人用ゲーム初期化 ---
export function initSoloGame() {
  stopTurnTimer();
  isSoloMode = true;
  gameOver = false;
  currentInputMode = 'open';
  openedInCurrentTurn = 0;
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

// --- 対戦ゲーム初期化（再戦時もここを通る） ---
export function initPvPGame(isHost) {
  stopTurnTimer();
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

// マスクリック処理
function handleCellClick(index, isRightClick = false) {
  if (gameOver) return;

  // 右クリック、または「旗モード」
  if (isRightClick || currentInputMode === 'flag') {
    if (!board[index].isOpened) {
      myFlags[index] = !myFlags[index];
      playSound('flip');
      updateBoard();
      updateUI();
    }
    return;
  }

  if (myFlags[index]) return; // 自分の旗があるマスは誤タップ防止

  if (isSoloMode) {
    handleSoloOpen(index);
  } else {
    if (currentTurn !== myRole) return;
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

// 一人用：マスオープン
function handleSoloOpen(index) {
  if (board[index].isOpened) return;

  board[index].isOpened = true;
  myFlags[index] = false;

  if (board[index].isBomb) {
    gameOver = true;
    playSound('win');
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

// アクション処理（ホスト・対戦用）
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
      // 爆弾を踏んだ：0点 ＆ ターン交替
      scores[player] = 0;
      playSound('flip');
      stopTurnTimer();
      
      checkPvPGameEnd();
      if (!gameOver) {
        currentTurn = currentTurn === 'host' ? 'guest' : 'host';
        openedInCurrentTurn = 0;
      }
    } else {
      // 安全なマス
      const openedCount = 1 + (board[index].bombCount === 0 ? autoOpenNeighbors(index) : 0);
      scores[player] += openedCount;
      openedInCurrentTurn += openedCount;
      playSound('put');

      checkPvPGameEnd();

      // ★ 1マス以上開けたら10秒タイマー開始（リセット）
      if (!gameOver) {
        startTurnTimer();
      }
    }

    syncStateToGuest();
    updateBoard();
    updateUI();
  }
}

// タイマー制御
function startTurnTimer() {
  stopTurnTimer();
  remainingTime = TURN_TIME_LIMIT;
  updateTimerUI();

  turnTimer = setInterval(() => {
    remainingTime--;
    updateTimerUI();

    if (remainingTime <= 0) {
      stopTurnTimer();
      // 自分のターン中に制限時間切れになったら自動ターン終了
      if (currentTurn === myRole && !gameOver) {
        endTurn();
      }
    }
  }, 1000);
}

function stopTurnTimer() {
  if (turnTimer) {
    clearInterval(turnTimer);
    turnTimer = null;
  }
  const timerDisplay = document.getElementById('mine-timer-display');
  if (timerDisplay) timerDisplay.style.display = 'none';
}

function updateTimerUI() {
  const timerDisplay = document.getElementById('mine-timer-display');
  const timerSec = document.getElementById('mine-timer-sec');
  if (timerDisplay && timerSec) {
    if (openedInCurrentTurn > 0 && !gameOver) {
      timerDisplay.style.display = 'inline';
      timerSec.innerText = remainingTime;
    } else {
      timerDisplay.style.display = 'none';
    }
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

// ターン終了ボタン押下時
export function endTurn() {
  if (isSoloMode || currentTurn !== myRole || openedInCurrentTurn === 0) return;

  stopTurnTimer();
  const actionData = { type: "MINE_END_TURN", payload: { player: myRole } };
  if (isHostPlayer) {
    processAction(actionData);
  } else {
    sendData(actionData);
  }
}

function switchTurn() {
  stopTurnTimer();
  currentTurn = currentTurn === 'host' ? 'guest' : 'host';
  openedInCurrentTurn = 0;
  syncStateToGuest();
  updateBoard();
  updateUI();
}

function checkPvPGameEnd() {
  const unopenedNonBombs = board.filter(cell => !cell.isOpened && !cell.isBomb).length;
  if (unopenedNonBombs === 0) {
    gameOver = true;
    stopTurnTimer();
    revealAllBombs();
    playSound('win');
  }
}

function revealAllBombs() {
  board.forEach(cell => {
    if (cell.isBomb) cell.isOpened = true;
  });
}

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
      if (myFlags[index]) {
        cellEl.innerText = '🚩';
      } else {
        cellEl.innerText = '';
      }
      
      cellEl.onclick = () => handleCellClick(index, false);
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

  if (remainingCountEl) {
    const flagCount = myFlags.filter(f => f).length;
    remainingCountEl.innerText = Math.max(0, BOMBS - flagCount);
  }

  if (!isSoloMode) {
    if (scoreHostEl) scoreHostEl.innerText = `ホスト: ${scores.host}点`;
    if (scoreGuestEl) scoreGuestEl.innerText = `ゲスト: ${scores.guest}点`;
  }

  if (gameOver) {
    stopTurnTimer();
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

// ゲスト側の同期受信処理（再戦時のフラグリセット等も対応）
export function updateGameState(payload) {
  if (!isHostPlayer && !isSoloMode) {
    // 再戦が始まった場合（前回gameOverで今回gameOverがfalseになった場合）のローカル初期化
    if (gameOver && !payload.gameOver) {
      myFlags = Array(ROWS * COLS).fill(false);
      stopTurnTimer();
    }

    board = payload.board;
    scores = payload.scores;
    currentTurn = payload.currentTurn;
    gameOver = payload.gameOver;
    openedInCurrentTurn = payload.openedInCurrentTurn;

    // 相手がマスを開けてタイマーが発生している場合、ローカルのタイマーも同期開始
    if (openedInCurrentTurn > 0 && !gameOver) {
      startTurnTimer();
    } else {
      stopTurnTimer();
    }

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

// ★ 再戦要求処理（ホスト・ゲスト共に正しく盤面とUIをクリアして再起動）
export function requestRematch() {
  if (isSoloMode) {
    initSoloGame();
  } else {
    if (isHostPlayer) {
      initPvPGame(true);
    } else {
      sendData({ type: "MINE_REMATCH" });
    }
  }
}