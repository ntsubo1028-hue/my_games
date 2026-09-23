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

const boardEl = document.getElementById('concentration-board');
const turnText = document.getElementById('concentration-turn-text');
const scoreHostEl = document.getElementById('concentration-score-host');
const scoreGuestEl = document.getElementById('concentration-score-guest');
const btnRematch = document.getElementById('btn-rematch-concentration');

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
  if (confirmationTimer) clearTimeout(confirmationTimer);
  btnRematch.style.display = 'none';

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
      // 自分のターンで、かつ処理中でなく、確認待ちでなければクリック可能
      if (isMyTurn && !gameOver && !isProcessing && !isWaitingForConfirmation) {
        cell.onclick = () => handleCardClick(index);
      }
    }
    boardEl.appendChild(cell);
  });
}

function updateUI() {
  scoreHostEl.innerText = `ホスト: ${scores.host}`;
  scoreGuestEl.innerText = `ゲスト: ${scores.guest}`;

  if (gameOver) {
    btnRematch.style.display = 'inline-block';
    if (scores.host > scores.guest) {
      turnText.innerText = "🏆 ホストの勝ち！";
    } else if (scores.guest > scores.host) {
      turnText.innerText = "🏆 ゲストの勝ち！";
    } else {
      turnText.innerText = "🤝 引き分け！";
    }
  } else {
    const turnName = currentTurn === 'host' ? 'ホスト' : 'ゲスト';
    if (isWaitingForConfirmation) {
      turnText.innerText = "👀 覚えるタイム（タップで閉じる / 5秒で自動）";
    } else {
      turnText.innerText = isMyTurn ? `🟢 あなたのターン (${turnName})` : `🔴 相手のターン (${turnName})`;
    }
  }
}

function handleCardClick(index) {
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

// 画面がタップされたとき（確認待ちを強制終了してカードを裏返す）
export function handleScreenTap() {
  if (!isWaitingForConfirmation) return;

  if (isHostPlayer) {
    closeMismatchCards();
  } else {
    // ゲストの場合はホストに確認完了を伝える
    sendData({ type: "CONCENTRATION_CONFIRM" });
  }
}

// 不一致だったカードを裏返し、次のターンへ進む処理
function closeMismatchCards() {
  if (!isWaitingForConfirmation) return;
  isWaitingForConfirmation = false;
  if (confirmationTimer) {
    clearTimeout(confirmationTimer);
    confirmationTimer = null;
  }

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

  // ゲストからの確認完了シグナルを受け取った場合
  if (data.type === "CONCENTRATION_CONFIRM") {
    if (isWaitingForConfirmation) {
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

    // ★ 2枚目がめくられた瞬間にも必ずゲストへ同期する（これでバグ解消）
    syncStateToGuest();
    updateBoard();
    updateUI();

    if (flippedIndices.length === 2) {
      isProcessing = true;
      const [firstIdx, secondIdx] = flippedIndices;

      if (board[firstIdx].symbol === board[secondIdx].symbol) {
        // 一致
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
        // 不一致：確認待ち状態へ移行（最大5秒、または画面タップで閉じる）
        isWaitingForConfirmation = true;
        updateUI();

        confirmationTimer = setTimeout(() => {
          closeMismatchCards();
        }, 5000); // 5秒後に自動で裏返す
      }
    }
  }
}

export function updateGameState(payload) {
  if (!isHostPlayer) {
    board = payload.board;
    scores = payload.scores;
    currentTurn = payload.currentTurn;
    gameOver = payload.gameOver;
    isWaitingForConfirmation = payload.isWaitingForConfirmation || false;
    isMyTurn = (currentTurn === myRole);

    if (gameOver) {
      playSound('win');
      btnRematch.style.display = 'inline-block';
    }

    updateBoard();
    updateUI();
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