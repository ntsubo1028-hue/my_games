import { sendData } from './connection.js';

export const GAME_CONFIG = {
  reversi:       { minPlayers: 2, maxPlayers: 2, name: '🟢 リバーシ',           allowCom: false },
  dots:          { minPlayers: 2, maxPlayers: 4, name: '🟠 ドット＆ボックス',   allowCom: false },
  concentration: { minPlayers: 2, maxPlayers: 4, name: '🃏 神経衰弱',           allowCom: false },
  minesweeper:   { minPlayers: 2, maxPlayers: 4, name: '💣 マインスイーパー',   allowCom: false },
  airhockey:     { minPlayers: 2, maxPlayers: 2, name: '🏑 エアホッケー',       allowCom: false },
  shogi:         { minPlayers: 2, maxPlayers: 2, name: '☖ 将棋',               allowCom: false },
  mawari:        { minPlayers: 2, maxPlayers: 4, name: '🎲 回り将棋',           allowCom: true }
};

// ホストの端末に保存されている名前を取得（なければ「ホスト」）
let hostName = localStorage.getItem('player_name') || 'ホスト';

// ロビーの現在の状態
export let currentGameState = {
  gameKey: null,
  isHost: false,
  myConnId: 'host',
  slots: [],
  spectators: [], // 互換性のためプロパティは残すが使用しない
  targetSlotCount: 2
};

let guestConnections = {}; 

export function setMyConnId(connId) {
  currentGameState.myConnId = connId;
}

// 自分の名前を変更する関数
export function updateMyName(newName) {
  const trimmed = newName.trim();
  if (!trimmed) return;

  // ローカルストレージに保存
  localStorage.setItem('player_name', trimmed);

  if (currentGameState.isHost) {
    hostName = trimmed;
    rebuildSlotsForGame();
    renderLobbyUI();
    broadcastLobbyState();
  } else {
    // ゲストの場合はホストへ変更リクエストを送信
    sendData({
      type: "CHANGE_NAME",
      payload: { name: trimmed }
    });
  }
}

// ホストがゲストの名前変更を受信して適用する関数
export function updateGuestName(guestId, newName) {
  if (guestConnections[guestId]) {
    guestConnections[guestId].name = newName || '';
    rebuildSlotsForGame();
    renderLobbyUI();
    broadcastLobbyState();
  }
}

/**
 * ロビーを初期化して画面を描画する
 */
export function initLobby(gameKey, isHost) {
  const config = GAME_CONFIG[gameKey];
  currentGameState.gameKey = gameKey;
  currentGameState.isHost = isHost;
  if (isHost) currentGameState.myConnId = 'host';
  
  if (config) {
    const connectedHumans = 1 + Object.keys(guestConnections).length;
    currentGameState.targetSlotCount = Math.max(
      config.minPlayers, 
      Math.min(config.maxPlayers, connectedHumans)
    );
  } else {
    currentGameState.targetSlotCount = 2;
  }
  
  rebuildSlotsForGame();
  renderLobbyUI();
  
  if (isHost) broadcastLobbyState();
}

/**
 * ホストから届いたロビー状態をゲスト側に同期適用する
 */
export function updateLobbyStateFromHost(payload) {
  if (currentGameState.isHost) return;
  
  currentGameState.gameKey = payload.gameKey;
  currentGameState.slots = payload.slots;
  currentGameState.targetSlotCount = payload.targetSlotCount;

  renderLobbyUI();
}

/**
 * ホストが全ゲストへ最新のロビー状態を送信する
 */
export function broadcastLobbyState() {
  if (!currentGameState.isHost) return;

  sendData({
    type: "LOBBY_STATE_SYNC",
    payload: {
      gameKey: currentGameState.gameKey,
      slots: currentGameState.slots,
      spectators: [], // 空のまま送る
      targetSlotCount: currentGameState.targetSlotCount
    }
  });
}

/**
 * ゲーム切り替え・ゲスト増減・枠追加時のスロット再構築
 */
