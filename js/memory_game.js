// js/memory_game.js
import { playSound } from './sounds.js';
import { openRankingRegisterModal } from './ranking.js';

let currentLevel = 1; // 1: 4枚, 2: 8枚, 3: 12枚, 4: 16枚
let board = [];
let flippedIndices = [];
let matchedCount = 0;
let gameState = 'SELECT_LEVEL'; // 'SELECT_LEVEL', 'IDLE', 'MEMORIZING', 'PLAYING', 'GAMEOVER', 'CLEAR'
let isProcessing = false;

let startTime = 0;
let memoTimeSec = 0;
let memoTimerInterval = null;

const ALL_SYMBOLS = ['🍎', '🍊', '🍇', '🍓', '🍉', '🍒', '🍍', '🥝'];

export function initMemoryGame() {
  gameState = 'SELECT_LEVEL';
  stopMemoTimer();
  updateUIState();
}

export function startMemoryGame(level) {
  currentLevel = level;
  gameState = 'IDLE';
  flippedIndices = [];
  matchedCount = 0;
  isProcessing = false;
  memoTimeSec = 0;
  stopMemoTimer();

  // レベルに応じたペア数を決定 (LV1:2ペア/4枚, LV2:4ペア/8枚, LV3:6ペア/12枚, LV4:8ペア/16枚)
  const pairCount = currentLevel * 2;
  const selectedSymbols = ALL_SYMBOLS.slice(0, pairCount);
  let cardSymbols = [...selectedSymbols, ...selectedSymbols];

  // シャッフル
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

  updateUIState();
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
  board.forEach(card => card.isFlipped = true);

  startMemoTimer();
  updateUIState();
  updateBoard();
  playSound('flip');
}

export function handleMemorizedButton() {
  if (gameState !== 'MEMORIZING') return;

  stopMemoTimer();
  gameState = 'PLAYING';

  board.forEach(card => card.isFlipped = false);

  updateUIState();
  updateBoard();
  playSound('put');
}

function updateBoard() {
  const boardEl = document.getElementById('memory-board');
  if (!boardEl) return;

  boardEl.innerHTML = '';

  // 1列は4マス固定、行数はレベルに応じて 1〜4行 に変更
  boardEl.style.gridTemplateColumns = `repeat(4, 1fr)`;
  boardEl.style.gridTemplateRows = `repeat(${currentLevel}, 1fr)`;

  // ★ レベル（行数）に応じて、盤面全体の縦横比を動的に変更する
  // 例: Lv.1(1行)なら横長(4/1)、Lv.4(4行)なら正方形(1/1)
  boardEl.style.aspectRatio = `4 / ${currentLevel}`;

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

function updateUIState() {
  const levelSelectContainer = document.getElementById('memory-level-select-container');
  const playArea = document.getElementById('memory-play-area');
  const statusText = document.getElementById('memory-status-text');
  const timerDisplay = document.getElementById('memory-timer-display');
  const btnStart = document.getElementById('btn-memory-start');
  const btnMemorized = document.getElementById('btn-memory-memorized');
  const btnRetry = document.getElementById('btn-memory-retry');

  if (gameState === 'SELECT_LEVEL') {
    if (levelSelectContainer) levelSelectContainer.style.display = 'block';
    if (playArea) playArea.style.display = 'none';
    return;
  }

  if (levelSelectContainer) levelSelectContainer.style.display = 'none';
  if (playArea) playArea.style.display = 'flex';

  if (timerDisplay) {
    timerDisplay.innerText = `${memoTimeSec}秒`;
  }

  if (statusText) {
    switch (gameState) {
      case 'IDLE':
        statusText.innerHTML = `【レベル ${currentLevel}】「スタート」を押してください`;
        break;
      case 'MEMORIZING':
        statusText.innerHTML = '👀 配置を覚えてください！';
        break;
      case 'PLAYING':
        statusText.innerHTML = '🔍 ペアを選んで当ててください';
        break;
      case 'GAMEOVER':
        statusText.innerHTML = '💥 間違えたためゲームオーバー';
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
      board[firstIdx].isMatched = true;
      board[secondIdx].isMatched = true;
      matchedCount += 2;
      flippedIndices = [];
      isProcessing = false;
      playSound('put');
      updateBoard();

      if (matchedCount === board.length) {
        gameState = 'CLEAR';
        playSound('win');
        if (window.confetti) {
          window.confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
        }
        updateUIState();

        // レベル別にランキング登録を呼び出す (memory_lv1 〜 memory_lv4)
        setTimeout(() => {
          openRankingRegisterModal(`memory_lv${currentLevel}`, parseFloat(memoTimeSec));
        }, 500);
      }
    } else {
      setTimeout(() => {
        gameState = 'GAMEOVER';
        playSound('lose');
        board.forEach(card => card.isFlipped = true);
        isProcessing = false;
        updateUIState();
        updateBoard();
      }, 500);
    }
  }
}