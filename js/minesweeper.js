import { sendData } from './connection.js';
import { playSound } from './sounds.js';
import { currentGameState } from './lobby.js';
import { openRankingRegisterModal } from './ranking.js'; // ★ ランキング登録モーダルのインポート

const ROWS = 8;
const COLS = 8;
const BOMBS = 10;
const TURN_TIME_LIMIT = 10;

let isSoloMode = false;
let isHostPlayer = false;

let board = [];
let myFlags = [];

let players = [];
let currentTurnIndex = 0;
let gameOver = false;
let isWin = false;

let openedInCurrentTurn = 0;
let currentInputMode = 'open';

let turnTimer = null;
let remainingTime = TURN_TIME_LIMIT;

// 一人用タイマー・タイムアタック用変数
let soloTimerInterval = null;
let soloElapsedTime = 0;
let isSoloTimerRunning = false;

const PLAYER_COLORS = ['#d32f2f', '#1976d2', '#388e3c', '#f57c00'];

// --- 一人用ゲーム初期化 ---
export function initSoloGame() {
  stopTurnTimer();
  stopSoloTimer(); // 一人用タイマーの停止・リセット
  isSoloMode = true;
  gameOver = false;
  isWin = false;
  currentInputMode = 'open';
  openedInCurrentTurn = 0;
  myFlags = Array(ROWS * COLS).fill(false);
  soloElapsedTime = 0;

  generateBoard();
  
  const scoreBoard = document.getElementById('mine-score-board');
  if (scoreBoard) scoreBoard.style.display = 'none';
  
  const btnEndTurn = document.getElementById('btn-mine-end-turn');
  if (btnEndTurn) {
    btnEndTurn.style.display = 'none';
    btnEndTurn.style.visibility = 'hidden';
  }

  const btnRematch = document.getElementById('btn-rematch-mine');
  if (btnRematch) btnRematch.style.display = 'none';

  updateModeButton();
  updateBoard();
  updateUI();
}

// スコアやタイムを取り出せるようにするエクスポート関数
export function getSoloMinesweeperStats() {
  return {
    isCleared: isSoloMode && isWin && gameOver,
    time: (isSoloMode && isWin && gameOver) ? soloElapsedTime : null
  };
}

