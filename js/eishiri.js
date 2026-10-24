// js/eishiri.js - 絵しりとり（ドボン絵柄・読み方・💀強調演出対応版）

import { sendData } from './connection.js';
import { playSound } from './sounds.js';
import { currentGameState } from './lobby.js';
import { openRankingRegisterModal } from './ranking.js';

export let EISHIRI_DICTIONARY = [];
let isDictionaryLoaded = false;

// ⚙️ 【要調整】持ち時間やゲームバランス・COM難易度の定数設定
export const EISHIRI_CONFIG = {
  INITIAL_TIME: 50,       // 初期持ち時間（秒）
  CORRECT_BONUS: 10,      // 正解時の加算秒数
  MISTAKE_PENALTY: 3,     // ミス（不正解）時の減算秒数
  PASS_PENALTY: 5,        // パス時の減算秒数
  BOARD_SIZE: 16,         // 盤面のタイル枚数
  COM_ACCURACY_MIN: 0.50, // COM基本正答率（下限 50%）
  COM_ACCURACY_MAX: 0.70, // COM基本正答率（上限 70%）
  COM_THINK_BASE_RATE: 5  // COM思考時間・補正計算の基準レート（5秒）
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
      
      const cols = line.split(',').map(c => c.trim());
      const emoji = cols[0];
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
          
          const baseAcc = (slot.type === 'com') 
            ? EISHIRI_CONFIG.COM_ACCURACY_MIN + Math.random() * (EISHIRI_CONFIG.COM_ACCURACY_MAX - EISHIRI_CONFIG.COM_ACCURACY_MIN)
            : 1.0;

          eishiriState.players.push({
            id: playerId,
            slotId: slot.slotId,
            name: slot.name || `${slot.slotId + 1}P`,
            type: slot.type,
            baseAccuracy: baseAcc,
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

  let validStartChars = [];
  eishiriState.boardTiles.forEach(tile => {
    tile.readings.forEach(r => {
      const firstChar = normalizeChar(r.charAt(0));
      if (firstChar !== 'ん' && firstChar !== 'ン') {
        validStartChars.push(firstChar);
      }
    });
  });
  if (validStartChars.length > 0) {
    eishiriState.currentLastChar = validStartChars[Math.floor(Math.random() * validStartChars.length)];
  } else {
    eishiriState.currentLastChar = 'あ';
  }

  checkAndResolveDeadlock(true);

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

  const activePlayers = eishiriState.players.filter(p => !p.isEliminated);

  if (activePlayers.length <= 1) {
    setTimeout(() => {
      finishBattleGame(activePlayers[0]);
    }, 2400);
  } else {
    setTimeout(() => {
      nextTurn();
    }, 2400);
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

function checkAndResolveDeadlock(isInitial = false) {
  let hasValidMove = false;
  for (let tile of eishiriState.boardTiles) {
    const res = checkTileConnection(tile, eishiriState.currentLastChar);
    if (res.isValid) {
      hasValidMove = true;
      break;
    }
  }

  if (!hasValidMove) {
    generateBoardTiles(EISHIRI_CONFIG.BOARD_SIZE);
    triggerBoardRotateAnimation();

    let safetyCheck = false;
    for (let tile of eishiriState.boardTiles) {
      if (checkTileConnection(tile, eishiriState.currentLastChar).isValid) {
        safetyCheck = true;
        break;
      }
    }
    if (!safetyCheck) {
      generateBoardTiles(EISHIRI_CONFIG.BOARD_SIZE);
    }

    const noticeText = `⚠️ 回答がないためパネルを入れ替えました！`;
    if (eishiriState.mode === 'multi' && isHostPlayer && !isInitial) {
      syncStateToClients({
        type: 'EISHIRI_NOTICE_POPUP',
        text: noticeText,
        bg: "#ef6c00"
      });
    }
    showNoticePopup(noticeText, "#ef6c00", "#fff");
  }
}

function checkAndRunComTurn() {
  if (!isHostPlayer || !eishiriState.isPlaying || eishiriState.isPaused) return;

  const currentPlayer = eishiriState.players[eishiriState.currentTurnIndex];
  if (currentPlayer && currentPlayer.type === 'com' && !currentPlayer.isEliminated) {
    let correctCount = 0;
    eishiriState.boardTiles.forEach((tile) => {
      const res = checkTileConnection(tile, eishiriState.currentLastChar);
      if (res.isValid) correctCount++;
    });

    const totalCount = eishiriState.boardTiles.length || EISHIRI_CONFIG.BOARD_SIZE;
    const rate = EISHIRI_CONFIG.COM_THINK_BASE_RATE;

    const thinkSeconds = Math.max(0.8, rate - ((correctCount / totalCount) * rate));
    const thinkTimeMs = Math.round(thinkSeconds * 1000);

    if (comThinkingTimeout) clearTimeout(comThinkingTimeout);
    comThinkingTimeout = setTimeout(() => {
      if (!eishiriState.isPlaying) return;
      runComTurn(correctCount, totalCount);
    }, thinkTimeMs);
  }
}

async function runComTurn(correctCount, totalCount) {
  const currentPlayer = eishiriState.players[eishiriState.currentTurnIndex];
  if (!currentPlayer || currentPlayer.isEliminated) return;

  checkAndResolveDeadlock();

  let validIndices = [];
  eishiriState.boardTiles.forEach((tile, index) => {
    const res = checkTileConnection(tile, eishiriState.currentLastChar);
    if (res.isValid) validIndices.push({ index, res });
  });

  const baseAcc = currentPlayer.baseAccuracy || EISHIRI_CONFIG.COM_ACCURACY_MIN;
  const adjustedAccuracy = Math.min(1.0, baseAcc + ((correctCount / totalCount) * 0.50));

  const willAnswerCorrectly = (validIndices.length > 0) && (Math.random() < adjustedAccuracy);

  const safeValidIndices = validIndices.filter(v => {
    if (v.res.isDobon) return Math.random() < 0.20;
    return true;
  });

  if (willAnswerCorrectly && safeValidIndices.length > 0) {
    const chosen = safeValidIndices[Math.floor(Math.random() * safeValidIndices.length)];
    const tile = eishiriState.boardTiles[chosen.index];
    
    if (chosen.res.isDobon) {
      playSound('gameover');
      if (eishiriState.mode === 'multi' && isHostPlayer) {
        syncStateToClients({
          type: 'EISHIRI_ACTION_EFFECT',
          playerName: currentPlayer.name,
          emoji: tile.emoji,
          reading: chosen.res.matchedReading,
          deltaText: "ドボン！",
          actionType: 'dobon'
        });
      }
      showActionEffect(currentPlayer, tile.emoji, chosen.res.matchedReading, "ドボン！", "dobon");
      eliminatePlayer(currentPlayer, `「${chosen.res.matchedReading}」でドボン`);
    } else {
      eishiriState.isPaused = true;
      playSound('win');
      
      highlightTile(chosen.index);
      currentPlayer.timeRemaining += EISHIRI_CONFIG.CORRECT_BONUS;
      currentPlayer.score++;
      eishiriState.currentLastChar = chosen.res.nextChar;
      eishiriState.boardTiles[chosen.index] = getUniqueRandomTile();
      
      const deltaText = `+${EISHIRI_CONFIG.CORRECT_BONUS}秒 ✨`;
      if (eishiriState.mode === 'multi' && isHostPlayer) {
        syncStateToClients({
          type: 'EISHIRI_ACTION_EFFECT',
          playerName: currentPlayer.name,
          emoji: tile.emoji,
          reading: chosen.res.matchedReading,
          deltaText: deltaText,
          actionType: 'correct'
        });
      }
      
      showActionEffect(currentPlayer, tile.emoji, chosen.res.matchedReading, deltaText, "correct");
      await new Promise(r => setTimeout(r, 2200));

      nextTurn();
    }
  } else {
    if (validIndices.length === 0 || Math.random() < 0.5) {
      eishiriState.isPaused = true;
      currentPlayer.timeRemaining = Math.max(0, currentPlayer.timeRemaining - EISHIRI_CONFIG.PASS_PENALTY);
      triggerBoardRotateAnimation();
      
      const deltaText = `-${EISHIRI_CONFIG.PASS_PENALTY}秒 🔄`;
      if (eishiriState.mode === 'multi' && isHostPlayer) {
        syncStateToClients({
          type: 'EISHIRI_ACTION_EFFECT',
          playerName: currentPlayer.name,
          emoji: "🔄",
          reading: null,
          deltaText: deltaText,
          actionType: 'pass'
        });
      }
      showActionEffect(currentPlayer, "🔄", null, deltaText, "pass");
      generateBoardTiles(EISHIRI_CONFIG.BOARD_SIZE);
      
      await new Promise(r => setTimeout(r, 1400));

      if (currentPlayer.timeRemaining <= 0) {
        eliminatePlayer(currentPlayer, "時間切れ");
        return;
      }
      nextTurn();
    } else {
      eishiriState.isPaused = true;
      playSound('put');
      
      const wrongIndices = [];
      eishiriState.boardTiles.forEach((tile, idx) => {
        if (!checkTileConnection(tile, eishiriState.currentLastChar).isValid) {
          wrongIndices.push(idx);
        }
      });
      const chosenWrongEmoji = (wrongIndices.length > 0) 
        ? eishiriState.boardTiles[wrongIndices[Math.floor(Math.random() * wrongIndices.length)]].emoji
        : "💦";

      currentPlayer.timeRemaining = Math.max(0, currentPlayer.timeRemaining - EISHIRI_CONFIG.MISTAKE_PENALTY);
      
      const deltaText = `-${EISHIRI_CONFIG.MISTAKE_PENALTY}秒 💦`;
      if (eishiriState.mode === 'multi' && isHostPlayer) {
        syncStateToClients({
          type: 'EISHIRI_ACTION_EFFECT',
          playerName: currentPlayer.name,
          emoji: chosenWrongEmoji,
          reading: null,
          deltaText: deltaText,
          actionType: 'mistake'
        });
      }
      showActionEffect(currentPlayer, chosenWrongEmoji, null, deltaText, "mistake");
      
      syncStateToClients();
      renderEishiriUI();

      await new Promise(r => setTimeout(r, 1400));

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

  checkAndResolveDeadlock();

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
  eishiriState.isPaused = true;
  playSound('put');
  currentPlayer.timeRemaining -= EISHIRI_CONFIG.PASS_PENALTY;
  
  generateBoardTiles(EISHIRI_CONFIG.BOARD_SIZE);
  triggerBoardRotateAnimation();
  
  const deltaText = `-${EISHIRI_CONFIG.PASS_PENALTY}秒 🔄`;
  if (eishiriState.mode === 'multi' && isHostPlayer) {
    syncStateToClients({
      type: 'EISHIRI_ACTION_EFFECT',
      playerName: currentPlayer.name,
      emoji: "🔄",
      reading: null,
      deltaText: deltaText,
      actionType: 'pass'
    });
  }
  showActionEffect(currentPlayer, "🔄", null, deltaText, "pass");

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
    setTimeout(() => {
      renderEishiriUI();
      eishiriState.isPaused = false;
    }, 1400);
  } else {
    setTimeout(() => {
      nextTurn();
    }, 1400);
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
      const cleanReading = reading.replace(/ー+$/, "");
      const lastOriginalChar = cleanReading.charAt(cleanReading.length - 1);
      
      const isDobon = (lastOriginalChar === 'ん' || lastOriginalChar === 'ン');
      const normalizedLastChar = normalizeChar(lastOriginalChar);

      return {
        isValid: true,
        matchedReading: reading,
        isDobon: isDobon,
        nextChar: isDobon ? '' : normalizedLastChar
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
    eishiriState.isPaused = true;
    playSound('put');
    currentPlayer.timeRemaining = Math.max(0, currentPlayer.timeRemaining - EISHIRI_CONFIG.MISTAKE_PENALTY);
    
    const deltaText = `-${EISHIRI_CONFIG.MISTAKE_PENALTY}秒 💦`;
    if (eishiriState.mode === 'multi' && isHostPlayer) {
      syncStateToClients({
        type: 'EISHIRI_ACTION_EFFECT',
        playerName: currentPlayer.name,
        emoji: tile.emoji,
        reading: null,
        deltaText: deltaText,
        actionType: 'mistake'
      });
      syncStateToClients();
      renderEishiriUI();
    }
    showActionEffect(currentPlayer, tile.emoji, null, deltaText, "mistake");
    updateTimerUI();

    await new Promise(r => setTimeout(r, 1400));

    if (currentPlayer.timeRemaining <= 0) {
      if (eishiriState.mode === 'solo') {
        endSoloGame("タイムアップ！ゲームオーバー…");
      } else {
        eliminatePlayer(currentPlayer, "時間切れ");
      }
      return;
    }

    eishiriState.isPaused = false;
    return;
  }

  // 💀 ドボン時（語尾が「ん」）の処理
  if (matchedResult.isDobon) {
    eishiriState.isPaused = true;
    playSound('gameover');
    if (eishiriState.mode === 'multi' && isHostPlayer) {
      syncStateToClients({
        type: 'EISHIRI_ACTION_EFFECT',
        playerName: currentPlayer.name,
        emoji: tile.emoji, // 選択した絵柄を送信
        reading: matchedResult.matchedReading, // 読み方を送信
        deltaText: "ドボン！",
        actionType: 'dobon'
      });
    }
    showActionEffect(currentPlayer, tile.emoji, matchedResult.matchedReading, "ドボン！", "dobon");

    if (eishiriState.mode === 'solo') {
      endSoloGame(`👤 「${matchedResult.matchedReading}」でドボン！ゲームオーバー…`);
    } else {
      eliminatePlayer(currentPlayer, `「${matchedResult.matchedReading}」でドボン`);
    }
    return;
  }

  eishiriState.isPaused = true;
  playSound('win');

  highlightTile(index);
  currentPlayer.timeRemaining += EISHIRI_CONFIG.CORRECT_BONUS;
  currentPlayer.score++;
  eishiriState.currentLastChar = matchedResult.nextChar;
  eishiriState.boardTiles[index] = getUniqueRandomTile();

  const deltaText = `+${EISHIRI_CONFIG.CORRECT_BONUS}秒 ✨`;
  if (eishiriState.mode === 'multi' && isHostPlayer) {
    syncStateToClients({
      type: 'EISHIRI_ACTION_EFFECT',
      playerName: currentPlayer.name,
      emoji: tile.emoji,
      reading: matchedResult.matchedReading,
      deltaText: deltaText,
      actionType: 'correct'
    });
  }

  showActionEffect(currentPlayer, tile.emoji, matchedResult.matchedReading, deltaText, "correct");
  await new Promise(r => setTimeout(r, 2200));

  if (eishiriState.mode === 'solo') {
    renderEishiriUI();
    eishiriState.isPaused = false;
  } else {
    eishiriState.isPaused = false;
    nextTurn();
  }
}

function showNoticePopup(text, bgColor = "#ef6c00", textColor = "#fff") {
  let popup = document.getElementById('eishiri-notice-popup');
  if (!popup) {
    popup = document.createElement('div');
    popup.id = 'eishiri-notice-popup';
    popup.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%) scale(0.9);
      transition: all 0.25s cubic-bezier(0.175, 0.885, 0.32, 1.275);
      z-index: 9999;
      pointer-events: none;
      opacity: 0;
    `;
    const gameScreen = document.getElementById('eishiri-game-screen');
    if (gameScreen) gameScreen.appendChild(popup);
    else document.body.appendChild(popup);
  }

  popup.style.background = bgColor;
  popup.style.color = textColor;
  popup.style.padding = '24px 40px';
  popup.style.borderRadius = '20px';
  popup.style.boxShadow = '0 15px 40px rgba(0,0,0,0.5)';
  popup.style.textAlign = 'center';
  popup.style.fontSize = '24px';
  popup.style.fontWeight = '900';
  popup.style.letterSpacing = '1px';
  popup.style.border = '4px solid #fff';

  popup.innerHTML = `<div>${text}</div>`;
  
  popup.style.display = 'block';
  void popup.offsetWidth;
  popup.style.transform = 'translate(-50%, -50%) scale(1)';
  popup.style.opacity = '1';

  playSound('put');

  setTimeout(() => {
    popup.style.transform = 'translate(-50%, -50%) scale(0.9)';
    popup.style.opacity = '0';
    setTimeout(() => {
      popup.style.display = 'none';
    }, 250);
  }, 2000);
}

// 🌟 行動選択演出ポップアップ表示関数（正解・間違い・パス・ドボン全演出対応）
function showActionEffect(player, emoji, reading, deltaText, actionType) {
  const popup = document.getElementById('eishiri-big-popup');
  if (!popup) return;

  let bg = '#0288d1';
  if (actionType === 'correct') bg = '#2e7d32'; // 緑
  else if (actionType === 'mistake') bg = '#c62828'; // 赤
  else if (actionType === 'dobon') bg = '#37474f'; // ドボン（ダークグレー）
  else if (actionType === 'pass') bg = '#ef6c00'; // オレンジ

  popup.style.background = bg;
  popup.style.color = '#fff';
  popup.style.padding = '22px 35px';
  popup.style.borderRadius = '20px';
  popup.style.boxShadow = '0 12px 35px rgba(0,0,0,0.4)';
  popup.style.textAlign = 'center';
  popup.style.minWidth = '300px';
  popup.style.zIndex = '9998';

  let playerName = (typeof player === 'string') ? player : (player ? player.name : '');

  let html = `
    <div style="font-size: 15px; opacity: 0.95; margin-bottom: 6px; font-weight: bold; letter-spacing: 1px;">🎮 ${playerName} の選択</div>
    <div style="display: flex; align-items: center; justify-content: center; gap: 20px; margin: 10px 0;">
      <span style="font-size: 64px; line-height: 1; filter: drop-shadow(0 4px 8px rgba(0,0,0,0.2));">${emoji}</span>
      <span style="font-size: 24px; font-weight: 900; background: rgba(0,0,0,0.25); padding: 6px 14px; border-radius: 10px; letter-spacing: 1px;">${deltaText}</span>
    </div>
  `;

  // 正解またはドボン時に読み方アニメーション枠を追加
  if (reading && (actionType === 'correct' || actionType === 'dobon')) {
    const textColor = (actionType === 'dobon') ? '#ff8a80' : '#fffde7';
    html += `<div id="popup-reading-anim" style="font-size: 28px; font-weight: bold; margin-top: 10px; letter-spacing: 3px; min-height: 40px; color: ${textColor}; text-shadow: 0 2px 4px rgba(0,0,0,0.3);"></div>`;
  }

  popup.innerHTML = html;
  popup.classList.add('show');

  // タイピングアニメーション（正解 ＆ ドボン）
  if (reading && (actionType === 'correct' || actionType === 'dobon')) {
    const readingEl = document.getElementById('popup-reading-anim');
    if (readingEl) {
      let charIdx = 0;
      readingEl.innerText = (actionType === 'dobon') ? '💀 ' : '';
      const typeInterval = setInterval(() => {
        if (charIdx < reading.length) {
          readingEl.innerText += reading.charAt(charIdx);
          charIdx++;
        } else {
          if (actionType === 'dobon') {
            readingEl.innerText += ' 💀'; // ドボン時は後ろにも💀を付与
          }
          clearInterval(typeInterval);
        }
      }, 160);
    }
  }

  // ポップアップ表示時間設定
  const displayTime = (reading && (actionType === 'correct' || actionType === 'dobon')) ? 2400 : 1300;
  setTimeout(() => {
    popup.classList.remove('show');
  }, displayTime);
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
    btn.style = 'color: #333; background: #fff; border: 2px solid #ad1457; border-radius: 8px; font-size: 32px; height: 65px; display: flex; align-items: center; justify-content: center; cursor: pointer; padding: 0; margin: 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1); transition: all 0.2s ease;';
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
      if (cmd.type === 'EISHIRI_ACTION_EFFECT') {
        showActionEffect(cmd.playerName, cmd.emoji, cmd.reading, cmd.deltaText, cmd.actionType);
      } else if (cmd.type === 'EISHIRI_NOTICE_POPUP') {
        showNoticePopup(cmd.text, cmd.bg);
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