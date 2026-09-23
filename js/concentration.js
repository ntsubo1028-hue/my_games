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
      if (isMyTurn && !gameOver && !isProcessing) {
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
    turnText.innerText = isMyTurn ? `🟢 あなたのターン (${turnName})` : `🔴 相手のターン (${turnName})`;
  }
}

function handleCardClick(index) {
  if (!isMyTurn || gameOver || isProcessing) return;
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

export function processAction(data) {
  if (!isHostPlayer) return;

  if (data.type === "CONCENTRATION_FLIP") {
    const { index, player } = data.payload;
    if (player !== currentTurn) return;
    if (board[index].isFlipped || board[index].isMatched) return;

    board[index].isFlipped = true;
    flippedIndices.push(index);
    playSound('flip');

    updateBoard();

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
        setTimeout(() => {
          board[firstIdx].isFlipped = false;
          board[secondIdx].isFlipped = false;
          flippedIndices = [];
          currentTurn = currentTurn === 'host' ? 'guest' : 'host';
          isMyTurn = (currentTurn === myRole);
          isProcessing = false;

          syncStateToGuest();
          updateBoard();
          updateUI();
        }, 1000);
      }
    } else {
      syncStateToGuest();
    }
  }
}

export function updateGameState(payload) {
  if (!isHostPlayer) {
    board = payload.board;
    scores = payload.scores;
    currentTurn = payload.currentTurn;
    gameOver = payload.gameOver;
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
      payload: { board, scores, currentTurn, gameOver }
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