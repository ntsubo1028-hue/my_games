// concentration.js
import { sendData } from './connection.js';
import { playSound } from './sounds.js';
import { currentGameState } from './lobby.js';

let isHostPlayer = false;
let board = []; 
let flippedIndices = []; 
let players = []; 
let currentTurnIndex = 0; 
let gameOver = false;
let isProcessing = false; 

let isWaitingForConfirmation = false;
let confirmationTimer = null;
let remainingSeconds = 5;     // ★ 残り秒数管理用変数
let countdownInterval = null;  // ★ カウントダウン用インターバル

const SYMBOLS = ['🍎', '🍊', '🍇', '🍓', '🍉', '🍒', '🍍', '🥝'];
const PLAYER_COLORS = ['#d32f2f', '#1976d2', '#388e3c', '#f57c00']; 

export function initGame(isHost) {
  isHostPlayer = isHost;
  gameOver = false;
  flippedIndices = [];
  isProcessing = false;
  isWaitingForConfirmation = false;
  clearConfirmationTimer();

  // ロビーの参加スロット情報からプレイヤーリストを生成
  if (currentGameState && currentGameState.slots) {
    const activeSlots = currentGameState.slots.filter(s => s.type !== 'empty');
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

function isMyTurn() {
  if (!players || players.length === 0) return false;
  const myConnId = currentGameState ? currentGameState.myConnId : (isHostPlayer ? 'host' : 'guest');
  return players[currentTurnIndex] && players[currentTurnIndex].connId === myConnId;
}

function updateBoard() {
  const boardEl = document.getElementById('concentration-board');
  if (!boardEl) return;

  boardEl.innerHTML = '';
  const myTurn = isMyTurn();

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
      if (myTurn && !gameOver && !isProcessing && !isWaitingForConfirmation) {
        cell.onclick = (e) => handleCardClick(index, e);
      }
    }
    boardEl.appendChild(cell);
  });
}

function updateUI() {
  const scoreBoardEl = document.getElementById('concentration-score-board');
  const turnText = document.getElementById('concentration-turn-text');
  const btnRematch = document.getElementById('btn-rematch-concentration');

  if (scoreBoardEl && players.length > 0) {
    scoreBoardEl.innerHTML = players.map((p, idx) => {
      const color = PLAYER_COLORS[idx % PLAYER_COLORS.length];
      const isCurrent = (!gameOver && idx === currentTurnIndex);
      const style = isCurrent 
        ? `color: ${color}; font-weight: bold; border-bottom: 2px solid ${color}; padding-bottom: 2px;` 
        : `color: ${color}; opacity: 0.85;`;
      return `<span style="${style}">${p.name}: ${p.score}</span>`;
    }).join(' ');
  }

  const currPlayer = players[currentTurnIndex];
  const currName = currPlayer ? currPlayer.name : '';
  const myTurn = isMyTurn();
  
  const currentColor = PLAYER_COLORS[currentTurnIndex % PLAYER_COLORS.length];

  if (gameOver) {
    if (btnRematch) btnRematch.style.display = isHostPlayer ? 'inline-block' : 'none';
    if (turnText) {
      const maxScore = Math.max(...players.map(p => p.score));
      const winners = players.filter(p => p.score === maxScore);
      if (winners.length === 1) {
        turnText.innerHTML = `🏆 ${winners[0].name} の勝ち！`;
      } else {
        const winnerNames = winners.map(w => w.name).join('・');
        turnText.innerHTML = `🤝 引き分け！ (${winnerNames})`;
      }
    }
  } else {
    if (turnText) {
      if (isWaitingForConfirmation) {
        // ★ カウントダウンの残り秒数を表示
        if (myTurn) {
          turnText.innerHTML = `<span style="color: ${currentColor};">●</span> <span style="color: ${currentColor};">👀 覚えるタイム: 残り ${remainingSeconds}秒 (タップで閉じる)</span>`;
        } else {
          turnText.innerHTML = `<span style="color: ${currentColor};">●</span> <span style="color: ${currentColor};">👀 ${currName} が覚えています... (残り ${remainingSeconds}秒)</span>`;
        }
      } else {
        turnText.innerHTML = myTurn 
          ? `<span style="color: ${currentColor};">●</span> <span style="color: ${currentColor};">あなたのターン</span>` 
          : `<span style="color: ${currentColor};">●</span> <span style="color: ${currentColor};">${currName} のターン</span>`;
      }
    }
  }
}

