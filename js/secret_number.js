// js/secret_number.js - 3枚の数字推測パズル（UI更新・ロジック専用版）

import { sendData } from './connection.js';
import { playSound } from './sounds.js';
import { currentGameState } from './lobby.js';
import { openRankingRegisterModal } from './ranking.js';

export const SECRET_CONFIG = {
  CARD_COUNT: 3,
  MIN_NUMBER: 1,
  MAX_NUMBER: 9
};

let secretState = {
  mode: 'solo',
  isPlaying: false,
  isPaused: false,
  secretCards: [],
  hintCount: 0,
  hintsByCategory: {
    oddeven: [],
    compare: [],
    sum: [],
    range: []
  },
  allHintsLog: [],
  players: [],
  currentTurnIndex: 0,
  eliminatedPlayers: [],
  guesses: ["", "", ""],
  lastPopupMsg: "",
  gameOverInfo: null
};

let hostFlag = false;
let customSendFunc = null;
let isActionProcessing = false;

export function initSecretNumberSystem(isHost, sendFunc) {
  hostFlag = isHost;
  customSendFunc = sendFunc;
  
  // セレクトボックスの変更イベントを紐付け
  document.querySelectorAll('.secret-guess-select').forEach(select => {
    select.onchange = (e) => {
      const idx = parseInt(e.target.getAttribute('data-index'));
      secretState.guesses[idx] = e.target.value;
      renderHintsListByCategory();
    };
  });
}

export function getSecretNumberMode() {
  return secretState.mode;
}

// 🎮 ゲーム開始
export async function startSecretNumberGame(isHost, mode = 'solo') {
  hostFlag = isHost;
  secretState.mode = mode;

  secretState.isPlaying = true;
  secretState.isPaused = false;
  secretState.hintCount = 0;
  secretState.hintsByCategory = { oddeven: [], compare: [], sum: [], range: [] };
  secretState.allHintsLog = [];
  secretState.currentTurnIndex = 0;
  secretState.eliminatedPlayers = [];
  secretState.guesses = ["", "", ""];
  secretState.lastPopupMsg = "ゲーム開始！調査アクションを選んでヒントを集めよう。";
  secretState.gameOverInfo = null;
  isActionProcessing = false;

  hideSecretResultOverlay();
  resetActionButtonsToDefault();

  if (isHost || mode === 'solo') {
    secretState.secretCards = generateSecretCards(SECRET_CONFIG.CARD_COUNT);
    
    if (mode === 'multi') {
      if (currentGameState && currentGameState.slots) {
        secretState.players = currentGameState.slots
          .filter(s => s.type !== 'none')
          .map(s => ({
            id: s.connId || s.type,
            name: s.name,
            type: s.type,
            slotId: s.slotId,
            isSkipped: false
          }));
      } else {
        secretState.players = [{ id: 'host', name: 'ホスト', type: 'host', slotId: 0, isSkipped: false }];
      }
    } else {
      secretState.players = [{ id: 'player', name: 'あなた', type: 'host', slotId: 0, isSkipped: false }];
    }

    if (mode === 'multi' && customSendFunc) {
      customSendFunc({
        type: 'SECRET_STATE_SYNC',
        payload: { 
          secretCards: secretState.secretCards,
          players: secretState.players,
          currentTurnIndex: secretState.currentTurnIndex,
          hintCount: secretState.hintCount,
          hintsByCategory: secretState.hintsByCategory,
          allHintsLog: secretState.allHintsLog,
          eliminatedPlayers: secretState.eliminatedPlayers,
          guesses: secretState.guesses,
          lastPopupMsg: secretState.lastPopupMsg
        }
      });
    }
  }

  // 他のゲームと同様に .screen クラスを切り替え
  document.querySelectorAll('.screen').forEach(s => {
    s.classList.remove('active');
    if (s.id === 'secret-game-screen') s.style.display = 'none';
  });

  const screenEl = document.getElementById('secret-game-screen');
  if (screenEl) {
    screenEl.style.display = 'flex';
    screenEl.classList.add('active');
  }

  renderSecretUI();
  playSound('put');
  checkComTurn();
}

