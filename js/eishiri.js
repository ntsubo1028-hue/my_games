// eishiri.js - 絵しりとり（正解パネル強調・ゆっくり読ませる演出・バナー動的枠表示対応）

import { playSound } from './sounds.js';
import { currentGameState } from './lobby.js';

export let EISHIRI_DICTIONARY = [];
let isDictionaryLoaded = false;

const PLAYER_COLORS = [
  { bg: "#e3f2fd", border: "#2196f3", text: "#0d47a1" }, // 1P
  { bg: "#ffebee", border: "#f44336", text: "#b71c1c" }, // 2P
  { bg: "#e8f5e9", border: "#4caf50", text: "#1b5e20" }, // 3P
  { bg: "#fffde7", border: "#fbc02d", text: "#f57f17" }  // 4P
];

const DEFAULT_DICTIONARY = [
  { emoji: "🍎", readings: ["りんご", "くだもの"] },
  { emoji: "🍊", readings: ["みかん"] },
  { emoji: "🍌", readings: ["ばなな"] },
  { emoji: "🍓", readings: ["いちご"] },
  { emoji: "🍉", readings: ["すいか"] },
  { emoji: "🍇", readings: ["ぶどう"] },
  { emoji: "🍈", readings: ["めろん"] },
  { emoji: "🍑", readings: ["もも"] },
  { emoji: "🍅", readings: ["とまと"] },
  { emoji: "🍆", readings: ["なす"] },
  { emoji: "🥕", readings: ["にんじん"] },
  { emoji: "🦁", readings: ["らいおん"] },
  { emoji: "🐘", readings: ["ぞう"] },
  { emoji: "🦒", readings: ["きりん"] },
  { emoji: "🐧", readings: ["ぺんぎん"] },
  { emoji: "🐬", readings: ["いるか"] },
  { emoji: "🐙", readings: ["たこ"] },
  { emoji: "🦑", readings: ["いか"] },
  { emoji: "🦀", readings: ["かに"] }
];

export async function loadEishiriDictionary() {
  if (isDictionaryLoaded && EISHIRI_DICTIONARY.length > 5) return true;
  try {
    const response = await fetch('./eishiri_dict.csv');
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const csvText = await response.text();
    const lines = csvText.trim().split('\n');
    const loadedDict = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const firstCommaIndex = line.indexOf(',');
      if (firstCommaIndex === -1) continue;
      const emoji = line.substring(0, firstCommaIndex).trim();
      const readingsStr = line.substring(firstCommaIndex + 1).trim();
      const readings = readingsStr.split('|').map(r => r.trim()).filter(r => r.length > 0);
      if (emoji && readings.length > 0) {
        loadedDict.push({ emoji, readings });
      }
    }
    if (loadedDict.length > 0) {
      EISHIRI_DICTIONARY = loadedDict;
      isDictionaryLoaded = true;
      return true;
    }
  } catch (e) {
    EISHIRI_DICTIONARY = [...DEFAULT_DICTIONARY];
    isDictionaryLoaded = true;
  }
  return false;
}

function normalizeChar(char) {
  if (!char) return '';
  const map = {
    'が': 'か', 'ぎ': 'き', 'ぐ': 'く', 'げ': 'け', 'ご': 'こ',
    'ざ': 'さ', 'じ': 'し', 'ず': 'す', 'ぜ': 'せ', 'ぞ': 'そ',
    'だ': 'た', 'ぢ': 'ち', 'づ': 'つ', 'で': 'て', 'ど': 'と',
    'ば': 'は', 'び': 'ひ', 'ぶ': 'ふ', 'べ': 'へ', 'ぼ': 'ほ',
    'ぱ': 'は', 'ぴ': 'ひ', 'ぷ': 'ふ', 'ぺ': 'へ', 'ぽ': 'ほ',
    'ぁ': 'あ', 'ぃ': 'い', 'ぅ': 'う', 'ぇ': 'え', 'ぉ': 'お',
    'っ': 'つ', 'ゃ': 'や', 'ゅ': 'ゆ', 'ょ': 'よ', 'ー': ''
  };
  return map[char] || char;
}

let eishiriState = {
  mode: 'solo',
  isPlaying: false,
  isPaused: false,
  currentLastChar: 'あ',
  boardTiles: [],
  score: 0,
  players: [],
  currentTurnIndex: 0,
  eliminatedOrder: []
};

