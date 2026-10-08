import { sendData } from './connection.js';
import { playSound } from './sounds.js';
import { currentGameState } from './lobby.js';

const ROWS = 8;
const COLS = 8;
const BOMBS = 10;
const TURN_TIME_LIMIT = 10; // 2手目以降の制限時間（秒）

let isSoloMode = false;
let isHostPlayer = false;

let board = []; // { isBomb, isOpened, bombCount }
let myFlags = []; // ローカル専用の旗保持

let players = []; // プレイヤーリスト { slotId, connId, name, score }
let currentTurnIndex = 0;
let gameOver = false;

let openedInCurrentTurn = 0; // 現在のターンで開けたマス数
let currentInputMode = 'open'; // 'open' または 'flag'

// タイマー制御用変数
let turnTimer = null;
let remainingTime = TURN_TIME_LIMIT;

const PLAYER_COLORS = ['#d32f2f', '#1976d2', '#388e3c', '#f57c00'];

// --- 一人用ゲーム初期化 ---
export function initSoloGame() {
  stopTurnTimer();
  isSoloMode = true;
  gameOver = false;
  currentInputMode = 'open';
  openedInCurrentTurn = 0;
  myFlags = Array(ROWS * COLS).fill(false);

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

// --- 対戦ゲーム初期化（再戦時もここを通る） ---
export function initPvPGame(isHost) {
  stopTurnTimer();
  isSoloMode = false;
  isHostPlayer = isHost;
  gameOver = false;
  openedInCurrentTurn = 0;
  currentInputMode = 'open';
  myFlags = Array(ROWS * COLS).fill(false);

  // ロビーの参加スロット情報からプレイヤーリストを生成（最大4人対応）
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
    btnEndTurn.style.display = 'inline-block'; // 表示用の配置枠を確保
    btnEndTurn.style.visibility = 'hidden';   // 最初は透明・操作不可
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

// モジュール内での自分のターン判定
function isMyTurn() {
  if (isSoloMode) return true;
  if (!players || players.length === 0) return false;
  const myConnId = currentGameState ? currentGameState.myConnId : (isHostPlayer ? 'host' : 'guest');
  return players[currentTurnIndex] && players[currentTurnIndex].connId === myConnId;
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
    checkGameEnd();
  }
  updateBoard();
  updateUI();
}

// アクション処理（ホスト・対戦用）
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
      // 爆弾を踏んだ：0点 ＆ 次のプレイヤーへターン交替
      currPlayer.score = 0;
      playSound('flip');
      stopTurnTimer();
      
      checkGameEnd();
      if (!gameOver) {
        currentTurnIndex = (currentTurnIndex + 1) % players.length;
        openedInCurrentTurn = 0;
      }
    } else {
      // 安全なマス
      const openedCount = 1 + (board[index].bombCount === 0 ? autoOpenNeighbors(index) : 0);
      currPlayer.score += openedCount;
      openedInCurrentTurn += openedCount;
      playSound('put');

      checkGameEnd();

      // 1マス以上開けたら10秒タイマー開始（リセット）
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

  // ホストのみタイマーを回す
  if (isHostPlayer) {
    turnTimer = setInterval(() => {
      remainingTime--;
      updateTimerUI();
      syncStateToGuest(); // ゲスト側に残り時間を毎秒同期

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
    // turnTimer !== null の制限を解除し、マスが開けられていれば常に表示
    if (!isSoloMode && openedInCurrentTurn > 0 && !gameOver) {
      timerDisplay.style.display = 'inline';
      timerSec.innerText = Math.max(0, remainingTime);
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

// 勝敗・ゲーム終了チェック（爆弾以外のマスがすべて開いたか）
function checkGameEnd() {
  const isAllSafeOpened = board.every(cell => cell.isBomb || cell.isOpened);
  if (isAllSafeOpened) {
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

  // 多人数スコアボードの更新とプレイヤーカラーの適用
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
    if (btnRematch) btnRematch.style.display = 'inline-block';
    if (btnEndTurn) {
      btnEndTurn.style.visibility = 'hidden';
      btnEndTurn.style.pointerEvents = 'none';
    }

    if (isSoloMode) {
      if (turnText) {
        turnText.innerText = board.some(c => c.isBomb && c.isOpened) ? "💥 爆発！ゲームオーバー" : "🎉 クリアおめでとう！";
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
      if (turnText) turnText.innerText = "💣 マインスイーパー (一人用)";
    } else {
      if (turnText) {
        turnText.innerHTML = myTurn 
          ? `<span style="color: ${currentColor};">●</span> <span style="color: ${currentColor};">あなたのターン</span>` 
          : `<span style="color: ${currentColor};">●</span> <span style="color: ${currentColor};">${currName} のターン</span>`;
      }

      /* ターン終了ボタンの表示制御 */
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

// ゲスト側の同期受信処理
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

// 再戦要求処理
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