// 通信データ処理（マルチ対戦用）
export function processSecretData(data) {
  if (data.type === 'SECRET_STATE_SYNC') {
    secretState.secretCards = data.payload.secretCards;
    secretState.players = data.payload.players || secretState.players;
    secretState.currentTurnIndex = data.payload.currentTurnIndex ?? secretState.currentTurnIndex;
    secretState.hintCount = data.payload.hintCount ?? secretState.hintCount;
    secretState.hintsByCategory = data.payload.hintsByCategory || secretState.hintsByCategory;
    secretState.allHintsLog = data.payload.allHintsLog || secretState.allHintsLog;
    secretState.eliminatedPlayers = data.payload.eliminatedPlayers || secretState.eliminatedPlayers;
    secretState.guesses = data.payload.guesses || secretState.guesses;
    secretState.lastPopupMsg = data.payload.lastPopupMsg || secretState.lastPopupMsg;
    renderSecretUI();
    checkComTurn();
  } else if (data.type === 'SECRET_ACTION_EXEC') {
    secretState.hintCount = data.payload.hintCount;
    secretState.hintsByCategory = data.payload.hintsByCategory;
    secretState.allHintsLog = data.payload.allHintsLog;
    secretState.currentTurnIndex = data.payload.currentTurnIndex;
    secretState.eliminatedPlayers = data.payload.eliminatedPlayers || secretState.eliminatedPlayers;
    secretState.players = data.payload.players || secretState.players;
    secretState.lastPopupMsg = data.payload.latestMsg;
    renderSecretUI();
    checkComTurn();
  } else if (data.type === 'SECRET_GAME_OVER') {
    endSecretGameByOther(data.payload.winnerName, data.payload.isWin);
  } else if (data.type === 'SECRET_REMATCH') {
    startSecretNumberGame(hostFlag, secretState.mode);
  }
}

function generateSecretCards(count) {
  const numbers = [];
  for (let i = SECRET_CONFIG.MIN_NUMBER; i <= SECRET_CONFIG.MAX_NUMBER; i++) {
    numbers.push(i);
  }
  for (let i = numbers.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [numbers[i], numbers[j]] = [numbers[j], numbers[i]];
  }
  return numbers.slice(0, count);
}

// ==========================================
// 🤖 COMの自動思考処理
// ==========================================
function checkComTurn() {
  if (!secretState.isPlaying || secretState.isPaused) return;
  const currentP = secretState.players[secretState.currentTurnIndex];
  if (!currentP || secretState.eliminatedPlayers.includes(currentP.id)) {
    advanceTurn();
    return;
  }

  if (currentP.isSkipped) {
    currentP.isSkipped = false;
    const skipMsg = `${currentP.name}はペナルティの【1回休み】のためスキップされました。`;
    secretState.lastPopupMsg = skipMsg;
    advanceTurn();
    renderSecretUI();
    checkComTurn();
    return;
  }

  if (hostFlag && currentP.type === 'com') {
    const thinkTime = 2000 + Math.random() * 1000;
    setTimeout(() => {
      executeComAction(currentP);
    }, thinkTime);
  }
}

function executeComAction(comP) {
  if (!secretState.isPlaying || secretState.isPaused) return;

  const possibleCandidates = getAllPossibleCombinations();
  const filtered = possibleCandidates.filter(guess => checkGuessValidByHints(guess));

  let answerChance = Math.min(0.9, (secretState.hintCount / 15.0) + (filtered.length <= 3 ? 0.4 : 0.0));

  if (filtered.length === 1 || (filtered.length <= 5 && Math.random() < answerChance)) {
    let guessToTry = filtered.length === 1 ? filtered[0] : filtered[Math.floor(Math.random() * filtered.length)];
    let isCorrect = (guessToTry.join('') === secretState.secretCards.join(''));

    if (!isCorrect && filtered.length > 1) {
      guessToTry = generateWrongGuess();
    }

    if (isCorrect || Math.random() < answerChance) {
      handleComAnswer(comP, guessToTry, isCorrect);
      return;
    }
  }

  const availableActionTypes = getAvailableActionTypes();
  if (availableActionTypes.length === 0) {
    const chosenGuess = filtered.length > 0 ? filtered[0] : generateWrongGuess();
    handleComAnswer(comP, chosenGuess, chosenGuess.join('') === secretState.secretCards.join(''));
    return;
  }

  const chosenAction = availableActionTypes[Math.floor(Math.random() * availableActionTypes.length)];
  executeSecretActionForPlayer(chosenAction, comP.name);
}