let eishiriTimer = null;
let comThinkingTimeout = null;
let isHost = false;
let sendDataFunc = null;

export function initEishiriSystem(hostFlag, sendFunc) {
  isHost = hostFlag;
  sendDataFunc = sendFunc;
}

export async function startEishiriGame(isHostFlag, mode = 'solo') {
  isHost = isHostFlag;
  eishiriState.mode = mode;
  await loadEishiriDictionary();

  eishiriState.isPlaying = true;
  eishiriState.isPaused = false;
  eishiriState.score = 0;
  eishiriState.currentTurnIndex = 0;
  eishiriState.eliminatedOrder = [];

  hideResultOverlay();

  eishiriState.players = [];
  if (mode === 'solo') {
    eishiriState.players = [
      { id: 'solo-player', name: 'あなた', type: 'human', timeRemaining: 50, score: 0, isEliminated: false, color: PLAYER_COLORS[0] }
    ];
  } else {
    if (typeof currentGameState !== 'undefined' && currentGameState && currentGameState.slots) {
      let colorIdx = 0;
      currentGameState.slots.forEach(slot => {
        if (slot.type !== 'none') {
          eishiriState.players.push({
            id: slot.connId || `slot-${slot.slotId}`,
            name: slot.name || `P${slot.slotId + 1}`,
            type: slot.type,
            timeRemaining: 50,
            score: 0,
            isEliminated: false,
            color: PLAYER_COLORS[colorIdx % PLAYER_COLORS.length]
          });
          colorIdx++;
        }
      });
    }
    if (eishiriState.players.length === 0) {
      eishiriState.players = [
        { id: 'host', name: 'あなた', type: 'human', timeRemaining: 50, score: 0, isEliminated: false, color: PLAYER_COLORS[0] },
        { id: 'com-1', name: 'COM1', type: 'com', timeRemaining: 50, score: 0, isEliminated: false, color: PLAYER_COLORS[1] },
        { id: 'com-2', name: 'COM2', type: 'com', timeRemaining: 50, score: 0, isEliminated: false, color: PLAYER_COLORS[2] }
      ];
    }
  }

  const rematchBtn = document.getElementById('btn-rematch-eishiri');
  if (rematchBtn) rematchBtn.style.display = 'none';

  const passBtn = document.getElementById('btn-pass-eishiri');
  if (passBtn) passBtn.style.display = 'inline-block';

  // バナーの枠線・背景・文字をクリア
  resetReadingBanner();

  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('eishiri-game-screen').classList.add('active');

  if (!document.getElementById('eishiri-big-popup')) {
    const popup = document.createElement('div');
    popup.id = 'eishiri-big-popup';
    document.getElementById('eishiri-game-screen').appendChild(popup);
  }

  generateBoardTiles(16);

  const randomTile = eishiriState.boardTiles[Math.floor(Math.random() * eishiriState.boardTiles.length)];
  const initialReading = randomTile.readings[0];
  eishiriState.currentLastChar = initialReading.charAt(0);

  renderEishiriUI();

  if (eishiriTimer) clearInterval(eishiriTimer);
  eishiriTimer = setInterval(() => {
    if (!eishiriState.isPlaying || eishiriState.isPaused) return;

    const activePlayer = eishiriState.players[eishiriState.currentTurnIndex];
    if (activePlayer && !activePlayer.isEliminated) {
      activePlayer.timeRemaining--;
      updateTimerUI();

      if (activePlayer.timeRemaining <= 0) {
        activePlayer.timeRemaining = 0;
        eliminatePlayer(activePlayer, "時間切れ");
      }
    }
  }, 1000);

  checkAndRunComTurn();
}

function eliminatePlayer(player, reason) {
  if (player.isEliminated) return;
  player.isEliminated = true;
  eishiriState.eliminatedOrder.push(player);

  showBigPopup(`💀 ${player.name} 脱落！ (${reason})`, "#d32f2f", "#fff");

  const activePlayers = eishiriState.players.filter(p => !p.isEliminated);

  if (eishiriState.mode === 'solo' || activePlayers.length <= 1) {
    setTimeout(() => {
      finishBattleGame(activePlayers[0]);
    }, 1200);
  } else {
    setTimeout(() => {
      nextTurn();
    }, 1200);
  }
}

