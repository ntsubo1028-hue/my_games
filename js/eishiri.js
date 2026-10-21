// js/eishiri.js - 絵しりとり（リマッチボタン追加・完全同期版）

import { sendData } from './connection.js';
import { playSound } from './sounds.js';
import { currentGameState } from './lobby.js';
import { openRankingRegisterModal } from './ranking.js';

export let EISHIRI_DICTIONARY = [];
let isDictionaryLoaded = false;

// ⚙️ 持ち時間やゲームバランスの定数設定
export const EISHIRI_CONFIG = {
  INITIAL_TIME: 50,       // 初期持ち時間（秒）
  CORRECT_BONUS: 5,       // 正解時の加算秒数
  MISTAKE_PENALTY: 3,     // ミス（不正解）時の減算秒数
  PASS_PENALTY: 10,       // パス時の減算秒数
  BOARD_SIZE: 16          // 盤面のタイル枚数
};

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
      
      // カンマで分割して、空でない要素をすべて抽出する
      const cols = line.split(',').map(c => c.trim());
      const emoji = cols[0];
      
      // 2列目以降（index 1以降）に存在する読み方をすべて配列に格納する
      const readings = cols.slice(1).filter(r => r.length > 0);
      
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
  survivalTime: 0,
  players: [],
  currentTurnIndex: 0,
  eliminatedOrder: []
};

let eishiriTimer = null;
let comThinkingTimeout = null;
let isHostPlayer = false;
let customSendFunc = null;

export function initEishiriSystem(hostFlag, sendFunc) {
  isHostPlayer = hostFlag;
  customSendFunc = sendFunc;
}

export function getEishiriMode() {
  return eishiriState.mode;
}