function rebuildSlotsForGame() {
  const config = GAME_CONFIG[currentGameState.gameKey];
  if (!config) return;

  const connectedHumans = [];
  if (currentGameState.isHost) {
    connectedHumans.push({ connId: 'host', name: hostName, isHost: true });
  }

  // ID番号順にソート（guest-1, guest-2...）して参加順を明確にする
  const guestKeys = Object.keys(guestConnections).sort((a, b) => {
    const numA = parseInt(a.replace('guest-', '')) || 0;
    const numB = parseInt(b.replace('guest-', '')) || 0;
    return numA - numB;
  });

  guestKeys.forEach(connId => {
    connectedHumans.push({
      connId: connId,
      name: guestConnections[connId].name || '',
      isHost: false
    });
  });

  // 枠数を超える場合、あぶれた人（IDが一番大きいゲスト＝配列の末尾）を退出させる
  while (connectedHumans.length > currentGameState.targetSlotCount) {
    const kickedHuman = connectedHumans.pop();
    if (!kickedHuman.isHost) {
      sendData({
        type: "KICKED_FROM_LOBBY",
        payload: { targetConnId: kickedHuman.connId }
      });
      delete guestConnections[kickedHuman.connId];
    }
  }

  const existingComs = currentGameState.slots ? currentGameState.slots.filter(s => s.type === 'com') : [];

  const newSlots = [];

  connectedHumans.forEach((human, index) => {
    // 枠番号に応じたデフォルト名（1P＝ホスト、2P＝ゲスト1、3P＝ゲスト2...）
    const defaultName = human.isHost ? 'ホスト' : `ゲスト${index}`;

    // 個別の名前が設定されていない、または「ゲスト」のままの場合はデフォルト名を生成
    const finalName = (human.name && human.name !== 'ゲスト' && human.name.trim() !== '')
      ? human.name
      : defaultName;

    newSlots.push({
      slotId: index,
      type: human.isHost ? 'host' : 'guest',
      connId: human.connId,
      name: finalName
    });
  });

  let comIndex = 0;
  while (newSlots.length < currentGameState.targetSlotCount) {
    const slotId = newSlots.length;
    if (comIndex < existingComs.length && config.allowCom) {
       newSlots.push({
         slotId: slotId,
         type: 'com',
         connId: null,
         name: `COM`
       });
       comIndex++;
    } else {
       newSlots.push({
         slotId: slotId,
         type: 'none',
         connId: null,
         name: `空き枠`
       });
    }
  }

  currentGameState.slots = newSlots;
  currentGameState.spectators = []; // 観戦者は廃止
}

export function toggleComSlot(slotId) {
  if (!currentGameState.isHost) return;

  const slot = currentGameState.slots[slotId];
  if (!slot || slot.type === 'host' || slot.type === 'guest') return; 

  if (slot.type === 'none') {
    slot.type = 'com';
    slot.name = `COM`;
  } else if (slot.type === 'com') {
    slot.type = 'none';
    slot.name = `空き枠`;
  }

  renderLobbyUI();
  broadcastLobbyState();
}

/**
 * ロビー画面のUIを更新する
 */