function handleCardClick(index, e) {
  if (e) e.stopPropagation(); 
  
  if (!isMyTurn() || gameOver || isProcessing || isWaitingForConfirmation) return;
  if (board[index].isFlipped || board[index].isMatched) return;

  const myConnId = currentGameState ? currentGameState.myConnId : (isHostPlayer ? 'host' : 'guest');

  const actionData = {
    type: "CONCENTRATION_FLIP",
    payload: { index, connId: myConnId }
  };

  if (isHostPlayer) {
    processAction(actionData);
  } else {
    sendData(actionData);
  }
}

function startConfirmationTimer() {
  clearConfirmationTimer();
  remainingSeconds = 5;

  // ★ 1秒ごとに残り秒数を減らしてUIを更新
  countdownInterval = setInterval(() => {
    remainingSeconds--;
    if (remainingSeconds < 0) {
      remainingSeconds = 0;
    }
    updateUI();
  }, 1000);

  // ★ 5秒後にカードを伏せる
  confirmationTimer = setTimeout(() => {
    triggerCloseMismatch();
  }, 5000); 
}

function clearConfirmationTimer() {
  if (confirmationTimer) {
    clearTimeout(confirmationTimer);
    confirmationTimer = null;
  }
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
  remainingSeconds = 5;
}

function triggerCloseMismatch() {
  clearConfirmationTimer();
  if (isHostPlayer) {
    closeMismatchCards();
  } else {
    sendData({ type: "CONCENTRATION_CONFIRM" });
  }
}

export function handleScreenTap() {
  if (!isWaitingForConfirmation) return;
  triggerCloseMismatch();
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

  if (players.length > 0) {
    currentTurnIndex = (currentTurnIndex + 1) % players.length;
  }
  isProcessing = false;

  syncStateToGuest();
  updateBoard();
  updateUI();
}

export function processAction(data) {
  if (!isHostPlayer) return;

  if (data.type === "CONCENTRATION_CONFIRM") {
    if (isWaitingForConfirmation) {
      closeMismatchCards();
    }
    return;
  }

  if (data.type === "CONCENTRATION_FLIP") {
    const { index, connId } = data.payload;
    const currPlayer = players[currentTurnIndex];
    if (!currPlayer || currPlayer.connId !== connId || isWaitingForConfirmation) return;
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
        players[currentTurnIndex].score++;
        playSound('put');
        flippedIndices = [];
        isProcessing = false;

        const totalMatched = players.reduce((sum, p) => sum + p.score, 0);
        if (totalMatched === 8) {
          gameOver = true;
          playSound('win');
        }
        syncStateToGuest();
        updateBoard();
        updateUI();
      } else {
        isWaitingForConfirmation = true;
        syncStateToGuest();
        updateBoard();
        updateUI();

        // ★ ホスト側でタイマーを開始
        startConfirmationTimer();
      }
    }
  }
}

export function updateGameState(payload) {
  if (!isHostPlayer) {
    const wasWaiting = isWaitingForConfirmation;

    board = payload.board;
    players = payload.players || players;
    currentTurnIndex = payload.currentTurnIndex;
    gameOver = payload.gameOver;
    isWaitingForConfirmation = payload.isWaitingForConfirmation || false;

    if (gameOver) {
      playSound('win');
      const btnRematch = document.getElementById('btn-rematch-concentration');
      if (btnRematch) btnRematch.style.display = isHostPlayer ? 'inline-block' : 'none';
    }

    updateBoard();
    updateUI();

    // ★ ゲスト側でも待ち状態に変わったタイミングでタイマーを動かす
    if (!wasWaiting && isWaitingForConfirmation) {
      startConfirmationTimer();
    }
  }
}

export function syncStateToGuest() {
  if (isHostPlayer) {
    sendData({
      type: "CONCENTRATION_STATE_SYNC",
      payload: { board, players, currentTurnIndex, gameOver, isWaitingForConfirmation }
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