function finishBattleGame(winner) {
  eishiriState.isPlaying = false;
  eishiriState.isPaused = false;
  if (eishiriTimer) clearInterval(eishiriTimer);
  if (comThinkingTimeout) clearTimeout(comThinkingTimeout);

  const totalPlayers = eishiriState.players.length;

  eishiriState.players.forEach(p => {
    if (winner && p.id === winner.id) {
      p.rank = 1;
    } else {
      const elimIndex = eishiriState.eliminatedOrder.findIndex(e => e.id === p.id);
      p.rank = totalPlayers - elimIndex;
    }
  });

  const myPlayer = eishiriState.players.find(p => p.id === 'solo-player' || p.id === 'host' || p.id === eishiriState.players[0].id);
  const myRank = myPlayer ? myPlayer.rank : 1;

  showResultOverlay(myRank, winner);

  const passBtn = document.getElementById('btn-pass-eishiri');
  if (passBtn) passBtn.style.display = 'none';

  const rematchBtn = document.getElementById('btn-rematch-eishiri');
  if (rematchBtn) rematchBtn.style.display = 'inline-block';
}

function showResultOverlay(rank, winner) {
  let overlay = document.getElementById('eishiri-result-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'eishiri-result-overlay';
    document.getElementById('eishiri-game-screen').appendChild(overlay);
  }

  overlay.innerHTML = '';

  const title = document.createElement('div');
  title.id = 'eishiri-rank-title';

  if (rank === 1) {
    title.innerText = "👑 勝利！";
    title.style.color = "#ffd700";
    spawnConfetti(overlay);
    playSound('win');
  } else {
    title.innerText = `${rank}位`;
    title.style.color = rank === 2 ? "#c0c0c0" : (rank === 3 ? "#cd7f32" : "#ffffff");
    playSound('gameover');
  }

  const sub = document.createElement('div');
  sub.style.cssText = "font-size: 20px; color: #fff; margin-top: 10px; font-weight: bold;";
  sub.innerText = winner ? `勝者: ${winner.name}` : '';

  overlay.appendChild(title);
  overlay.appendChild(sub);
  overlay.classList.add('show');
}

function hideResultOverlay() {
  const overlay = document.getElementById('eishiri-result-overlay');
  if (overlay) overlay.classList.remove('show');
}

function spawnConfetti(container) {
  const colors = ['#f44336', '#e91e63', '#9c27b0', '#673ab7', '#3f51b5', '#2196f3', '#4caf50', '#ffeb3b', '#ff9800'];
  for (let i = 0; i < 50; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
    piece.style.animationDelay = `${Math.random() * 2}s`;
    piece.style.animationDuration = `${2 + Math.random() * 2}s`;
    container.appendChild(piece);
  }
}

function checkAndRunComTurn() {
  if (!eishiriState.isPlaying || eishiriState.isPaused) return;

  const currentPlayer = eishiriState.players[eishiriState.currentTurnIndex];
  if (currentPlayer && currentPlayer.type === 'com' && !currentPlayer.isEliminated) {
    const thinkTime = Math.floor(Math.random() * 1300) + 1200;

    if (comThinkingTimeout) clearTimeout(comThinkingTimeout);
    comThinkingTimeout = setTimeout(() => {
      if (!eishiriState.isPlaying) return;
      runComTurn();
    }, thinkTime);
  }
}