export function renderLobbyUI() {
  const config = GAME_CONFIG[currentGameState.gameKey];
  document.getElementById('lobby-game-title').innerText = config ? config.name : 'ロビー';

  // 入力欄に自身の最新の名前を表示（フォーカス中でない時のみセット）
  const nameInputEl = document.getElementById('input-player-name');
  if (nameInputEl && document.activeElement !== nameInputEl) {
    const savedName = localStorage.getItem('player_name') || '';
    nameInputEl.value = savedName;
  }

  // 人数と自分のID情報表示エリアの計算と更新
  const connectedHumansCount = currentGameState.slots.filter(s => s.type === 'host' || s.type === 'guest').length;
  
  let myRoleText = "接続中...";
  let mySlotInfo = currentGameState.slots.find(s => s.connId === currentGameState.myConnId);
  
  if (mySlotInfo) {
    myRoleText = `${mySlotInfo.slotId + 1}P`;
  } else if (currentGameState.isHost) {
    myRoleText = "1P (ホスト)";
  }

  const countEl = document.getElementById('lobby-player-count-display');
  if (countEl) {
    countEl.innerText = `現在の参加人数: ${connectedHumansCount}人`;
  }

  const myIdEl = document.getElementById('lobby-my-id-display');
  if (myIdEl) {
    myIdEl.innerText = `あなたの順番: ${myRoleText}`;
  }

  // スロットの更新
  const slotsContainer = document.getElementById('lobby-slots-container');
  slotsContainer.innerHTML = ''; 

  currentGameState.slots.forEach(slot => {
    const slotEl = document.createElement('div');
    slotEl.className = 'lobby-slot';
    slotEl.style = 'padding: 10px; margin-bottom: 4px; border-radius: 6px; background: #fff; border: 2px solid #ccc; display: flex; justify-content: space-between; align-items: center;';
    
    let icon = '🪑';
    let color = '#757575'; 
    if (slot.type === 'host') { icon = '👑'; color = '#d32f2f'; }
    else if (slot.type === 'guest') { icon = '👤'; color = '#1976d2'; }
    else if (slot.type === 'com') { icon = '🤖'; color = '#388e3c'; }

    slotEl.style.borderColor = color;

    // 自分がどの席にいるか分かりやすくマーク(あなた)を表示
    const isMe = (slot.connId === currentGameState.myConnId);
    const meMark = isMe ? ' <span style="background:#4caf50; color:#fff; border-radius:4px; padding:2px 6px; font-size:10px;">あなた</span>' : '';

    const nameSpan = document.createElement('span');
    nameSpan.innerHTML = `<span style="font-size:12px; color:#999; margin-right:5px;">${slot.slotId + 1}P</span><b>${icon} ${slot.name}</b>${meMark}`;
    nameSpan.style.color = color;
    slotEl.appendChild(nameSpan);

    if (currentGameState.isHost && (slot.type === 'none' || slot.type === 'com')) {
      if (config.allowCom) {
        const btn = document.createElement('button');
        btn.className = 'btn-action';
        btn.style = 'padding: 4px 8px; font-size: 12px; margin: 0; width: auto; background-color: #607d8b;';
        btn.innerText = slot.type === 'none' ? '🤖 COMを追加' : '✖ 外す';
        btn.onclick = () => toggleComSlot(slot.slotId);
        slotEl.appendChild(btn);
      } else {
        const label = document.createElement('span');
        label.style = 'font-size: 12px; color: #888; font-weight: bold;';
        label.innerText = 'ゲスト待機中...';
        slotEl.appendChild(label);
      }
    }

    slotsContainer.appendChild(slotEl);
  });

  // 多人数ゲーム用の枠増減コントロール（ホスト専用）
  if (currentGameState.isHost) {
    const btnGroup = document.createElement('div');
    btnGroup.style = 'display: flex; gap: 10px; margin-top: 10px;';
    
    if (currentGameState.targetSlotCount < config.maxPlayers) {
      const addBtn = document.createElement('button');
      addBtn.className = 'btn-action';
      addBtn.style = 'background-color: #ff9800; padding: 6px; font-size: 14px; flex: 1;';
      addBtn.innerHTML = '➕ 参加枠を追加';
      addBtn.onclick = () => {
        currentGameState.targetSlotCount++;
        rebuildSlotsForGame();
        renderLobbyUI();
        broadcastLobbyState();
      };
      btnGroup.appendChild(addBtn);
    }

    if (currentGameState.targetSlotCount > config.minPlayers) {
      const removeBtn = document.createElement('button');
      removeBtn.className = 'btn-action';
      removeBtn.style = 'background-color: #9e9e9e; padding: 6px; font-size: 14px; flex: 1;';
      removeBtn.innerHTML = '➖ 枠を減らす';
      removeBtn.onclick = () => {
        currentGameState.targetSlotCount--;
        rebuildSlotsForGame();
        renderLobbyUI();
        broadcastLobbyState();
      };
      btnGroup.appendChild(removeBtn);
    }
    
    if (btnGroup.children.length > 0) {
      slotsContainer.appendChild(btnGroup);
    }
  }

  // 観戦者の描画を強制的に非表示
  const spectatorContainer = document.getElementById('lobby-spectators-container');
  if (spectatorContainer) {
    spectatorContainer.style.display = 'none';
  }

  // ホストにのみ「ゲームスタート」と「ゲスト呼び出し」ボタンを表示
  const btnAddGuest = document.getElementById('btn-lobby-add-guest');
  if (currentGameState.isHost) {
    btnAddGuest.style.display = 'inline-block';
    
    if (connectedHumansCount >= currentGameState.targetSlotCount) {
      btnAddGuest.disabled = true;
      btnAddGuest.style.opacity = '0.5';
      btnAddGuest.style.cursor = 'not-allowed';
      btnAddGuest.innerText = '📡 参加枠が満員です';
    } else {
      btnAddGuest.disabled = false;
      btnAddGuest.style.opacity = '1';
      btnAddGuest.style.cursor = 'pointer';
      btnAddGuest.innerText = '📡 通信してゲストを呼ぶ';
    }
  } else {
    btnAddGuest.style.display = 'none';
  }

  // ホストのみゲームスタートを表示
  const btnStart = document.getElementById('btn-lobby-start');
  if (currentGameState.isHost) {
    btnStart.style.display = 'inline-block';
    
    const hasOpponent = currentGameState.slots.some(slot => slot.type === 'guest' || slot.type === 'com');
    
    if (hasOpponent) {
      btnStart.disabled = false;
      btnStart.style.opacity = '1';
      btnStart.style.cursor = 'pointer';
      btnStart.innerText = '🎮 ゲームスタート';
    } else {
      btnStart.disabled = true;
      btnStart.style.opacity = '0.5';
      btnStart.style.cursor = 'not-allowed';
      btnStart.innerText = '🎮 メンバー参加待ち...';
    }
  } else {
    btnStart.style.display = 'none';
  }

  // 退出ボタンの表示をホストとゲストで切り替え
  const btnQuit = document.getElementById('btn-quit-lobby');
  if (btnQuit) {
    btnQuit.innerText = currentGameState.isHost ? "解散してメニューに戻る" : "ロビーから退出する";
  }

  // ゲーム変更ボタンの表示制御（ホストのみ表示）
  const btnChangeGame = document.getElementById('btn-lobby-change-game');
  if (btnChangeGame) {
    btnChangeGame.style.display = currentGameState.isHost ? 'inline-block' : 'none';
  }
}

export function addGuestConnection(guestId, guestName = '') {
  guestConnections[guestId] = { name: guestName };
  rebuildSlotsForGame();
  renderLobbyUI();
  broadcastLobbyState();
}

export function removeGuestConnection(guestId) {
  if (guestConnections[guestId]) {
    delete guestConnections[guestId];
    rebuildSlotsForGame();
    renderLobbyUI();
    broadcastLobbyState();
  }
}

// ロビーの状態を初期化する関数
export function resetLobby() {
  currentGameState.gameKey = null;
  currentGameState.isHost = false;
  currentGameState.myConnId = 'host';
  currentGameState.slots = [];
  currentGameState.targetSlotCount = 2;
  
  for (let key in guestConnections) {
    delete guestConnections[key];
  }
}