function getAvailableActionTypes() {
  const types = [];
  const cards = secretState.secretCards;
  
  const checkedOddevenIndices = secretState.hintsByCategory.oddeven.map(h => h.index);
  if (checkedOddevenIndices.length < cards.length) types.push('oddeven');

  const maxComparePairs = cards.length * (cards.length - 1);
  if (secretState.hintsByCategory.compare.length < maxComparePairs) types.push('compare');

  const maxSums = (cards.length * (cards.length - 1)) / 2;
  if (secretState.hintsByCategory.sum.length < maxSums) types.push('sum');

  const checkedRangeIndices = secretState.hintsByCategory.range.map(h => h.index);
  if (checkedRangeIndices.length < cards.length) types.push('range');

  return types;
}

function getAllPossibleCombinations() {
  const results = [];
  const min = SECRET_CONFIG.MIN_NUMBER;
  const max = SECRET_CONFIG.MAX_NUMBER;
  for (let i = min; i <= max; i++) {
    for (let j = min; j <= max; j++) {
      if (j === i) continue;
      for (let k = min; k <= max; k++) {
        if (k === i || k === j) continue;
        results.push([i, j, k]);
      }
    }
  }
  return results;
}

function checkGuessValidByHints(guess) {
  const cats = secretState.hintsByCategory;
  for (let h of cats.oddeven) {
    const actualOdd = guess[h.index] % 2 !== 0;
    if (actualOdd !== h.value) return false;
  }
  for (let h of cats.compare) {
    const v1 = guess[h.idx1], v2 = guess[h.idx2];
    const ok = h.comp === '大きい' ? v1 > v2 : v1 < v2;
    if (!ok) return false;
  }
  for (let h of cats.sum) {
    if ((guess[h.idx1] + guess[h.idx2]) !== h.sumVal) return false;
  }
  for (let h of cats.range) {
    const val = guess[h.index];
    const ok = h.isHigher ? val >= h.threshold : val < h.threshold;
    if (!ok) return false;
  }
  return true;
}

function generateWrongGuess() {
  const correct = secretState.secretCards;
  while (true) {
    const candidate = generateSecretCards(SECRET_CONFIG.CARD_COUNT);
    if (candidate.join('') !== correct.join('')) {
      return candidate;
    }
  }
}

function handleComAnswer(comP, guessArr, isCorrect) {
  const guessStr = guessArr.join('');
  let msg = `${comP.name}が【${guessStr}】と解答！ ➔ `;
  if (isCorrect) {
    msg += `【正解！】`;
    secretState.lastPopupMsg = msg;
    if (customSendFunc) {
      customSendFunc({
        type: 'SECRET_GAME_OVER',
        payload: { isWin: false, winnerName: comP.name }
      });
    }
    endSecretGameByOther(comP.name, true);
  } else {
    msg += `【不正解…ペナルティで1回休み】`;
    secretState.lastPopupMsg = msg;
    comP.isSkipped = true;
    advanceTurn();
    
    if (customSendFunc) {
      customSendFunc({
        type: 'SECRET_ACTION_EXEC',
        payload: {
          hintCount: secretState.hintCount,
          hintsByCategory: secretState.hintsByCategory,
          allHintsLog: secretState.allHintsLog,
          currentTurnIndex: secretState.currentTurnIndex,
          eliminatedPlayers: secretState.eliminatedPlayers,
          players: secretState.players,
          guesses: secretState.guesses,
          latestMsg: msg
        }
      });
    }
    renderSecretUI();
    checkComTurn();
  }
}