async function runComTurn() {
  const currentPlayer = eishiriState.players[eishiriState.currentTurnIndex];
  if (!currentPlayer || currentPlayer.isEliminated) return;

  let validIndices = [];
  eishiriState.boardTiles.forEach((tile, index) => {
    const res = checkTileConnection(tile, eishiriState.currentLastChar);
    if (res.isValid) validIndices.push({ index, res });
  });

  const safeValidIndices = validIndices.filter(v => {
    if (v.res.isDobon) return Math.random() < 0.20;
    return true;
  });

  const willMakeMistake = Math.random() > 0.70;

  if (safeValidIndices.length > 0 && !willMakeMistake) {
    const chosen = safeValidIndices[Math.floor(Math.random() * safeValidIndices.length)];
    
    if (chosen.res.isDobon) {
      playSound('gameover');
      eliminatePlayer(currentPlayer, `「${chosen.res.matchedReading}」でドボン`);
    } else {
      eishiriState.isPaused = true;
      playSound('win');
      
      // ① パネル強調表示（色つけ＆線強調）
      highlightTile(chosen.index);

      showBigPopup(`🤖 ${currentPlayer.name} 正解！ (+5秒)`, "#0288d1", "#fff");
      await animateReadingBanner(chosen.res.matchedReading);

      currentPlayer.timeRemaining += 5;
      currentPlayer.score++;
      eishiriState.currentLastChar = chosen.res.nextChar;
      eishiriState.boardTiles[chosen.index] = getUniqueRandomTile();
      nextTurn();
    }
  } else {
    if (validIndices.length === 0 || Math.random() < 0.5) {
      currentPlayer.timeRemaining = Math.max(0, currentPlayer.timeRemaining - 10);
      showBigPopup(`🤖 ${currentPlayer.name} パス！ (-10秒)`, "#ff9800", "#fff");
      generateBoardTiles(16);
      
      if (currentPlayer.timeRemaining <= 0) {
        eliminatePlayer(currentPlayer, "時間切れ");
        return;
      }
      nextTurn();
    } else {
      playSound('put');
      currentPlayer.timeRemaining = Math.max(0, currentPlayer.timeRemaining - 3);
      showBigPopup(`🤖 ${currentPlayer.name} ミス！ (-3秒)`, "#d32f2f", "#fff");
      updateTimerUI();

      if (currentPlayer.timeRemaining <= 0) {
        eliminatePlayer(currentPlayer, "時間切れ");
        return;
      }

      eishiriState.isPaused = false;
      checkAndRunComTurn();
    }
  }
}

function nextTurn() {
  const activePlayers = eishiriState.players.filter(p => !p.isEliminated);
  if (activePlayers.length <= 1) {
    finishBattleGame(activePlayers[0]);
    return;
  }

  do {
    eishiriState.currentTurnIndex = (eishiriState.currentTurnIndex + 1) % eishiriState.players.length;
  } while (eishiriState.players[eishiriState.currentTurnIndex].isEliminated);

  renderEishiriUI();
  eishiriState.isPaused = false;
  checkAndRunComTurn();
}

function generateBoardTiles(count) {
  eishiriState.boardTiles = [];
  const available = [...EISHIRI_DICTIONARY];
  for (let i = 0; i < count; i++) {
    if (available.length === 0) available.push(...EISHIRI_DICTIONARY);
    const randomIndex = Math.floor(Math.random() * available.length);
    const chosen = available.splice(randomIndex, 1)[0];
    eishiriState.boardTiles.push({ ...chosen });
  }
}

function getUniqueRandomTile() {
  const currentEmojis = eishiriState.boardTiles.map(t => t.emoji);
  const candidates = EISHIRI_DICTIONARY.filter(d => !currentEmojis.includes(d.emoji));
  const pool = candidates.length > 0 ? candidates : EISHIRI_DICTIONARY;
  const chosen = pool[Math.floor(Math.random() * pool.length)];
  return { ...chosen };
}

export function passEishiriTurn() {
  if (!eishiriState.isPlaying || eishiriState.isPaused) return;

  const currentPlayer = eishiriState.players[eishiriState.currentTurnIndex];
  if (currentPlayer && currentPlayer.type === 'com') return;

  playSound('put');
  currentPlayer.timeRemaining -= 10;
  updateTimerUI();

  showBigPopup("パス 🔄 -10秒", "#ff9800", "#fff");

  if (currentPlayer.timeRemaining <= 0) {
    eliminatePlayer(currentPlayer, "時間切れ");
    return;
  }

  const boardContainer = document.getElementById('eishiri-board');
  if (boardContainer) {
    boardContainer.classList.add('board-rotate-anim');
    setTimeout(() => boardContainer.classList.remove('board-rotate-anim'), 500);
  }

  generateBoardTiles(16);

  if (eishiriState.mode === 'solo') {
    renderEishiriUI();
  } else {
    nextTurn();
  }
}

export function checkTileConnection(tile, requiredStartingChar) {
  const targetChar = normalizeChar(requiredStartingChar);
  for (let reading of tile.readings) {
    const firstChar = normalizeChar(reading.charAt(0));
    if (firstChar === targetChar) {
      const lastOriginalChar = reading.slice(-1);
      const isDobon = (lastOriginalChar === 'ん' || lastOriginalChar === 'ン');
      return {
        isValid: true,
        matchedReading: reading,
        isDobon: isDobon,
        nextChar: isDobon ? '' : lastOriginalChar
      };
    }
  }
  return { isValid: false };
}

