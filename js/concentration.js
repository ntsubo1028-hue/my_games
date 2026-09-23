import { sendData } from './connection.js';
import { playSound } from './sounds.js';

let isHostPlayer = false;
let isMyTurn = false;
let myRole = 'host'; 
let board = []; 
let flippedIndices = []; 
let scores = { host: 0, guest: 0 };
let currentTurn = 'host'; 
let gameOver = false;
let isProcessing = false; 

// 不一致時の確認待ち用変数
let isWaitingForConfirmation = false;
let confirmationTimer = null;

const SYMBOLS = ['🍎', '🍊', '🍇', '🍓', '🍉', '🍒', '🍍', '🥝'];

export function initGame(isHost) {
  isHostPlayer = isHost;
  myRole = isHost ? 'host' : 'guest';
  gameOver = false;
  scores = { host: 0, guest: 0 };
  currentTurn = 'host';
  isMyTurn = isHost;
  flippedIndices = [];
  isProcessing = false;
  isWaitingForConfirmation = false;
  clearConfirmationTimer();

  const btnRematch = document.getElementById('btn-rematch-concentration');
  if (btnRematch) btnRematch.style.display = 'none';

  if (isHostPlayer) {
    let cardSymbols = [...SYMBOLS, ...SYMBOLS]; 
    for (let i = cardSymbols.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [cardSymbols[i], cardSymbols[j]] = [cardSymbols[j], cardSymbols[i]];
    }
    board = cardSymbols.map((symbol, index) => ({
      id: index,
      symbol: symbol,
      isFlipped: false,
      isMatched: false
    }));
    syncStateToGuest();
  } else {
    board = Array(16).fill(null).map((_, i) => ({ id: i, symbol: '?', isFlipped: false, isMatched: false }));
  }

  updateBoard();
  updateUI();
}

function updateBoard() {
  const boardEl = document.getElementById('concentration-board');
  if (!boardEl) return;

  boardEl.innerHTML = '';
  board.forEach((card, index) => {
    const cell = document.createElement('div');
    cell.className = 'concentration-card';
    
    if (card.isMatched) {
      cell.classList.add('matched');
      cell.innerText = card.symbol;
    } else if (card.isFlipped) {
      cell.classList.add('flipped');
      cell.innerText = card.symbol;
    } else {
      cell.classList.add('hidden');
      cell.innerText = '❓';
      if (isMyTurn && !gameOver && !isProcessing && !isWaitingForConfirmation) {
        // ★ e（イベント）を受け取って渡す
        cell.onclick = (e) => handleCardClick(index, e);
      }
    }
    boardEl.appendChild(cell);
  });
}

function updateUI() {
  const scoreHostEl = document.getElementById('concentration-score-host');
  const scoreGuestEl = document.getElementById('concentration-score-guest');
  const turnText = document.getElementById('concentration-turn-text');
  const btnRematch = document.getElementById('btn-rematch-concentration');

  if (scoreHostEl) scoreHostEl.innerText = `ホスト: ${scores.host}`;
  if (scoreGuestEl) scoreGuestEl.innerText = `ゲスト: ${scores.guest}`;

  if (gameOver) {
    if (btnRematch) btnRematch.style.display = 'inline-block';
    if (turnText) {
      if (scores.host > scores.guest) {
        turnText.innerText = "🏆 ホストの勝ち！";
      } else if (scores.guest > scores.host) {
        turnText.innerText = "🏆 ゲストの勝ち！";
      } else {
        turnText.innerText = "🤝 引き分け！";
      }
    }
  } else {
    const turnName = currentTurn === 'host' ? 'ホスト' : 'ゲスト';
    if (turnText) {
      if (isWaitingForConfirmation) {
        // ★ 自分のターンか相手のターンかで表示を分ける
        if (currentTurn === myRole) {
          turnText.innerText = "👀 覚えるタイム（タップで閉じる / 5秒で自動）";
        } else {
          turnText.innerText = "👀 相手が覚えています...";
        }
      } else {
        turnText.innerText = isMyTurn ? `🟢 あなたのターン (${turnName})` : `🔴 相手のターン (${turnName})`;
      }
    }
  }
}

function handleCardClick(index, e) {
  if (e) e.stopPropagation(); // ★ イベントの貫通（バブリング）を防ぎ、即時終了を回避する
  
  if (!isMyTurn || gameOver || isProcessing || isWaitingForConfirmation) return;
  if (board[index].isFlipped || board[index].isMatched) return;

  const actionData = {
    type: "CONCENTRATION_FLIP",
    payload: { index, player: myRole }
  };

  if (isHostPlayer) {
    processAction(actionData);
  } else {
    sendData(actionData);
  }
}