// ==========================================
// 🔍 調査アクション実行
// ==========================================
export function executeSecretAction(type) {
  if (!secretState.isPlaying || secretState.isPaused || isActionProcessing) return;

  if (secretState.mode === 'multi' && secretState.players.length > 0) {
    const currentP = secretState.players[secretState.currentTurnIndex];
    if (currentP && currentP.type === 'com') return;
    
    if (currentP && currentP.isSkipped) {
      alert("あなたはペナルティの「1回休み」中です！次のターンまでお待ちください。");
      return;
    }
  }

  if (!canExecuteActionType(type)) {
    alert("この種類のヒントはすでにすべて調査し尽くしています！別のヒントを選んでください。");
    return;
  }

  isActionProcessing = true;
  executeSecretActionForPlayer(type, null);
  
  setTimeout(() => {
    isActionProcessing = false;
  }, 800);
}

function canExecuteActionType(type) {
  const cards = secretState.secretCards;
  if (type === 'oddeven') {
    const checked = secretState.hintsByCategory.oddeven.map(h => h.index);
    return checked.length < cards.length;
  }
  if (type === 'compare') {
    const maxPairs = cards.length * (cards.length - 1);
    return secretState.hintsByCategory.compare.length < maxPairs;
  }
  if (type === 'sum') {
    const maxSums = (cards.length * (cards.length - 1)) / 2;
    return secretState.hintsByCategory.sum.length < maxSums;
  }
  if (type === 'range') {
    const checked = secretState.hintsByCategory.range.map(h => h.index);
    return checked.length < cards.length;
  }
  return true;
}