// --- 対戦ゲーム初期化 ---
export function initPvPGame(isHost) {
  stopTurnTimer();
  stopSoloTimer();
  isSoloMode = false;
  isHostPlayer = isHost;
  gameOver = false;
  isWin = false;
  openedInCurrentTurn = 0;
  currentInputMode = 'open';
  myFlags = Array(ROWS * COLS).fill(false);

  if (currentGameState && currentGameState.slots) {
    const activeSlots = currentGameState.slots.filter(s => s.type !== 'none');
    if (activeSlots.length > 0) {
      players = activeSlots.map((s, idx) => ({
        slotId: s.slotId,
        connId: s.connId || `player-${idx}`,
        name: s.name || `${idx + 1}P`,
        score: 0
      }));
    } else {
      players = [
        { slotId: 0, connId: 'host', name: '1P (ホスト)', score: 0 },
        { slotId: 1, connId: 'guest-1', name: '2P', score: 0 },
        { slotId: 2, connId: 'guest-2', name: '3P', score: 0 },
        { slotId: 3, connId: 'guest-3', name: '4P', score: 0 }
      ];
    }
  } else {
    players = [
      { slotId: 0, connId: 'host', name: '1P (ホスト)', score: 0 },
      { slotId: 1, connId: 'guest-1', name: '2P', score: 0 },
      { slotId: 2, connId: 'guest-2', name: '3P', score: 0 },
      { slotId: 3, connId: 'guest-3', name: '4P', score: 0 }
    ];
  }

  currentTurnIndex = 0;

  const scoreBoard = document.getElementById('mine-score-board');
  if (scoreBoard) scoreBoard.style.display = 'flex';

  const btnEndTurn = document.getElementById('btn-mine-end-turn');
  if (btnEndTurn) {
    btnEndTurn.style.display = 'inline-block';
    btnEndTurn.style.visibility = 'hidden';
    btnEndTurn.style.pointerEvents = 'none';
  }

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

function isMyTurn() {
  if (isSoloMode) return true;
  if (!players || players.length === 0) return false;
  const myConnId = currentGameState ? currentGameState.myConnId : (isHostPlayer ? 'host' : 'guest');
  return players[currentTurnIndex] && players[currentTurnIndex].connId === myConnId;
}

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

function handleCellClick(index, isRightClick = false) {
  if (gameOver) return;

  if (isRightClick || currentInputMode === 'flag') {
    if (!board[index].isOpened) {
      myFlags[index] = !myFlags[index];
      playSound('flip');
      updateBoard();
      updateUI();
    }
    return;
  }

  if (myFlags[index]) return;

  if (isSoloMode) {
    handleSoloOpen(index);
  } else {
    if (!isMyTurn() || board[index].isOpened) return;

    const myConnId = currentGameState ? currentGameState.myConnId : (isHostPlayer ? 'host' : 'guest');
    const actionData = {
      type: "MINE_OPEN",
      payload: { index, connId: myConnId }
    };

    if (isHostPlayer) {
      processAction(actionData);
    } else {
      sendData(actionData);
    }
  }
}

// --- 一人用タイマー制御 ---
function startSoloTimer() {
  if (isSoloTimerRunning) return;
  isSoloTimerRunning = true;
  soloElapsedTime = 0;
  
  soloTimerInterval = setInterval(() => {
    soloElapsedTime++;
    updateTimerUI();
  }, 1000);
}

function stopSoloTimer() {
  if (soloTimerInterval) {
    clearInterval(soloTimerInterval);
    soloTimerInterval = null;
  }
  isSoloTimerRunning = false;
}

// 一人用：マスオープン
function handleSoloOpen(index) {
  if (board[index].isOpened) return;

  // 最初のパネルを開いた瞬間にタイマーを発動
  if (!isSoloTimerRunning && !gameOver) {
    startSoloTimer();
  }

  board[index].isOpened = true;
  myFlags[index] = false;

  if (board[index].isBomb) {
    gameOver = true;
    isWin = false; 
    stopSoloTimer(); // 失敗したらタイマー停止
    playSound('win');
    revealAllBombs();
  } else {
    playSound('put');
    if (board[index].bombCount === 0) {
      autoOpenNeighbors(index);
    }
    checkGameEnd();
    if (gameOver && isWin) {
      stopSoloTimer(); // クリア成功したらタイマー停止
    }
  }
  updateBoard();
  updateUI();
}

export function processAction(data) {
  if (!isHostPlayer) return;

  if (data.type === "MINE_END_TURN") {
    const currPlayer = players[currentTurnIndex];
    if (currPlayer && currPlayer.connId === data.payload.connId) {
      switchTurn();
    }
    return;
  }

  if (data.type === "MINE_OPEN") {
    const { index, connId } = data.payload;
    const currPlayer = players[currentTurnIndex];
    if (!currPlayer || currPlayer.connId !== connId || board[index].isOpened) return;

    board[index].isOpened = true;
    myFlags[index] = false;

    if (board[index].isBomb) {
      currPlayer.score = 0;
      playSound('flip');
      stopTurnTimer();
      
      checkGameEnd();
      if (!gameOver) {
        currentTurnIndex = (currentTurnIndex + 1) % players.length;
        openedInCurrentTurn = 0;
      }
    } else {
      const openedCount = 1 + (board[index].bombCount === 0 ? autoOpenNeighbors(index) : 0);
      currPlayer.score += openedCount;
      openedInCurrentTurn += openedCount;
      playSound('put');

      checkGameEnd();

      if (!gameOver) {
        startTurnTimer();
      }
    }

    syncStateToGuest();
    updateBoard();
    updateUI();
  }
}

function startTurnTimer() {
  stopTurnTimer();
  remainingTime = TURN_TIME_LIMIT;

  if (isHostPlayer) {
    turnTimer = setInterval(() => {
      remainingTime--;
      updateTimerUI();
      syncStateToGuest();

      if (remainingTime <= 0) {
        stopTurnTimer();
        if (isMyTurn() && !gameOver) {
          endTurn();
        }
      }
    }, 1000);
  }

  updateTimerUI();
}

function stopTurnTimer() {
  if (turnTimer) {
    clearInterval(turnTimer);
    turnTimer = null;
  }
  updateTimerUI();
}

function updateTimerUI() {
  const timerDisplay = document.getElementById('mine-timer-display');
  const timerSec = document.getElementById('mine-timer-sec');
  
  if (timerDisplay && timerSec) {
    if (isSoloMode) {
      timerDisplay.style.display = 'inline';
      timerSec.innerText = soloElapsedTime;
    } else if (!isSoloMode && openedInCurrentTurn > 0 && !gameOver) {
      timerDisplay.style.display = 'inline';
      timerSec.innerText = Math.max(0, remainingTime);
    } else {
      timerDisplay.style.display = 'none';
    }
  }
}

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

export function endTurn() {
  if (isSoloMode || !isMyTurn() || openedInCurrentTurn === 0) return;

  stopTurnTimer();
  const myConnId = currentGameState ? currentGameState.myConnId : (isHostPlayer ? 'host' : 'guest');
  const actionData = { type: "MINE_END_TURN", payload: { connId: myConnId } };
  
  if (isHostPlayer) {
    processAction(actionData);
  } else {
    sendData(actionData);
  }
}

function switchTurn() {
  stopTurnTimer();
  if (players.length > 0) {
    currentTurnIndex = (currentTurnIndex + 1) % players.length;
  }
  openedInCurrentTurn = 0;
  syncStateToGuest();
  updateBoard();
  updateUI();
}

function checkGameEnd() {
  const isAllSafeOpened = board.every(cell => cell.isBomb || cell.isOpened);
  if (isAllSafeOpened) {
    gameOver = true;
    isWin = true;
    stopTurnTimer();
    stopSoloTimer(); // クリア時に一人用タイマーを確定
    revealAllBombs();
    playSound('win');

    // ★ 一人用モードでクリアしたとき、ランキング登録モーダルを呼び出す
    if (isSoloMode) {
      const stats = getSoloMinesweeperStats();
      if (stats.isCleared && stats.time !== null) {
        openRankingRegisterModal('minesweeper', stats.time);
      }
    }
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
  const scoreBoardEl = document.getElementById('mine-score-board');
  const btnRematch = document.getElementById('btn-rematch-mine');
  const remainingCountEl = document.getElementById('mine-remaining-count');

  if (remainingCountEl) {
    const flagCount = myFlags.filter(f => f).length;
    let remaining = BOMBS;

    if (isSoloMode) {
      remaining -= flagCount;
    } else {
      const openedBombsCount = board.filter(cell => cell.isOpened && cell.isBomb).length;
      remaining -= (flagCount + openedBombsCount);
    }

    remainingCountEl.innerText = Math.max(0, remaining);
  }

  if (!isSoloMode && scoreBoardEl && players.length > 0) {
    scoreBoardEl.innerHTML = players.map((p, idx) => {
      const color = PLAYER_COLORS[idx % PLAYER_COLORS.length];
      const isCurrent = (!gameOver && idx === currentTurnIndex);
      const style = isCurrent 
        ? `color: ${color}; font-weight: bold; border-bottom: 2px solid ${color}; padding-bottom: 2px;` 
        : `color: ${color}; opacity: 0.85;`;
      return `<span style="${style}">${p.name}: ${p.score}点</span>`;
    }).join(' ');
  }

  const currPlayer = players[currentTurnIndex];
  const currName = currPlayer ? currPlayer.name : '';
  const myTurn = isMyTurn();
  const currentColor = PLAYER_COLORS[currentTurnIndex % PLAYER_COLORS.length];

  if (gameOver) {
    stopTurnTimer();
    stopSoloTimer();
    if (btnRematch) btnRematch.style.display = 'inline-block';
    if (btnEndTurn) {
      btnEndTurn.style.visibility = 'hidden';
      btnEndTurn.style.pointerEvents = 'none';
    }

    if (isSoloMode) {
      if (turnText) {
        turnText.innerText = isWin ? `🎉 クリア！ タイム: ${soloElapsedTime}秒` : "💥 爆発！ゲームオーバー (タイムノーカウント)";
      }
    } else {
      if (turnText && players.length > 0) {
        const maxScore = Math.max(...players.map(p => p.score));
        const winners = players.filter(p => p.score === maxScore);
        if (winners.length === 1) {
          turnText.innerHTML = `🏆 ${winners[0].name} の勝ち！`;
        } else {
          const winnerNames = winners.map(w => w.name).join('・');
          turnText.innerHTML = `🤝 引き分け！ (${winnerNames})`;
        }
      }
    }
  } else {
    if (isSoloMode) {
      if (turnText) turnText.innerText = "💣 マインスイーパー (タイムアタック)";
    } else {
      if (turnText) {
        turnText.innerHTML = myTurn 
          ? `<span style="color: ${currentColor};">●</span> <span style="color: ${currentColor};">あなたのターン</span>` 
          : `<span style="color: ${currentColor};">●</span> <span style="color: ${currentColor};">${currName} のターン</span>`;
      }

      if (btnEndTurn) {
        if (myTurn && openedInCurrentTurn > 0) {
          btnEndTurn.style.visibility = 'visible';
          btnEndTurn.style.pointerEvents = 'auto';
        } else {
          btnEndTurn.style.visibility = 'hidden';
          btnEndTurn.style.pointerEvents = 'none';
        }
      }
    }
  }

  updateTimerUI();
}

export function updateGameState(payload) {
  if (!isHostPlayer && !isSoloMode) {
    if (gameOver && !payload.gameOver) {
      myFlags = Array(ROWS * COLS).fill(false);
      stopTurnTimer();
    }

    board = payload.board;
    players = payload.players || players;
    currentTurnIndex = payload.currentTurnIndex;
    gameOver = payload.gameOver;
    openedInCurrentTurn = payload.openedInCurrentTurn;

    if (payload.remainingTime !== undefined) {
      remainingTime = payload.remainingTime;
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
      payload: { board, players, currentTurnIndex, gameOver, openedInCurrentTurn, remainingTime }
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