// ★ タイマー管理関数
function startConfirmationTimer() {
  clearConfirmationTimer();
  confirmationTimer = setTimeout(() => {
    if (isHostPlayer) {
      closeMismatchCards();
    } else {
      sendData({ type: "CONCENTRATION_CONFIRM" });
    }
  }, 5000);
}

function clearConfirmationTimer() {
  if (confirmationTimer) {
    clearTimeout(confirmationTimer);
    confirmationTimer = null;
  }
}

export function handleScreenTap() {
  if (!isWaitingForConfirmation) return;
  
  // ★ 自分のターンでない時は画面をタップしても無視する
  if (currentTurn !== myRole) return;

  clearConfirmationTimer();

  if (isHostPlayer) {
    closeMismatchCards();
  } else {
    sendData({ type: "CONCENTRATION_CONFIRM" });
  }
}

function closeMismatchCards() {
  if (!isWaitingForConfirmation) return;
  isWaitingForConfirmation = false;
  clearConfirmationTimer();

  if (flippedIndices.length === 2) {
    const [firstIdx, secondIdx] = flippedIndices;
    board[firstIdx].isFlipped = false;
    board[secondIdx].isFlipped = false;
  }
  flippedIndices = [];
  currentTurn = currentTurn === 'host' ? 'guest' : 'host';
  isMyTurn = (currentTurn === myRole);
  isProcessing = false;

  syncStateToGuest();
  updateBoard();
  updateUI();
}

export function processAction(data) {
  if (!isHostPlayer) return;

  if (data.type === "CONCENTRATION_CONFIRM") {
    // ゲストからの確認完了シグナル
    if (isWaitingForConfirmation && currentTurn === 'guest') {
      closeMismatchCards();
    }
    return;
  }

  if (data.type === "CONCENTRATION_FLIP") {
    const { index, player } = data.payload;
    if (player !== currentTurn || isWaitingForConfirmation) return;
    if (board[index].isFlipped || board[index].isMatched) return;

    board[index].isFlipped = true;
    flippedIndices.push(index);
    playSound('flip');

    syncStateToGuest();
    updateBoard();
    updateUI();

    if (flippedIndices.length === 2) {
      isProcessing = true;
      const [firstIdx, secondIdx] = flippedIndices;

      if (board[firstIdx].symbol === board[secondIdx].symbol) {
        board[firstIdx].isMatched = true;
        board[secondIdx].isMatched = true;
        scores[currentTurn]++;
        playSound('put');
        flippedIndices = [];
        isProcessing = false;

        if (scores.host + scores.guest === 8) {
          gameOver = true;
          playSound('win');
        }
        syncStateToGuest();
        updateBoard();
        updateUI();
      } else {
        isWaitingForConfirmation = true;
        updateUI();

        // ★ 自分のターン（ホストのターン）の時だけホスト側でタイマーを開始
        if (currentTurn === myRole) {
          startConfirmationTimer();
        }
      }
    }
  }
}

export function updateGameState(payload) {
  if (!isHostPlayer) {
    board = payload.board;
    scores = payload.scores;
    
    const previousWaiting = isWaitingForConfirmation;
    
    currentTurn = payload.currentTurn;
    gameOver = payload.gameOver;
    isWaitingForConfirmation = payload.isWaitingForConfirmation || false;
    isMyTurn = (currentTurn === myRole);

    if (gameOver) {
      playSound('win');
      const btnRematch = document.getElementById('btn-rematch-concentration');
      if (btnRematch) btnRematch.style.display = 'inline-block';
    }

    updateBoard();
    updateUI();

    // ★ ゲストのターンの時に新しく「確認待ち」状態になったら、ゲスト側でタイマーを開始
    if (!previousWaiting && isWaitingForConfirmation && currentTurn === myRole) {
      startConfirmationTimer();
    }
  }
}

export function syncStateToGuest() {
  if (isHostPlayer) {
    sendData({
      type: "CONCENTRATION_STATE_SYNC",
      payload: { board, scores, currentTurn, gameOver, isWaitingForConfirmation }
    });
  }
}

export function requestRematch() {
  if (isHostPlayer) {
    initGame(true);
    syncStateToGuest();
  } else {
    sendData({ type: "CONCENTRATION_REMATCH" });
  }
}