function executeSecretActionForPlayer(type, actorNamePrefix) {
  secretState.hintCount++;
  playSound('put');

  let resultMsg = "";
  const cards = secretState.secretCards;
  const prefix = actorNamePrefix ? `${actorNamePrefix}が調査: ` : "";

  if (type === 'oddeven') {
    const checkedIndices = secretState.hintsByCategory.oddeven.map(h => h.index);
    let availableIndices = [];
    for (let i = 0; i < cards.length; i++) {
      if (!checkedIndices.includes(i)) availableIndices.push(i);
    }
    if (availableIndices.length === 0) return;
    const targetIdx = availableIndices[Math.floor(Math.random() * availableIndices.length)];
    const isOdd = cards[targetIdx] % 2 !== 0;
    resultMsg = `${prefix}${targetIdx + 1}番目のカードは【${isOdd ? '奇数' : '偶数'}】です。`;
    secretState.hintsByCategory.oddeven.push({ text: `${targetIdx + 1}番目のカードは【${isOdd ? '奇数' : '偶数'}】です。`, index: targetIdx, type: 'oddeven', value: isOdd });
  } 
  else if (type === 'compare') {
    let possiblePairs = [];
    for (let i = 0; i < cards.length; i++) {
      for (let j = 0; j < cards.length; j++) {
        if (i !== j) {
          const already = secretState.hintsByCategory.compare.some(h => h.idx1 === i && h.idx2 === j);
          if (!already) possiblePairs.push({ idx1: i, idx2: j });
        }
      }
    }
    if (possiblePairs.length === 0) return;
    const pair = possiblePairs[Math.floor(Math.random() * possiblePairs.length)];
    const comp = cards[pair.idx1] > cards[pair.idx2] ? '大きい' : '小さい';
    resultMsg = `${prefix}${pair.idx1 + 1}番目は ${pair.idx2 + 1}番目より【${comp}】です。`;
    secretState.hintsByCategory.compare.push({ text: `${pair.idx1 + 1}番目は ${pair.idx2 + 1}番目より【${comp}】です。`, idx1: pair.idx1, idx2: pair.idx2, comp });
  } 
  else if (type === 'sum') {
    let possibleSums = [];
    for (let i = 0; i < cards.length; i++) {
      for (let j = i + 1; j < cards.length; j++) {
        const already = secretState.hintsByCategory.sum.some(h => (h.idx1 === i && h.idx2 === j) || (h.idx1 === j && h.idx2 === i));
        if (!already) possibleSums.push({ idx1: i, idx2: j });
      }
    }
    if (possibleSums.length === 0) return;
    const pair = possibleSums[Math.floor(Math.random() * possibleSums.length)];
    const sumVal = cards[pair.idx1] + cards[pair.idx2];
    resultMsg = `${prefix}${pair.idx1 + 1}番目と ${pair.idx2 + 1}番目のカードの合計は【${sumVal}】です。`;
    secretState.hintsByCategory.sum.push({ text: `${pair.idx1 + 1}番目と ${pair.idx2 + 1}番目のカードの合計は【${sumVal}】です。`, idx1: pair.idx1, idx2: pair.idx2, sumVal });
  } 
  else if (type === 'range') {
    const checkedIndices = secretState.hintsByCategory.range.map(h => h.index);
    let availableIndices = [];
    for (let i = 0; i < cards.length; i++) {
      if (!checkedIndices.includes(i)) availableIndices.push(i);
    }
    if (availableIndices.length === 0) return;
    const targetIdx = availableIndices[Math.floor(Math.random() * availableIndices.length)];
    const val = cards[targetIdx];
    const half = Math.floor((SECRET_CONFIG.MAX_NUMBER - SECRET_CONFIG.MIN_NUMBER + 1) / 2) + SECRET_CONFIG.MIN_NUMBER;
    const isHigher = val >= half;
    resultMsg = `${prefix}${targetIdx + 1}番目のカードは【${isHigher ? half + '以上' : (half - 1) + '以下'}】です。`;
    secretState.hintsByCategory.range.push({ text: `${targetIdx + 1}番目のカードは【${isHigher ? half + '以上' : (half - 1) + '以下'}】です。`, index: targetIdx, isHigher, threshold: half });
  }

  secretState.allHintsLog.unshift(resultMsg);
  secretState.lastPopupMsg = resultMsg;

  advanceTurn();

  if (secretState.mode === 'multi' && customSendFunc) {
    customSendFunc({
      type: 'SECRET_ACTION_EXEC',
      payload: {
        hintCount: secretState.hintCount,
        hintsByCategory: secretState.hintsByCategory,
        allHintsLog: secretState.allHintsLog,
        currentTurnIndex: secretState.currentTurnIndex,
        eliminatedPlayers: secretState.eliminatedPlayers,
        players: secretState.players,
        guesses: secretState.guesses,
        latestMsg: resultMsg
      }
    });
  }

  renderSecretUI();
  checkComTurn();
}

function advanceTurn() {
  if (secretState.players.length === 0) return;
  let loopCount = 0;
  do {
    secretState.currentTurnIndex = (secretState.currentTurnIndex + 1) % secretState.players.length;
    loopCount++;
    const nextP = secretState.players[secretState.currentTurnIndex];
    if (!secretState.eliminatedPlayers.includes(nextP.id)) {
      break;
    }
  } while (loopCount < secretState.players.length);
}