/**
 * ① 正解パネルを太枠＆色つけで強調表示するヘルパー関数
 */
function highlightTile(index) {
  const boardContainer = document.getElementById('eishiri-board');
  const targetBtn = boardContainer ? boardContainer.children[index] : null;
  if (targetBtn) {
    targetBtn.style.border = '4px solid #d81b60';
    targetBtn.style.background = '#ffe0b2';
    targetBtn.style.transform = 'scale(1.1)';
    targetBtn.style.boxShadow = '0 6px 15px rgba(216,27,96,0.4)';
    targetBtn.style.zIndex = '10';
  }
}

export async function selectEishiriTile(index) {
  if (!eishiriState.isPlaying || eishiriState.isPaused) return;

  const currentPlayer = eishiriState.players[eishiriState.currentTurnIndex];
  if (currentPlayer && (currentPlayer.type === 'com' || currentPlayer.isEliminated)) return;

  const tile = eishiriState.boardTiles[index];
  if (!tile) return;

  const matchedResult = checkTileConnection(tile, eishiriState.currentLastChar);

  if (!matchedResult.isValid) {
    playSound('put');
    currentPlayer.timeRemaining = Math.max(0, currentPlayer.timeRemaining - 3);
    updateTimerUI();
    showBigPopup("-3秒 💦", "#d32f2f", "#fff");

    if (currentPlayer.timeRemaining <= 0) {
      eliminatePlayer(currentPlayer, "時間切れ");
    }
    return;
  }

  if (matchedResult.isDobon) {
    playSound('gameover');
    eliminatePlayer(currentPlayer, `「${matchedResult.matchedReading}」でドボン`);
    return;
  }

  eishiriState.isPaused = true;
  playSound('win');

  // ① 正解パネルの強調（裏返し廃止）
  highlightTile(index);

  showBigPopup("+5秒 ✨", "#4caf50", "#fff");

  // ② ゆっくり読み方を表示
  await animateReadingBanner(matchedResult.matchedReading);

  currentPlayer.timeRemaining += 5;
  currentPlayer.score++;
  eishiriState.currentLastChar = matchedResult.nextChar;
  eishiriState.boardTiles[index] = getUniqueRandomTile();

  if (eishiriState.mode === 'solo') {
    renderEishiriUI();
    eishiriState.isPaused = false;
  } else {
    nextTurn();
  }

  if (sendDataFunc && eishiriState.mode === 'multi') {
    sendDataFunc({
      type: 'EISHIRI_STATE_SYNC',
      payload: {
        timeRemaining: currentPlayer.timeRemaining,
        currentLastChar: eishiriState.currentLastChar,
        boardTiles: eishiriState.boardTiles,
        score: currentPlayer.score,
        currentTurnIndex: eishiriState.currentTurnIndex
      }
    });
  }
}

/**
 * ③ 通常時は枠を消し、正解時のみゆっくり（320ms間隔）読み方を表示する関数
 */
function animateReadingBanner(reading) {
  return new Promise((resolve) => {
    const banner = document.getElementById('eishiri-reading-banner');
    if (!banner) {
      setTimeout(resolve, 1200);
      return;
    }

    // 枠線と背景を浮かび上がらせる
    banner.style.border = '2px dashed #f48fb1';
    banner.style.background = '#fff0f5';
    banner.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)';

    let charIndex = 0;
    banner.innerText = '';

    // ② ゆっくり表示（1文字あたり 320ms）
    const interval = setInterval(() => {
      if (charIndex < reading.length) {
        banner.innerText += reading.charAt(charIndex);
        charIndex++;
      } else {
        clearInterval(interval);
        // 表示完了後の余韻（1秒間しっかり見せる）
        setTimeout(() => {
          resetReadingBanner();
          resolve();
        }, 1000);
      }
    }, 320);
  });
}

/**
 * ③ 読み方バナーの枠線・背景・テキストを消去・非表示にする関数
 */
function resetReadingBanner() {
  const banner = document.getElementById('eishiri-reading-banner');
  if (banner) {
    banner.innerText = '';
    banner.style.border = 'none';
    banner.style.background = 'transparent';
    banner.style.boxShadow = 'none';
  }
}

function showBigPopup(text, bgColor, textColor) {
  const popup = document.getElementById('eishiri-big-popup');
  if (!popup) return;
  popup.innerText = text;
  popup.style.background = bgColor;
  popup.style.color = textColor;
  popup.classList.add('show');

  setTimeout(() => {
    popup.classList.remove('show');
  }, 900);
}

