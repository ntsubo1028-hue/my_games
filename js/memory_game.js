// js/memory_game.js
import { playSound } from './sounds.js';

let board = [];
let flippedIndices = [];
let matchedCount = 0;
let gameState = 'IDLE'; // 'IDLE', 'MEMORIZING', 'PLAYING', 'GAMEOVER', 'CLEAR'
let isProcessing = false;

let startTime = 0;
let memoTimeSec = 0;
let memoTimerInterval = null;

const SYMBOLS = ['🍎', '🍊', '🍇', '🍓', '🍉', '🍒', '🍍', '🥝'];

export function initMemoryGame() {
  gameState = 'IDLE';
  flippedIndices = [];
  matchedCount = 0;
  isProcessing = false;
  memoTimeSec = 0;
  stopMemoTimer();

  // カード作成 (8ペア16枚)
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

  updateUI();
  updateBoard();
}

function startMemoTimer() {
  stopMemoTimer();
  startTime = Date.now();
  memoTimerInterval = setInterval(() => {
    memoTimeSec = ((Date.now() - startTime) / 1000).toFixed(2);
    const timerEl = document.getElementById('memory-timer-display');
    if (timerEl) {
      timerEl.innerText = `${memoTimeSec}秒`;
    }
  }, 30);
}

function stopMemoTimer() {
  if (memoTimerInterval) {
    clearInterval(memoTimerInterval);
    memoTimerInterval = null;
  }
}

export function handleStartButton() {
  if (gameState !== 'IDLE') return;

  gameState = 'MEMORIZING';
  // 全カードを表にする
  board.forEach(card => card.isFlipped = true);

  startMemoTimer();
  updateUI();
  updateBoard();
  playSound('flip');
}

export function handleMemorizedButton() {
  if (gameState !== 'MEMORIZING') return;

  stopMemoTimer();
  gameState = 'PLAYING';

  // 全カードを裏に戻す
  board.forEach(card => card.isFlipped = false);

  updateUI();
  updateBoard();
  playSound('put');
}

function updateBoard() {
  const boardEl = document.getElementById('memory-board');
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
      if (gameState === 'PLAYING' && !isProcessing) {
        cell.onclick = (e) => handleCardClick(index, e);
      }
    }
    boardEl.appendChild(cell);
  });
}

function updateUI() {
  const statusText = document.getElementById('memory-status-text');
  const timerDisplay = document.getElementById('memory-timer-display');
  const btnStart = document.getElementById('btn-memory-start');
  const btnMemorized = document.getElementById('btn-memory-memorized');
  const btnRetry = document.getElementById('btn-memory-retry');

  if (timerDisplay) {
    timerDisplay.innerText = `${memoTimeSec}秒`;
  }

  if (statusText) {
    switch (gameState) {
      case 'IDLE':
        statusText.innerHTML = '「スタート」を押すとカードが開きます';
        break;
      case 'MEMORIZING':
        statusText.innerHTML = '👀 配置を覚えてください！';
        break;
      case 'PLAYING':
        statusText.innerHTML = '🔍 ペアを選んで当ててください';
        break;
      case 'GAMEOVER':
        statusText.innerHTML = '💥 おしい！間違えたためゲームオーバーです';
        break;
      case 'CLEAR':
        statusText.innerHTML = `🎉 クリア！暗記時間: <strong>${memoTimeSec}秒</strong>`;
        break;
    }
  }

  if (btnStart) btnStart.style.display = (gameState === 'IDLE') ? 'block' : 'none';
  if (btnMemorized) btnMemorized.style.display = (gameState === 'MEMORIZING') ? 'block' : 'none';
  if (btnRetry) btnRetry.style.display = (gameState === 'GAMEOVER' || gameState === 'CLEAR') ? 'block' : 'none';
}

function handleCardClick(index, e) {
  if (e) e.stopPropagation();

  if (gameState !== 'PLAYING' || isProcessing) return;
  if (board[index].isFlipped || board[index].isMatched) return;

  board[index].isFlipped = true;
  flippedIndices.push(index);
  playSound('flip');
  updateBoard();

  if (flippedIndices.length === 2) {
    isProcessing = true;
    const [firstIdx, secondIdx] = flippedIndices;

    if (board[firstIdx].symbol === board[secondIdx].symbol) {
      // 一致
      board[firstIdx].isMatched = true;
      board[secondIdx].isMatched = true;
      matchedCount += 2;
      flippedIndices = [];
      isProcessing = false;
      playSound('put');
      updateBoard();

      if (matchedCount === board.length) {
        // クリア
        gameState = 'CLEAR';
        playSound('win');
        if (window.confetti) {
          window.confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
        }
        updateUI();
      }
    } else {
      // 不一致 ➔ 即ゲームオーバー（ルール⑨）
      setTimeout(() => {
        gameState = 'GAMEOVER';
        playSound('lose'); // ※サウンドが存在する場合
        // 全カードを表にして見せる
        board.forEach(card => card.isFlipped = true);
        isProcessing = false;
        updateUI();
        updateBoard();
      }, 500);
    }
  }
}