// ==========================================
// 💡 回答ボタンの処理
// ==========================================
window.submitSecretAnswerFromMain = function() {
  if (!secretState.isPlaying || secretState.isPaused) return;

  if (secretState.mode === 'multi' && secretState.players.length > 0) {
    const currentP = secretState.players[secretState.currentTurnIndex];
    if (currentP && currentP.type === 'com') {
      alert("今はCOMのターンです。自分の順番までお待ちください。");
      return;
    }
    if (currentP && currentP.isSkipped) {
      alert("あなたはペナルティの「1回休み」中です！次のターンまで解答できません。");
      return;
    }
  }

  const valStr = secretState.guesses.join('');
  if (valStr.length !== SECRET_CONFIG.CARD_COUNT || secretState.guesses.some(g => g === "")) {
    alert(`${SECRET_CONFIG.CARD_COUNT}枚すべての選択肢から数字を選んでください！`);
    return;
  }

  const userGuess = secretState.guesses.map(Number);
  const correct = secretState.secretCards;

  let isCorrect = true;
  for (let i = 0; i < correct.length; i++) {
    if (userGuess[i] !== correct[i]) {
      isCorrect = false;
      break;
    }
  }

  const myPlayer = secretState.players[secretState.currentTurnIndex] || { name: 'あなた', id: 'player' };

  if (isCorrect) {
    playSound('win');
    endSecretGame(true, myPlayer.name);
  } else {
    playSound('gameover');
    if (secretState.mode === 'solo') {
      endSecretGame(false, myPlayer.name);
    } else {
      alert("不正解です…！ペナルティとして【1回休み】（次の自分のターンがスキップ）になります。");
      myPlayer.isSkipped = true;
      advanceTurn();
      
      if (customSendFunc) {
        customSendFunc({
          type: 'SECRET_ACTION_EXEC',
          payload: {
            hintCount: secretState.hintCount,
            hintsByCategory: secretState.hintsByCategory,
            allHintsLog: secretState.allHintsLog,
            currentTurnIndex: secretState.currentTurnIndex,
            eliminatedPlayers: secretState.eliminatedPlayers,
            players: secretState.players,
            guesses: secretState.guesses,
            latestMsg: `${myPlayer.name}が【${valStr}】と解答しましたが【不正解（1回休み）】でした！`
          }
        });
      }
      renderSecretUI();
      checkComTurn();
    }
  }
};

// ==========================================
// 🏆 勝敗決定後の処理
// ==========================================
function endSecretGame(isWin, winnerName) {
  secretState.isPlaying = false;
  secretState.isPaused = false;
  triggerGameOverUI(isWin ? 'win' : 'lose', isWin ? '🎉 正解！' : '💥 ゲームオーバー', isWin ? `正解の数字: ${secretState.secretCards.join('')}<br>ヒント使用回数: ${secretState.hintCount}回` : `残念！答えは ${secretState.secretCards.join('')} でした。`);
  if (isWin && typeof openRankingRegisterModal === 'function' && secretState.mode === 'solo') {
    openRankingRegisterModal('secret_number', secretState.hintCount);
  }
}

function endSecretGameByOther(winnerName, isWin) {
  secretState.isPlaying = false;
  secretState.isPaused = false;
  triggerGameOverUI('lose', `🏆 ${winnerName}の勝利！`, `正解の数字は ${secretState.secretCards.join('')} でした。`);
}