function updateTimerUI() {
  const container = document.getElementById('eishiri-players-container');
  if (!container) return;

  container.innerHTML = '';
  eishiriState.players.forEach((p, idx) => {
    const isCurrent = (idx === eishiriState.currentTurnIndex && eishiriState.mode !== 'solo' && !p.isEliminated);
    const card = document.createElement('div');
    
    const borderColor = p.isEliminated ? '#9e9e9e' : (isCurrent ? '#d81b60' : p.color.border);
    const borderWidth = isCurrent ? '3px' : '1px';
    const transformScale = isCurrent ? 'scale(1.05)' : 'scale(1)';
    const opacityStyle = p.isEliminated ? '0.4' : '1';

    card.style.cssText = `
      background: ${p.isEliminated ? '#e0e0e0' : p.color.bg};
      border: ${borderWidth} solid ${borderColor};
      color: ${p.isEliminated ? '#757575' : p.color.text};
      padding: 6px 12px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: bold;
      transition: all 0.2s ease;
      transform: ${transformScale};
      opacity: ${opacityStyle};
      min-width: 90px;
      text-align: center;
    `;

    card.innerHTML = `
      <div>${p.name} ${isCurrent ? '👈' : ''} ${p.isEliminated ? '💀' : ''}</div>
      <div style="font-size: 16px; margin-top: 2px;">${p.isEliminated ? '脱落' : `⏱️ ${p.timeRemaining}秒`}</div>
    `;
    container.appendChild(card);
  });
}

function renderEishiriUI() {
  updateTimerUI();

  const currentPlayer = eishiriState.players[eishiriState.currentTurnIndex];
  const turnIndicator = document.getElementById('eishiri-turn-indicator');
  if (turnIndicator) {
    if (eishiriState.mode === 'solo') {
      turnIndicator.innerHTML = `自分のペースで繋げていこう！`;
    } else if (currentPlayer) {
      turnIndicator.innerHTML = `いまの番: <b style="color: ${currentPlayer.color.border}; font-size: 18px;">${currentPlayer.name}</b>`;
    }
  }

  const charDisplay = document.getElementById('eishiri-current-char-display');
  if (charDisplay) {
    charDisplay.innerHTML = `次の文字: <b style="font-size: 20px; color: #d81b60;">${eishiriState.currentLastChar}</b>`;
  }

  const boardContainer = document.getElementById('eishiri-board');
  if (!boardContainer) return;
  boardContainer.innerHTML = '';

  eishiriState.boardTiles.forEach((tile, index) => {
    const btn = document.createElement('button');
    btn.className = 'btn-action';
    btn.style = 'background: #fff; border: 2px solid #ad1457; border-radius: 8px; font-size: 32px; height: 65px; display: flex; align-items: center; justify-content: center; cursor: pointer; padding: 0; margin: 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1); transition: all 0.2s ease;';
    btn.innerText = tile.emoji;
    btn.onclick = () => selectEishiriTile(index);
    boardContainer.appendChild(btn);
  });
}

export function stopEishiriGame() {
  eishiriState.isPlaying = false;
  eishiriState.isPaused = false;
  hideResultOverlay();
  resetReadingBanner();
  if (eishiriTimer) clearInterval(eishiriTimer);
  if (comThinkingTimeout) clearTimeout(comThinkingTimeout);
}

export function processEishiriData(data) {
  if (!data) return;
  if (data.type === 'EISHIRI_STATE_SYNC') {
    const activePlayer = eishiriState.players[eishiriState.currentTurnIndex];
    if (activePlayer) {
      activePlayer.timeRemaining = data.payload.timeRemaining;
      activePlayer.score = data.payload.score;
    }
    eishiriState.currentLastChar = data.payload.currentLastChar;
    eishiriState.boardTiles = data.payload.boardTiles;
    eishiriState.currentTurnIndex = data.payload.currentTurnIndex;
    renderEishiriUI();
  } else if (data.type === 'EISHIRI_REMATCH') {
    startEishiriGame(isHost, eishiriState.mode);
  }
}

export function requestRematchEishiri() {
  if (sendDataFunc) {
    sendDataFunc({ type: 'EISHIRI_REMATCH' });
  }
  startEishiriGame(isHost, eishiriState.mode);
}