export async function startEishiriGame(isHostFlag, mode = 'solo') {
  isHostPlayer = isHostFlag;
  eishiriState.mode = mode;
  await loadEishiriDictionary();

  eishiriState.isPlaying = true;
  eishiriState.isPaused = false;
  eishiriState.score = 0;
  eishiriState.survivalTime = 0;
  eishiriState.currentTurnIndex = 0;
  eishiriState.eliminatedOrder = [];

  hideResultOverlay();
  resetReadingBanner();

  eishiriState.players = [];
  if (mode === 'solo') {
    eishiriState.players = [
      { id: 'solo-player', name: 'あなた', type: 'human', timeRemaining: EISHIRI_CONFIG.INITIAL_TIME, score: 0, isEliminated: false, color: PLAYER_COLORS[0] }
    ];
  } else {
    if (typeof currentGameState !== 'undefined' && currentGameState && currentGameState.slots) {
      let colorIdx = 0;
      currentGameState.slots.forEach(slot => {
        if (slot.type !== 'none') {
          let playerId = slot.connId;
          if (!playerId) {
            if (slot.type === 'host') playerId = 'host';
            else if (slot.type === 'guest') playerId = `guest-${slot.slotId}`;
            else playerId = `com-${slot.slotId}`;
          }
          
          eishiriState.players.push({
            id: playerId,
            slotId: slot.slotId,
            name: slot.name || `${slot.slotId + 1}P`,
            type: slot.type,
            timeRemaining: EISHIRI_CONFIG.INITIAL_TIME,
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
        { id: 'host', slotId: 0, name: '1P (あなた)', type: 'human', timeRemaining: EISHIRI_CONFIG.INITIAL_TIME, score: 0, isEliminated: false, color: PLAYER_COLORS[0] },
        { id: 'guest-1', slotId: 1, name: '2P (ゲスト)', type: 'human', timeRemaining: EISHIRI_CONFIG.INITIAL_TIME, score: 0, isEliminated: false, color: PLAYER_COLORS[1] }
      ];
    }
  }

  const rematchBtn = document.getElementById('btn-rematch-eishiri');
  if (rematchBtn) rematchBtn.style.display = 'none';

  const passBtn = document.getElementById('btn-pass-eishiri');
  if (passBtn) passBtn.style.display = 'inline-block';

  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('eishiri-game-screen').classList.add('active');

  if (!document.getElementById('eishiri-big-popup')) {
    const popup = document.createElement('div');
    popup.id = 'eishiri-big-popup';
    document.getElementById('eishiri-game-screen').appendChild(popup);
  }

  generateBoardTiles(EISHIRI_CONFIG.BOARD_SIZE);
  const randomTile = eishiriState.boardTiles[Math.floor(Math.random() * eishiriState.boardTiles.length)];
  const initialReading = randomTile.readings[0];
  eishiriState.currentLastChar = initialReading.charAt(0);

  renderEishiriUI();

  if (eishiriTimer) clearInterval(eishiriTimer);
  
  if (isHostPlayer || mode === 'solo') {
    eishiriTimer = setInterval(() => {
      if (!eishiriState.isPlaying || eishiriState.isPaused) return;

      if (eishiriState.mode === 'solo') {
        eishiriState.survivalTime++;
      }

      const activePlayer = eishiriState.players[eishiriState.currentTurnIndex];
      if (activePlayer && !activePlayer.isEliminated) {
        activePlayer.timeRemaining--;
        
        if (eishiriState.mode === 'multi') {
          syncStateToClients();
          renderEishiriUI();
        } else {
          updateTimerUI();
        }

        if (activePlayer.timeRemaining <= 0) {
          activePlayer.timeRemaining = 0;
          if (eishiriState.mode === 'solo') {
            endSoloGame("タイムアップ！ゲームオーバー…");
          } else {
            eliminatePlayer(activePlayer, "時間切れ");
          }
        }
      }
    }, 1000);

    if (eishiriState.mode === 'multi') {
      syncStateToClients();
    }
    checkAndRunComTurn();
  }
}

function getMyPlayerId() {
  if (currentGameState && currentGameState.myConnId) {
    return currentGameState.myConnId;
  }
  return isHostPlayer ? 'host' : 'guest-1';
}

function isMyTurn() {
  if (eishiriState.mode === 'solo') return true;
  const activePlayer = eishiriState.players[eishiriState.currentTurnIndex];
  if (!activePlayer) return false;
  
  const myId = getMyPlayerId();
  return activePlayer.id === myId || (isHostPlayer && activePlayer.id === 'host');
}

function endSoloGame(message) {
  eishiriState.isPlaying = false;
  eishiriState.isPaused = false;
  if (eishiriTimer) clearInterval(eishiriTimer);
  if (comThinkingTimeout) clearTimeout(comThinkingTimeout);

  playSound('gameover');
  const turnEl = document.getElementById('eishiri-turn-indicator');
  if (turnEl) {
    turnEl.innerText = `${message} (生存時間: ${eishiriState.survivalTime}秒)`;
    turnEl.style.color = '#d32f2f';
  }

  const passBtn = document.getElementById('btn-pass-eishiri');
  if (passBtn) passBtn.style.display = 'none';

  const rematchBtn = document.getElementById('btn-rematch-eishiri');
  if (rematchBtn) rematchBtn.style.display = 'inline-block';

  if (typeof openRankingRegisterModal === 'function') {
    openRankingRegisterModal('eishiri', eishiriState.survivalTime);
  }
}

function eliminatePlayer(player, reason) {
  if (player.isEliminated) return;
  player.isEliminated = true;
  eishiriState.eliminatedOrder.push(player);

  triggerPopupAndSync({ type: 'EISHIRI_POPUP', text: `💀 ${player.name} 脱落！ (${reason})`, bg: "#d32f2f" });

  const activePlayers = eishiriState.players.filter(p => !p.isEliminated);

  if (activePlayers.length <= 1) {
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

  if (eishiriState.mode === 'multi' && isHostPlayer) {
    syncStateToClients({ type: 'EISHIRI_FINISH', winnerId: winner ? winner.id : null });
  }

  const myId = getMyPlayerId();
  const myPlayer = eishiriState.players.find(p => p.id === myId || p.id === 'solo-player' || (isHostPlayer && p.id === 'host'));
  const myRank = myPlayer ? myPlayer.rank : 1;

  showResultOverlay(myRank, winner);

  const passBtn = document.getElementById('btn-pass-eishiri');
  if (passBtn) passBtn.style.display = 'none';
}

function showResultOverlay(rank, winner) {
  let overlay = document.getElementById('eishiri-result-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'eishiri-result-overlay';
    document.getElementById('eishiri-game-screen').appendChild(overlay);
  }

  overlay.innerHTML = '';
  const card = document.createElement('div');
  card.style.cssText = "background: #fff; padding: 25px 30px; border-radius: 16px; text-align: center; box-shadow: 0 10px 30px rgba(0,0,0,0.4); max-width: 320px; width: 90%; color: #333;";

  const title = document.createElement('div');
  if (rank === 1) {
    title.innerText = "👑 勝利！";
    title.style.cssText = "font-size: 38px; font-weight: 900; color: #f57f17; margin-bottom: 5px;";
    spawnConfetti(overlay);
    playSound('win');
  } else {
    title.innerText = `${rank}位`;
    title.style.cssText = `font-size: 38px; font-weight: 900; color: ${rank === 2 ? '#78909c' : '#8d6e63'}; margin-bottom: 5px;`;
    playSound('gameover');
  }

  const sub = document.createElement('div');
  sub.style.cssText = "font-size: 15px; color: #666; margin-bottom: 20px; font-weight: bold;";
  sub.innerText = winner ? `勝者: ${winner.name}` : '';

  // ボタンエリアの作成（もう一度遊ぶ ＆ ロビーに戻る）
  const btnContainer = document.createElement('div');
  btnContainer.style.cssText = "display: flex; flex-direction: column; gap: 10px;";

  const rematchBtn = document.createElement('button');
  rematchBtn.innerText = "🔄 もう一度遊ぶ";
  rematchBtn.style.cssText = "background: #4caf50; color: white; padding: 10px; border-radius: 8px; font-weight: bold; border: none; cursor: pointer; font-size: 16px;";
  rematchBtn.onclick = () => {
    hideResultOverlay();
    requestRematchEishiri();
  };

  const lobbyBtn = document.createElement('button');
  lobbyBtn.innerText = "🏠 ロビーに戻る";
  lobbyBtn.style.cssText = "background: #78909c; color: white; padding: 10px; border-radius: 8px; font-weight: bold; border: none; cursor: pointer; font-size: 16px;";
  lobbyBtn.onclick = () => {
    hideResultOverlay();
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const lobbyScreen = document.getElementById('lobby-screen');
    if (lobbyScreen) lobbyScreen.classList.add('active');
  };

  btnContainer.appendChild(rematchBtn);
  btnContainer.appendChild(lobbyBtn);

  card.appendChild(title);
  card.appendChild(sub);
  card.appendChild(btnContainer);
  overlay.appendChild(card);
  overlay.classList.add('show');
}

function hideResultOverlay() {
  const overlay = document.getElementById('eishiri-result-overlay');
  if (overlay) {
    overlay.classList.remove('show');
    overlay.innerHTML = '';
  }
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
  if (!isHostPlayer || !eishiriState.isPlaying || eishiriState.isPaused) return;

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
      
      triggerPopupAndSync({ type: 'EISHIRI_HIGHLIGHT', index: chosen.index });
      triggerPopupAndSync({ type: 'EISHIRI_POPUP', text: `🤖 ${currentPlayer.name} 正解！ (+${EISHIRI_CONFIG.CORRECT_BONUS}秒)`, bg: "#0288d1" });

      currentPlayer.timeRemaining += EISHIRI_CONFIG.CORRECT_BONUS;
      currentPlayer.score++;
      eishiriState.currentLastChar = chosen.res.nextChar;
      eishiriState.boardTiles[chosen.index] = getUniqueRandomTile();
      
      triggerPopupAndSync({ type: 'EISHIRI_READING', reading: chosen.res.matchedReading });
      await animateReadingBanner(chosen.res.matchedReading);
      nextTurn();
    }
  } else {
    if (validIndices.length === 0 || Math.random() < 0.5) {
      currentPlayer.timeRemaining = Math.max(0, currentPlayer.timeRemaining - EISHIRI_CONFIG.PASS_PENALTY);
      triggerBoardRotateAnimation();
      triggerPopupAndSync({ type: 'EISHIRI_POPUP', text: `🤖 ${currentPlayer.name} パス！ (-${EISHIRI_CONFIG.PASS_PENALTY}秒)`, bg: "#ff9800" });
      generateBoardTiles(EISHIRI_CONFIG.BOARD_SIZE);
      
      if (currentPlayer.timeRemaining <= 0) {
        eliminatePlayer(currentPlayer, "時間切れ");
        return;
      }
      nextTurn();
    } else {
      playSound('put');
      currentPlayer.timeRemaining = Math.max(0, currentPlayer.timeRemaining - EISHIRI_CONFIG.MISTAKE_PENALTY);
      triggerPopupAndSync({ type: 'EISHIRI_POPUP', text: `🤖 ${currentPlayer.name} ミス！ (-${EISHIRI_CONFIG.MISTAKE_PENALTY}秒)`, bg: "#d32f2f" });
      syncStateToClients();
      renderEishiriUI();

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

  eishiriState.isPaused = false;
  syncStateToClients();
  renderEishiriUI();
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
  if (!isMyTurn()) return;

  const currentPlayer = eishiriState.players[eishiriState.currentTurnIndex];
  if (!currentPlayer) return;

  if (eishiriState.mode === 'solo') {
    executePass(currentPlayer);
  } else {
    if (isHostPlayer) {
      executePass(currentPlayer);
    } else {
      sendData({ type: 'EISHIRI_ACTION_PASS' });
    }
  }
}

function executePass(currentPlayer) {
  playSound('put');
  currentPlayer.timeRemaining -= EISHIRI_CONFIG.PASS_PENALTY;
  
  generateBoardTiles(EISHIRI_CONFIG.BOARD_SIZE);
  triggerBoardRotateAnimation();
  triggerPopupAndSync({ type: 'EISHIRI_POPUP', text: `パス 🔄 (-${EISHIRI_CONFIG.PASS_PENALTY}秒)`, bg: "#ff9800" });

  if (currentPlayer.timeRemaining <= 0) {
    currentPlayer.timeRemaining = 0;
    if (eishiriState.mode === 'solo') {
      endSoloGame("タイムアップ！ゲームオーバー…");
    } else {
      eliminatePlayer(currentPlayer, "時間切れ");
    }
    return;
  }

  if (eishiriState.mode === 'solo') {
    renderEishiriUI();
  } else {
    nextTurn();
  }
}

function triggerBoardRotateAnimation() {
  if (eishiriState.mode === 'multi' && isHostPlayer) {
    syncStateToClients({ type: 'EISHIRI_ROTATE_BOARD' });
  }
  playBoardRotateAnimLocally();
}

function playBoardRotateAnimLocally() {
  const boardEl = document.getElementById('eishiri-board');
  if (boardEl) {
    boardEl.classList.remove('board-rotate-anim');
    void boardEl.offsetWidth;
    boardEl.classList.add('board-rotate-anim');
    setTimeout(() => {
      boardEl.classList.remove('board-rotate-anim');
    }, 500);
  }
}

export function checkTileConnection(tile, requiredStartingChar) {
  const targetChar = normalizeChar(requiredStartingChar);
  for (let reading of tile.readings) {
    const firstChar = normalizeChar(reading.charAt(0));
    if (firstChar === targetChar) {
      const lastOriginalChar = reading.slice(-1);
      const isDobon = (lastOriginalChar === 'ん' || lastOriginalChar === 'ン');
      
      // ▼ 修正: 終わりの文字もnormalizeCharに通して濁点・半濁点を清音に統一する
      const normalizedLastChar = normalizeChar(lastOriginalChar);

      return {
        isValid: true,
        matchedReading: reading,
        isDobon: isDobon,
        nextChar: isDobon ? '' : normalizedLastChar // 清音化された次の文字を渡す
      };
    }
  }
  return { isValid: false };
}

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
  if (!isMyTurn()) return;

  const currentPlayer = eishiriState.players[eishiriState.currentTurnIndex];
  if (!currentPlayer) return;

  if (eishiriState.mode === 'solo') {
    await executeTileSelection(index, currentPlayer);
  } else {
    if (isHostPlayer) {
      await executeTileSelection(index, currentPlayer);
    } else {
      sendData({ type: 'EISHIRI_ACTION_SELECT', payload: { index } });
    }
  }
}

async function executeTileSelection(index, currentPlayer) {
  const tile = eishiriState.boardTiles[index];
  if (!tile) return;

  const matchedResult = checkTileConnection(tile, eishiriState.currentLastChar);

  if (!matchedResult.isValid) {
    playSound('put');
    currentPlayer.timeRemaining = Math.max(0, currentPlayer.timeRemaining - EISHIRI_CONFIG.MISTAKE_PENALTY);
    
    if (eishiriState.mode === 'multi') {
      triggerPopupAndSync({ type: 'EISHIRI_POPUP', text: `-${EISHIRI_CONFIG.MISTAKE_PENALTY}秒 💦`, bg: "#d32f2f" });
      syncStateToClients();
      renderEishiriUI();
    } else {
      updateTimerUI();
      showBigPopup(`-${EISHIRI_CONFIG.MISTAKE_PENALTY}秒 💦`, "#d32f2f", "#fff");
    }

    if (currentPlayer.timeRemaining <= 0) {
      if (eishiriState.mode === 'solo') {
        endSoloGame("タイムアップ！ゲームオーバー…");
      } else {
        eliminatePlayer(currentPlayer, "時間切れ");
      }
    }
    return;
  }

  if (matchedResult.isDobon) {
    playSound('gameover');
    if (eishiriState.mode === 'solo') {
      endSoloGame(`👤 「${matchedResult.matchedReading}」でドボン！ゲームオーバー…`);
    } else {
      eliminatePlayer(currentPlayer, `「${matchedResult.matchedReading}」でドボン`);
    }
    return;
  }

  eishiriState.isPaused = true;
  playSound('win');

  if (eishiriState.mode === 'multi') {
    triggerPopupAndSync({ type: 'EISHIRI_HIGHLIGHT', index });
    triggerPopupAndSync({ type: 'EISHIRI_POPUP', text: `+${EISHIRI_CONFIG.CORRECT_BONUS}秒 ✨`, bg: "#4caf50" });
  } else {
    highlightTile(index);
    showBigPopup(`+${EISHIRI_CONFIG.CORRECT_BONUS}秒 ✨`, "#4caf50", "#fff");
  }

  currentPlayer.timeRemaining += EISHIRI_CONFIG.CORRECT_BONUS;
  currentPlayer.score++;
  eishiriState.currentLastChar = matchedResult.nextChar;
  eishiriState.boardTiles[index] = getUniqueRandomTile();

  if (eishiriState.mode === 'solo') {
    await animateReadingBanner(matchedResult.matchedReading);
    renderEishiriUI();
    eishiriState.isPaused = false;
  } else {
    if (!isHostPlayer) {
      await animateReadingBanner(matchedResult.matchedReading);
    } else {
      syncStateToClients({ type: 'EISHIRI_READING', reading: matchedResult.matchedReading });
      await animateReadingBanner(matchedResult.matchedReading);
    }
    eishiriState.isPaused = false;
    nextTurn();
  }
}

function triggerPopupAndSync(extraCommand) {
  if (eishiriState.mode === 'multi' && isHostPlayer) {
    syncStateToClients(extraCommand);
    renderEishiriUI();
  }
  
  if (extraCommand.type === 'EISHIRI_POPUP') {
    showBigPopup(extraCommand.text, extraCommand.bg);
  } else if (extraCommand.type === 'EISHIRI_HIGHLIGHT') {
    highlightTile(extraCommand.index);
  } else if (extraCommand.type === 'EISHIRI_READING') {
    animateReadingBanner(extraCommand.reading);
  }
}

function animateReadingBanner(reading) {
  return new Promise((resolve) => {
    const banner = document.getElementById('eishiri-reading-banner');
    if (!banner) {
      setTimeout(resolve, 1200);
      return;
    }

    banner.innerText = '';
    banner.style.border = '2px dashed #f48fb1';
    banner.style.background = '#fff0f5';
    banner.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)';

    let charIndex = 0;
    const interval = setInterval(() => {
      if (charIndex < reading.length) {
        banner.innerText += reading.charAt(charIndex);
        charIndex++;
      } else {
        clearInterval(interval);
        setTimeout(() => {
          resetReadingBanner();
          resolve();
        }, 1000);
      }
    }, 320);
  });
}

function resetReadingBanner() {
  const banner = document.getElementById('eishiri-reading-banner');
  if (banner) {
    banner.innerText = '';
    banner.style.border = 'none';
    banner.style.background = 'transparent';
    banner.style.boxShadow = 'none';
  }
}

function showBigPopup(text, bgColor, textColor = "#fff") {
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
      turnIndicator.innerHTML = `自分のペースで繋げていこう！ (生存: <span style="color: #e65100;">${eishiriState.survivalTime}秒</span>)`;
    } else if (currentPlayer) {
      const myId = getMyPlayerId();
      const isMyTurnFlag = currentPlayer.id === myId || (isHostPlayer && currentPlayer.id === 'host');
      turnIndicator.innerHTML = isMyTurnFlag 
        ? `あなたの番です！ (<b style="color: ${currentPlayer.color.border};">${currentPlayer.name}</b>)` 
        : `いまの番: <b style="color: ${currentPlayer.color.border}; font-size: 18px;">${currentPlayer.name}</b>`;
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

export function openEishiriHelp() {
  eishiriState.isPaused = true;
  const modal = document.getElementById('eishiri-help-modal');
  if (modal) modal.style.display = 'flex';
}

export function closeEishiriHelp() {
  const modal = document.getElementById('eishiri-help-modal');
  if (modal) modal.style.display = 'none';
  eishiriState.isPaused = false;
}

export function stopEishiriGame() {
  eishiriState.isPlaying = false;
  eishiriState.isPaused = false;
  hideResultOverlay();
  resetReadingBanner();
  if (eishiriTimer) clearInterval(eishiriTimer);
  if (comThinkingTimeout) clearTimeout(comThinkingTimeout);
}

// ==========================================
// P2P 同期およびアクション処理（ホスト・ゲスト間）
// ==========================================
export function syncStateToClients(extraCommand = null) {
  if (!isHostPlayer || eishiriState.mode === 'solo') return;
  sendData({
    type: 'EISHIRI_STATE_SYNC',
    payload: {
      players: eishiriState.players,
      currentLastChar: eishiriState.currentLastChar,
      boardTiles: eishiriState.boardTiles,
      currentTurnIndex: eishiriState.currentTurnIndex,
      isPlaying: eishiriState.isPlaying,
      extraCommand: extraCommand
    }
  });
}

export function processEishiriData(data) {
  if (!data) return;

  if (data.type === 'EISHIRI_STATE_SYNC') {
    const payload = data.payload;
    eishiriState.players = payload.players;
    eishiriState.currentLastChar = payload.currentLastChar;
    eishiriState.boardTiles = payload.boardTiles;
    eishiriState.currentTurnIndex = payload.currentTurnIndex;
    eishiriState.isPlaying = payload.isPlaying;

    renderEishiriUI();

    if (payload.extraCommand) {
      const cmd = payload.extraCommand;
      if (cmd.type === 'EISHIRI_POPUP') {
        showBigPopup(cmd.text, cmd.bg);
      } else if (cmd.type === 'EISHIRI_HIGHLIGHT') {
        highlightTile(cmd.index);
      } else if (cmd.type === 'EISHIRI_READING') {
        animateReadingBanner(cmd.reading);
      } else if (cmd.type === 'EISHIRI_ROTATE_BOARD') {
        playBoardRotateAnimLocally();
      } else if (cmd.type === 'EISHIRI_FINISH') {
        const winner = eishiriState.players.find(p => p.id === cmd.winnerId);
        finishBattleGame(winner);
      }
    }
  } 
  else if (data.type === 'EISHIRI_ACTION_SELECT' && isHostPlayer) {
    const activePlayer = eishiriState.players[eishiriState.currentTurnIndex];
    if (activePlayer && !activePlayer.isEliminated) {
      executeTileSelection(data.payload.index, activePlayer);
    }
  } 
  else if (data.type === 'EISHIRI_ACTION_PASS' && isHostPlayer) {
    const activePlayer = eishiriState.players[eishiriState.currentTurnIndex];
    if (activePlayer && !activePlayer.isEliminated) {
      executePass(activePlayer);
    }
  } 
  else if (data.type === 'EISHIRI_REMATCH') {
    startEishiriGame(isHostPlayer, eishiriState.mode);
  }
}

export function requestRematchEishiri() {
  if (customSendFunc) {
    customSendFunc({ type: 'EISHIRI_REMATCH' });
  }
  startEishiriGame(isHostPlayer, eishiriState.mode);
}