function triggerGameOverUI(resultType, titleText, descText) {
  let overlay = document.getElementById('secret-result-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'secret-result-overlay';
    const screenEl = document.getElementById('secret-game-screen');
    if (screenEl) screenEl.appendChild(overlay);
  }
  overlay.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
    display: flex; justify-content: center; align-items: center;
    background: rgba(0,0,0,0.6); z-index: 10000;
    opacity: 0; transition: opacity 0.4s ease;
  `;

  overlay.innerHTML = `
    <div style="background: #fff; padding: 25px 35px; border-radius: 16px; text-align: center; box-shadow: 0 10px 30px rgba(0,0,0,0.4); max-width: 340px; width: 90%; color: #333; transform: scale(0.8); transition: transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);">
      <div style="font-size: 34px; font-weight: 900; color: ${resultType === 'win' ? '#f57f17' : '#d32f2f'}; margin-bottom: 8px;">${titleText}</div>
      <div style="font-size: 15px; color: #555; line-height: 1.5;">${descText}</div>
    </div>
  `;

  overlay.style.display = 'flex';
  requestAnimationFrame(() => {
    overlay.style.opacity = '1';
    overlay.firstElementChild.style.transform = 'scale(1)';
  });

  setTimeout(() => {
    hideSecretResultOverlay();
    replaceActionButtonsWithRematch();
  }, 3000);
}

function hideSecretResultOverlay() {
  const overlay = document.getElementById('secret-result-overlay');
  if (overlay) {
    overlay.classList.remove('show');
    overlay.innerHTML = '';
    overlay.style.display = 'none';
  }
}

function replaceActionButtonsWithRematch() {
  const actionContainer = document.getElementById('secret-action-buttons-container');
  if (!actionContainer) return;

  actionContainer.innerHTML = `
    <div style="font-weight: bold; margin-bottom: 3px; font-size: 11px; color: #333;">【 勝負終了 】</div>
    <div style="display: flex; flex-direction: column; gap: 4px; max-width: 450px; margin: 0 auto;">
      <button class="btn-action" onclick="window.executeSecretRematch()" style="background: #4caf50; color: white; padding: 8px; border-radius: 6px; font-weight: bold; font-size: 13px; border: none; cursor: pointer; box-shadow: 0 3px 8px rgba(0,0,0,0.2);">🔄 もう一度遊ぶ（再戦）</button>
    </div>
  `;
}

function resetActionButtonsToDefault() {
  const actionContainer = document.getElementById('secret-action-buttons-container');
  if (!actionContainer) return;
  actionContainer.innerHTML = `
    <div style="font-weight: bold; margin-bottom: 2px; font-size: 10px; color: #555;">【 調査アクションを選ぶ（1回につきヒント+1） 】</div>
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 3px; max-width: 450px; margin: 0 auto;">
      <button class="btn-action" onclick="window.secretActionOddEven()" style="background: #0288d1; padding: 4px; font-size: 11px; min-height: 30px;">🔍 奇数・偶数</button>
      <button class="btn-action" onclick="window.secretActionCompare()" style="background: #7b1fa2; padding: 4px; font-size: 11px; min-height: 30px;">⚖️ 大小比較</button>
      <button class="btn-action" onclick="window.secretActionSum()" style="background: #e65100; padding: 4px; font-size: 11px; min-height: 30px;">➕ 合計値</button>
      <button class="btn-action" onclick="window.secretActionRange()" style="background: #2e7d32; padding: 4px; font-size: 11px; min-height: 30px;">🎯 範囲</button>
    </div>
  `;
}

window.executeSecretRematch = function() {
  if (secretState.mode === 'multi' && customSendFunc) {
    customSendFunc({ type: 'SECRET_REMATCH' });
  }
  startSecretNumberGame(hostFlag, secretState.mode);
};

window.returnFromSecretGame = function() {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  
  const gameScreen = document.getElementById('secret-game-screen');
  if (gameScreen) {
    gameScreen.style.display = 'none';
  }

  if (secretState.mode === 'multi') {
    const lobby = document.getElementById('lobby-screen');
    if (lobby) lobby.classList.add('active');
  } else {
    const menu = document.getElementById('menu-screen');
    if (menu) menu.classList.add('active');
  }
};

// ==========================================
// 🎨 UI描画・更新処理
// ==========================================
function renderSecretUI() {
  const hintCountEl = document.getElementById('secret-hint-count');
  if (hintCountEl) hintCountEl.innerText = secretState.hintCount;

  const latestHintEl = document.getElementById('secret-latest-hint-text');
  if (latestHintEl) latestHintEl.innerText = secretState.lastPopupMsg || "アクションを選んでヒントを集めよう。";

  const turnIndicator = document.getElementById('secret-turn-indicator');
  if (turnIndicator) {
    if (secretState.players.length > 0) {
      const currentP = secretState.players[secretState.currentTurnIndex];
      const skipStatus = (currentP && currentP.isSkipped) ? ' (1回休み中)' : '';
      turnIndicator.innerHTML = `現在のターン: <b style="color: #0288d1;">${currentP ? currentP.name : 'プレイヤー'}</b> の番です${skipStatus}`;
    } else {
      turnIndicator.innerText = "ヒントを暴いて3桁の数字を当てろ！";
    }
  }

  const playersListEl = document.getElementById('secret-players-list');
  if (playersListEl && secretState.players.length > 0) {
    playersListEl.innerHTML = secretState.players.map((p, idx) => {
      const isCurrent = (idx === secretState.currentTurnIndex);
      const isSkipped = p.isSkipped;
      
      let badgeStyle = "padding: 2px 5px; border-radius: 4px; font-size: 10px; font-weight: bold; border: 1px solid #90caf9; background: #fff;";
      if (isSkipped) {
        badgeStyle += " background: #fff9c4; color: #f57f17; border-color: #fbc02d;";
      } else if (isCurrent) {
        badgeStyle += " background: #bbdefb; color: #0d47a1; border-color: #1976d2; box-shadow: 0 0 4px rgba(25,118,210,0.5);";
      } else {
        badgeStyle += " color: #333;";
      }

      let icon = p.type === 'com' ? '🤖' : '👤';
      const statusText = isSkipped ? ' (1回休み)' : (isCurrent ? ' ◀現在' : '');
      return `<div style="${badgeStyle}">${icon} ${p.name}${statusText}</div>`;
    }).join('');
  }

  // セレクトボックスの選択状態を同期
  for (let i = 0; i < SECRET_CONFIG.CARD_COUNT; i++) {
    const selectEl = document.getElementById(`secret-guess-${i}`);
    if (selectEl) {
      selectEl.value = secretState.guesses[i] || "";
    }
  }

  renderHintsListByCategory();
}

// 📋 カテゴリ別にヒント一覧を描画
function renderHintsListByCategory() {
  const oddevenContainer = document.getElementById('hints-category-oddeven');
  const compareContainer = document.getElementById('hints-category-compare');
  const sumContainer = document.getElementById('hints-category-sum');
  const rangeContainer = document.getElementById('hints-category-range');

  if (!oddevenContainer || !compareContainer || !sumContainer || !rangeContainer) return;

  const cats = secretState.hintsByCategory;
  const guessArray = secretState.guesses.length === SECRET_CONFIG.CARD_COUNT && secretState.guesses.every(g => g !== "") 
    ? secretState.guesses.map(Number) 
    : null;

  const getStyle = (checkFunc) => {
    if (!guessArray) return 'border-left: 3px solid #ccc; background: #fff; color: #333; padding: 3px 6px; border-radius: 3px;';
    const isValid = checkFunc(guessArray);
    return isValid 
      ? 'border-left: 3px solid #4caf50; background: #e8f5e9; color: #1b5e20; padding: 3px 6px; border-radius: 3px;' 
      : 'border-left: 3px solid #d32f2f; background: #ffebee; color: #b71c1c; padding: 3px 6px; border-radius: 3px;';
  };

  oddevenContainer.innerHTML = cats.oddeven.length > 0 
    ? cats.oddeven.map(h => {
        const st = getStyle(g => (g[h.index] % 2 !== 0) === h.value);
        return `<div style="${st}">${h.text}</div>`;
      }).join('')
    : '<div style="color: #888; font-size: 10px; padding: 1px 2px;">なし</div>';

  compareContainer.innerHTML = cats.compare.length > 0 
    ? cats.compare.map(h => {
        const st = getStyle(g => h.comp === '大きい' ? g[h.idx1] > g[h.idx2] : g[h.idx1] < g[h.idx2]);
        return `<div style="${st}">${h.text}</div>`;
      }).join('')
    : '<div style="color: #888; font-size: 10px; padding: 1px 2px;">なし</div>';

  sumContainer.innerHTML = cats.sum.length > 0 
    ? cats.sum.map(h => {
        const st = getStyle(g => (g[h.idx1] + g[h.idx2]) === h.sumVal);
        return `<div style="${st}">${h.text}</div>`;
      }).join('')
    : '<div style="color: #888; font-size: 10px; padding: 1px 2px;">なし</div>';

  rangeContainer.innerHTML = cats.range.length > 0 
    ? cats.range.map(h => {
        const st = getStyle(g => h.isHigher ? g[h.index] >= h.threshold : g[h.index] < h.threshold);
        return `<div style="${st}">${h.text}</div>`;
      }).join('')
    : '<div style="color: #888; font-size: 10px; padding: 1px 2px;">なし</div>';
}

window.secretActionOddEven = () => executeSecretAction('oddeven');
window.secretActionCompare = () => executeSecretAction('compare');
window.secretActionSum = () => executeSecretAction('sum');
window.secretActionRange = () => executeSecretAction('range');