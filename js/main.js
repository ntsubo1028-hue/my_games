// ==========================================
// 1. インポート部
// ==========================================
import { 
  setupHostConnection, 
  setupGuestConnection, 
  handleGuestAnswer, 
  generateMultiPartQR, 
  startMultiPartScan, 
  cancelScan, 
  initConnection, 
  setOnMessage,
  sendData,
  removeConnection
} from './connection.js';

import { initGame, processAction, updateGameState, syncStateToGuest, requestRematch } from './reversi.js';
import { initDotsGame, processDotsAction, updateDotsGameState, syncDotsStateToGuest, requestRematchDots } from './dots_and_boxes.js';
import { initBlock_drop, stopBlock_drop } from './block_drop.js';
import { initGame as initConcentrationGame, processAction as processConcentrationAction, updateGameState as updateConcentrationGameState, syncStateToGuest as syncConcentrationStateToGuest, requestRematch as requestConcentrationRematch, handleScreenTap as handleConcentrationScreenTap } from './concentration.js';
import { initSoloGame, initPvPGame, toggleInputMode, endTurn, processAction as processMineAction, updateGameState as updateMineGameState, syncStateToGuest as syncMineStateToGuest, requestRematch as requestMineRematch } from './minesweeper.js';
import { initAirHockeySystem, startAirHockey, processAirHockeyData, stopAirHockey, resumeAirHockey } from './airhockey.js';
import { initGame as initShogiGame, processAction as processShogiAction, updateGameState as updateShogiGameState, syncStateToGuest as syncShogiStateToGuest, requestRematch as requestShogiRematch } from './shogi.js';
import { initMawariShogi, stopMawariShogi, rollMawariDice, processMawariAction, updateMawariGameState } from './mawari_shogi.js';
import { initLobby, addGuestConnection, removeGuestConnection, updateLobbyStateFromHost, setMyConnId, broadcastLobbyState, currentGameState, resetLobby, renderLobbyUI, updateMyName, updateGuestName} from './lobby.js';
import { createOrUpdateDynamicGasRoom, joinDynamicGasRoom } from './gas_connection.js';

// ==========================================
// 2. 変数・定数定義部
// ==========================================
let isHost = false;
let selectedGame = 'reversi'; 
let localConnectionDataStr = ""; 
let isConnected = false; 

let currentGuestCount = 0;
let pendingGuestId = null;

// 現在の4桁の接続コードを保持する変数
let currentConnectionCode = null;

const STAMPS = {
  greeting: { icon: '🤝', text: 'よろしく！' },
  thanks: { icon: '☕', text: 'お疲れ様！' },
  nice: { icon: '👍', text: 'ナイス！' },
  brilliant: { icon: '✨', text: 'お見事！' },
  danger: { icon: '💦', text: 'あぶない！' },
  omg: { icon: '😲', text: 'まじか…' },
  thinking: { icon: '⏳', text: '熟考中…' },
  surrender: { icon: '🏳️', text: '参りました' }
};

let selectedStampId = null;


// ==========================================
// 3. 関数定義部
// ==========================================

// --- ヘルパー関数 ---
function setClick(id, handler) {
  const el = document.getElementById(id);
  if (el) el.onclick = handler;
}

function encodeSdp(obj) {
  return LZString.compressToBase64(JSON.stringify(obj));
}

function decodeSdp(str) {
  if (!str) return {};
  try {
    const decompressed = LZString.decompressFromBase64(str);
    if (decompressed) {
      return JSON.parse(decompressed);
    }
  } catch (e) {}
  
  try {
    return JSON.parse(str);
  } catch (e) {}

  return { sdp: str, type: 'answer' };
}

function getMyName() {
  if (typeof currentGameState !== 'undefined' && currentGameState && currentGameState.slots) {
    const mySlot = currentGameState.slots.find(s => s.connId === currentGameState.myConnId);
    if (mySlot && mySlot.name) return mySlot.name;
  }
  return isHost ? 'ホスト' : 'ゲスト';
}

function setElementDisplay(id, display) {
  const el = document.getElementById(id);
  if (el) el.style.display = display;
}

function resetConnectionUI() {
  setElementDisplay('qr-container', 'none');
  setElementDisplay('text-copy-container', 'none');
  setElementDisplay('step-guest-choose-input', 'none');
  setElementDisplay('step-host-choose-output', 'none');
  setElementDisplay('step-host-done-container', 'none');
  setElementDisplay('step-host-choose-input', 'none');
  setElementDisplay('step-guest-choose-output', 'none');
  setElementDisplay('step-text-input-area', 'none');
  setElementDisplay('step-gas-room-input-area', 'none');
}

function setStatusText(text) {
  const el = document.getElementById('conn-status');
  if (el) el.innerText = text;
}

// --- スタンプ・画面表示関連 ---
function initStampSystem() {
  const modalHTML = `
    <div id="stamp-modal" class="stamp-modal" style="display: none;">
      <div class="stamp-modal-content">
        <h3 style="margin-top: 0; margin-bottom: 15px;">スタンプを送る</h3>
        <div class="stamp-grid">
          ${Object.keys(STAMPS).map(key => `
            <div class="stamp-option" data-stamp-id="${key}">
              <div class="stamp-icon">${STAMPS[key].icon}</div>
              <div class="stamp-text">${STAMPS[key].text}</div>
            </div>
          `).join('')}
        </div>
        <div class="stamp-modal-actions">
          <button id="btn-send-stamp" class="btn-action" style="background-color: #00bcd4;" disabled>送信する</button>
          <button id="btn-close-stamp" class="btn-action secondary-btn">キャンセル</button>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', modalHTML);

  const modal = document.getElementById('stamp-modal');
  const btnSend = document.getElementById('btn-send-stamp');
  const options = document.querySelectorAll('.stamp-option');

  options.forEach(opt => {
    opt.addEventListener('click', () => {
      options.forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      selectedStampId = opt.getAttribute('data-stamp-id');
      if (btnSend) btnSend.disabled = false;
    });
  });

  setClick('btn-close-stamp', () => { 
    if (modal) modal.style.display = 'none'; 
  });

  if (btnSend) {
    btnSend.onclick = () => {
      if (selectedStampId && isConnected) {
        const senderName = getMyName();
        try {
          sendData({ type: "STAMP", payload: { stampId: selectedStampId, senderName: senderName } });
          showStampPopup(true, selectedStampId, senderName);
        } catch (err) {
          console.error("スタンプの送信に失敗しました:", err);
        }
        
        if (modal) modal.style.display = 'none';
        btnSend.disabled = true;
        options.forEach(o => o.classList.remove('selected'));
        selectedStampId = null;
      }
    };
  }

  document.querySelectorAll('.btn-open-stamp').forEach(btn => {
    btn.onclick = () => {
      selectedStampId = null;
      options.forEach(o => o.classList.remove('selected'));
      if (btnSend) btnSend.disabled = true;
      if (modal) modal.style.display = 'flex';
    };
  });
}

function showStampPopup(isMe, stampId, senderName) {
  const stamp = STAMPS[stampId];
  if (!stamp) return;

  const displayName = senderName || (isMe ? getMyName() : '対戦相手');

  const popup = document.createElement('div');
  popup.className = `stamp-popup ${isMe ? 'stamp-popup-me' : 'stamp-popup-opponent'}`;
  popup.innerHTML = `
    <div class="stamp-popup-sender">${displayName}</div>
    <div class="stamp-popup-body">
      <div class="stamp-popup-icon">${stamp.icon}</div>
      <div class="stamp-popup-text">${stamp.text}</div>
    </div>
  `;
  document.body.appendChild(popup);

  setTimeout(() => { if (popup.parentNode) popup.remove(); }, 2500);
}

function setStampButtonVisible(visible) {
  document.querySelectorAll('.btn-open-stamp').forEach(btn => {
    btn.style.display = visible ? 'block' : 'none';
  });
}

function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
  const target = document.getElementById(screenId);
  if (target) target.classList.add('active');
}

function selectGameFlow(game) {
  selectedGame = game;
  isHost = true;
  showScreen('lobby-screen');
  initLobby(game, true); 
}

function showGameScreenForHost(game) {
  setStampButtonVisible(true);

  if (game === 'reversi') { showScreen('game-screen'); initGame(true); syncStateToGuest(); }
  else if (game === 'dots') { showScreen('dots-game-screen'); initDotsGame(true); syncDotsStateToGuest(); }
  else if (game === 'concentration') { showScreen('concentration-game-screen'); initConcentrationGame(true); syncConcentrationStateToGuest(); }
  else if (game === 'minesweeper') { showScreen('minesweeper-game-screen'); initPvPGame(true); syncMineStateToGuest(); }
  else if (game === 'airhockey') { showScreen('airhockey-game-screen'); initAirHockeySystem(true, sendData); startAirHockey(); }
  else if (game === 'shogi') { showScreen('shogi-game-screen'); initShogiGame(true); syncShogiStateToGuest(); }
  else if (game === 'mawari') { showScreen('mawari-game-screen'); initMawariShogi(true); }
}

function startGuestScanFlow() {
  isHost = false; // ★ ゲストとして確実にフラグを折る
  showScreen('connection-screen');
  const connTitle = document.getElementById('conn-title');
  if (connTitle) connTitle.innerText = "ゲスト参加の準備";
  setStatusText("ホストの情報をどうやって入力するか選んでください");
  resetConnectionUI();

  setElementDisplay('btn-back-select', 'inline-block');
  setElementDisplay('btn-disconnect-guest', 'none');
  setElementDisplay('step-guest-choose-input', 'block');

  const processHostOffer = async (scanResult) => {
    try {
      isHost = false; // ★ ここでも確実にゲストに設定
      const offerObj = { type: scanResult.type || scanResult.t, sdp: scanResult.sdp || scanResult.s };
      selectedGame = scanResult.gameType || scanResult.g;
      const targetGuestId = scanResult.targetId || scanResult.id || 'guest-1';
      
      setMyConnId(targetGuestId);

      setStatusText("ホストへの返信を生成中...");

      const localDesc = await setupGuestConnection(offerObj, () => {
        isHost = false; // ★ 接続確立時も確実にゲストに設定
        isConnected = true;
        setStampButtonVisible(true);
        initLobby(selectedGame, false);
        showScreen('lobby-screen');
        const savedName = localStorage.getItem('player_name') || 'ゲスト';
        sendData({ type: "CHANGE_NAME", payload: { name: savedName } });
      });

      localConnectionDataStr = encodeSdp({ type: localDesc.type, sdp: localDesc.sdp, gameType: selectedGame });
      if (connTitle) connTitle.innerText = "ホストに情報を返す";
      setStatusText("返信の準備ができました。");

      setElementDisplay('step-guest-choose-output', 'block');

      setClick('btn-guest-output-qr', () => {
        setElementDisplay('step-guest-choose-output', 'none');
        setElementDisplay('qr-container', 'flex');
        generateMultiPartQR('conn-status', localDesc, selectedGame);
      });

      setClick('btn-guest-output-text', () => {
        setElementDisplay('step-guest-choose-output', 'none');
        setElementDisplay('text-copy-container', 'block');
        setStatusText("接続情報をコピーして相手に送ってください");
      });

      setClick('btn-copy-sdp', () => {
        navigator.clipboard.writeText(localConnectionDataStr).then(() => {
          alert("返信情報をコピーしました！");
        });
      });

    } catch (e) {
      alert("処理に失敗しました。");
      setElementDisplay('step-guest-choose-input', 'block');
      setStatusText("ホストの情報をどうやって入力するか選んでください");
    }
  };

  setClick('btn-guest-input-qr', () => {
    isHost = false;
    setElementDisplay('step-guest-choose-input', 'none');
    startMultiPartScan(
      async (scanResult) => { await processHostOffer(scanResult); },
      () => showScreen('camera-screen'),
      () => showScreen('connection-screen')
    );
  });

  setClick('btn-guest-input-text', () => {
    isHost = false;
    setElementDisplay('step-guest-choose-input', 'none');
    setElementDisplay('step-text-input-area', 'block');
  });

  const textInput = document.getElementById('text-sdp-input');
  if (textInput) textInput.value = '';
  
  setClick('btn-submit-sdp', () => {
    isHost = false;
    if (!textInput) return;
    const pasted = textInput.value.trim();
    if (!pasted) return;

    setElementDisplay('step-text-input-area', 'none');
    setStatusText("接続を確立しています...");

    setTimeout(async () => {
      try {
        const scanResult = decodeSdp(pasted);
        await processHostOffer(scanResult);
      } catch (e) {
        console.error("ゲスト側テキスト接続エラー:", e);
        alert("エラーが発生しました！\n詳細: " + e.message);
        setElementDisplay('step-text-input-area', 'block');
        setStatusText("ホストの情報をどうやって入力するか選んでください");
      }
    }, 2000);
  });

  // ゲストが「接続コードを入力して参加する」を選んだとき
  setClick('btn-guest-input-gas', () => {
    isHost = false;
    setElementDisplay('step-guest-choose-input', 'none');
    setElementDisplay('step-gas-room-input-area', 'block');
    setStatusText("4桁の接続コードの入力");
  });

  setClick('btn-cancel-gas-input', () => {
    isHost = false;
    setElementDisplay('step-gas-room-input-area', 'none');
    setElementDisplay('step-guest-choose-input', 'block');
    setStatusText("ホストの情報をどうやって入力するか選んでください");
  });

  // 「この番号で部屋に入る」ボタンが押されたとき
  setClick('btn-submit-gas-room', async () => {
    isHost = false; // ★ 確実にゲストに設定
    const inputEl = document.getElementById('input-gas-room-number');
    const roomCode = inputEl ? inputEl.value.trim() : '';
    if (!roomCode || roomCode.length !== 4) {
      alert("4桁の接続コードを入力してください。");
      return;
    }

    setElementDisplay('step-gas-room-input-area', 'none');
    setStatusText("接続コードを確認しています...");

    try {
      const gameType = await joinDynamicGasRoom(
        roomCode,
        (connectedId) => {
          isHost = false; // ★ 参加成功時も確実にゲストに設定
          isConnected = true;
          setStampButtonVisible(true);
          initLobby(selectedGame, false);
          showScreen('lobby-screen');
          const savedName = localStorage.getItem('player_name') || 'ゲスト';
          sendData({ type: "CHANGE_NAME", payload: { name: savedName } });
        },
        (statusMsg) => {
          setStatusText(statusMsg);
        }
      );
      selectedGame = gameType;
    } catch (e) {
      console.error(e);
      setElementDisplay('step-gas-room-input-area', 'block');
      setStatusText("接続に失敗しました: " + e.message);
    }
  });
}

function cancelOutputSelection() {
  setElementDisplay('qr-container', 'none');
  setElementDisplay('text-copy-container', 'none');
  if (isHost) {
    setElementDisplay('step-host-done-container', 'none');
    setElementDisplay('step-host-choose-output', 'block');
    setStatusText("接続方法を選んでください");
  } else {
    setElementDisplay('step-guest-choose-output', 'block');
    setStatusText("返信の準備ができました。");
  }
}

function disconnectConnection() {
  if (isConnected) sendData({ type: "DISCONNECT" });
  isConnected = false;
  setStampButtonVisible(false);
  setTimeout(() => {
    initConnection();
    showScreen('menu-screen');
  }, 100);
}

const handleDisconnectClick = () => {
  if (confirm("通信を切断してメインメニューに戻りますか？")) disconnectConnection();
};

const handleQuitGame = () => {
  if (!confirm("ゲームを終了してロビーに戻りますか？")) return;
  setStampButtonVisible(false);

  if (isConnected) {
    sendData({ type: "QUIT_TO_LOBBY" });
  }

  showScreen('lobby-screen');
  
  if (isHost) {
    renderLobbyUI();
    broadcastLobbyState();
  }
};


// ==========================================
// 4. 実行時初期化・イベント登録部
// ==========================================
function initApp() {
  // --- 名前変更フォームのイベント設定 ---
  const btnChangeName = document.getElementById('btn-change-name');
  const inputPlayerName = document.getElementById('input-player-name');

  if (btnChangeName && inputPlayerName) {
    btnChangeName.onclick = () => {
      updateMyName(inputPlayerName.value);
    };

    inputPlayerName.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        updateMyName(inputPlayerName.value);
        inputPlayerName.blur();
      }
    });

    inputPlayerName.addEventListener('change', (e) => {
      updateMyName(e.target.value);
    });
  }

  // --- スタンプシステムの初期化呼び出し ---
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initStampSystem);
  } else {
    initStampSystem();
  }

  // --- メニュー・ロビー・各種ボタンのイベント登録 ---
  setClick('btn-lobby-add-guest', () => {
    // 1. 次の空き枠の guestId を決定
    const targetSlots = [];
    let nextGuestId = 'guest-1';
    if (currentGameState && currentGameState.slots) {
      for (let i = 1; i < currentGameState.slots.length; i++) {
        const slot = currentGameState.slots[i];
        if (slot && (slot.type === 'none' || slot.type === 'com')) {
          targetSlots.push(`guest-${slot.slotId}`);
        }
      }
      const firstEmpty = currentGameState.slots.find(s => s.type === 'none');
      if (firstEmpty) {
        nextGuestId = `guest-${firstEmpty.slotId}`;
      }
    }

    if (targetSlots.length === 0) {
      alert("追加できる空き枠・COM枠がありません。");
      return;
    }
    
    pendingGuestId = nextGuestId;

    // 2. 接続画面へ遷移し、接続方法の選択肢を表示する
    showScreen('connection-screen');
    const connTitle = document.getElementById('conn-title');
    if (connTitle) connTitle.innerText = "ゲスト接続の準備";
    setStatusText("接続方法を選んでください");
    resetConnectionUI();

    setElementDisplay('btn-back-select', 'inline-block');
    setElementDisplay('btn-disconnect-host', 'none');
    setElementDisplay('step-host-choose-output', 'block'); // ホスト側の3択選択画面を表示
  });

  // --- ① ホスト側：4桁の接続コードで自動接続（GAS） ---
  setClick('btn-host-output-gas', async () => {
    isHost = true; // ★ ホストとして確実に設定
    const targetSlots = [];
    if (currentGameState && currentGameState.slots) {
      for (let i = 1; i < currentGameState.slots.length; i++) {
        const slot = currentGameState.slots[i];
        if (slot && (slot.type === 'none' || slot.type === 'com')) {
          targetSlots.push(`guest-${slot.slotId}`);
        }
      }
    }

    if (targetSlots.length === 0) {
      alert("追加できる空き枠・COM枠がありません。");
      return;
    }

    setElementDisplay('step-host-choose-output', 'none');
    setStatusText("接続情報を生成中...");
    try {
      currentConnectionCode = await createOrUpdateDynamicGasRoom(
        currentConnectionCode,
        selectedGame,
        targetSlots,
        (connectedId) => {
          isHost = true; // ★ 接続成功時もホスト
          isConnected = true;
          alert(`${connectedId} と接続しました！`);
          showScreen('lobby-screen');
          addGuestConnection(connectedId, `ゲスト`);
        },
        (statusMsg) => {
          setStatusText(statusMsg);
        }
      );
      setStatusText(`接続コード: 【 ${currentConnectionCode} 】\nこの4桁をゲストに伝えてください。\nゲストの参加を待っています...`);
    } catch (e) {
      console.error(e);
      setStatusText("エラー: " + e.message);
      setElementDisplay('step-host-choose-output', 'block');
    }
  });

  // --- ② ホスト側：従来のQRコードを表示する（P2P手動） ---
  setClick('btn-host-output-qr', async () => {
    isHost = true;
    setElementDisplay('step-host-choose-output', 'none');
    setStatusText("QRコードを準備しています...");
    try {
      const localDesc = await setupHostConnection(pendingGuestId, (connectedId) => {
        isHost = true;
        isConnected = true; 
        alert(`ゲストと接続しました！`);
        showScreen('lobby-screen');
        addGuestConnection(connectedId, `ゲスト`);
      });
      
      localConnectionDataStr = encodeSdp({ type: localDesc.type, sdp: localDesc.sdp, gameType: selectedGame, targetId: pendingGuestId });
      
      setElementDisplay('qr-container', 'flex');
      generateMultiPartQR('conn-status', localDesc, selectedGame, pendingGuestId);
      setElementDisplay('step-host-done-container', 'block');
    } catch (e) {
      setStatusText("エラー:\n" + e.message);
      setElementDisplay('step-host-choose-output', 'block');
    }
  });

  // --- ③ ホスト側：従来のテキストをコピーする（P2P手動） ---
  setClick('btn-host-output-text', async () => {
    isHost = true;
    setElementDisplay('step-host-choose-output', 'none');
    setStatusText("接続情報を準備しています...");
    try {
      const localDesc = await setupHostConnection(pendingGuestId, (connectedId) => {
        isHost = true;
        isConnected = true; 
        alert(`ゲストと接続しました！`);
        showScreen('lobby-screen');
        addGuestConnection(connectedId, `ゲスト`);
      });
      
      localConnectionDataStr = encodeSdp({ type: localDesc.type, sdp: localDesc.sdp, gameType: selectedGame, targetId: pendingGuestId });
      
      setElementDisplay('text-copy-container', 'block');
      setStatusText("接続情報をコピーして相手に送ってください");
      setElementDisplay('step-host-done-container', 'block');
    } catch (e) {
      setStatusText("エラー:\n" + e.message);
      setElementDisplay('step-host-choose-output', 'block');
    }
  });

  // --- 手動接続用：「接続情報を相手に伝えた」ボタン ---
  setClick('btn-host-done-output', () => {
    setElementDisplay('qr-container', 'none');
    setElementDisplay('text-copy-container', 'none');
    setElementDisplay('step-host-done-container', 'none');

    setStatusText("相手からの返信情報を入力してください");
    setElementDisplay('step-host-choose-input', 'block');
  });

  // ホスト側：相手からの返信をQRで読み取る
  setClick('btn-host-input-qr', () => {
    isHost = true;
    setElementDisplay('step-host-choose-input', 'none');
    startMultiPartScan(
      async (answerObj) => { 
        await handleGuestAnswer(pendingGuestId, answerObj); 
        setStatusText("接続完了！ロビーに戻ります...");
      },
      () => showScreen('camera-screen'),
      () => showScreen('connection-screen')
    );
  });

  // ホスト側：相手からの返信をテキストでペーストする
  setClick('btn-host-input-text', () => {
    isHost = true;
    setElementDisplay('step-host-choose-input', 'none');
    setElementDisplay('step-text-input-area', 'block');
  });

  // テキスト送信ボタンの処理
  const textInput = document.getElementById('text-sdp-input');
  setClick('btn-submit-sdp', () => {
    isHost = true;
    if (!textInput) return;
    const pasted = textInput.value.trim();
    if (!pasted) return;

    setElementDisplay('step-text-input-area', 'none');
    setStatusText("接続を確立しています...");

    setTimeout(async () => {
      try {
        const answerObj = decodeSdp(pasted);
        await handleGuestAnswer(pendingGuestId, answerObj);
        setStatusText("接続完了！ロビーに戻ります...");
      } catch (e) {
        console.error("ホスト側テキスト接続エラー:", e);
        alert("エラーが発生しました！\n詳細: " + e.message);
        setElementDisplay('step-text-input-area', 'block');
        setStatusText("相手からの返信情報を入力してください");
      }
    }, 2000);
  });

  // --- コピーボタンのイベント登録 ---
  setClick('btn-copy-sdp', () => {
    if (!localConnectionDataStr) {
      alert("コピーする情報がまだありません。");
      return;
    }
    navigator.clipboard.writeText(localConnectionDataStr).then(() => {
      alert("接続情報をコピーしました！\nLINE等で相手に送ってください。");
    });
  });

  setClick('btn-quit-lobby', () => {
    const msg = isHost ? "ロビーを解散して通信を切断し、メニューに戻りますか？" : "ロビーから退出してメニューに戻りますか？";
    if (confirm(msg)) {
      resetLobby();
      currentGuestCount = 0;
      currentConnectionCode = null;
      
      if (isConnected) {
        disconnectConnection();
      } else {
        showScreen('menu-screen');
      }
    }
  });

  setClick('btn-lobby-change-game', () => {
    showScreen('host-game-select-screen');
  });

  setClick('btn-lobby-start', () => {
    const hasOpponent = currentGameState?.slots?.some(slot => slot.type === 'guest' || slot.type === 'com');
    
    if (!hasOpponent) {
      console.log("対戦相手がいないためスタートできません");
      return;
    }

    if (isConnected) {
      sendData({ type: "LOBBY_GAME_START", payload: { game: selectedGame } });
    }
    showGameScreenForHost(selectedGame);
  });

  setClick('btn-goto-host-select', () => { 
    isHost = true;
    showScreen('host-game-select-screen'); 
    const btnBack = document.getElementById('btn-back-main');
    const btnDisc = document.getElementById('btn-disconnect-host');
    if (btnBack) btnBack.style.display = 'inline-block';
    if (btnDisc) btnDisc.style.display = 'none';
  });

  setClick('btn-back-main', () => { showScreen('menu-screen'); });
  setClick('btn-guest', () => { startGuestScanFlow(); });
  setClick('btn-play-solo-mine', () => { 
    setStampButtonVisible(false); 
    showScreen('minesweeper-game-screen'); 
    initSoloGame(); 
  });

  setClick('btn-select-reversi', () => { selectGameFlow('reversi'); });
  setClick('btn-select-dots', () => { selectGameFlow('dots'); });
  setClick('btn-select-concentration', () => { selectGameFlow('concentration'); });
  setClick('btn-select-minesweeper', () => { selectGameFlow('minesweeper'); });
  setClick('btn-select-airhockey', () => { selectGameFlow('airhockey'); });
  setClick('btn-select-shogi', () => { selectGameFlow('shogi'); });
  setClick('btn-select-mawari', () => { selectGameFlow('mawari'); });

  setClick('btn-cancel-scan', () => {
    cancelScan(() => {
      showScreen('connection-screen');
      if (isHost) {
        setElementDisplay('step-host-choose-input', 'block');
        setStatusText("相手からの返信情報を入力してください");
      } else {
        setElementDisplay('step-guest-choose-input', 'block');
        setStatusText("ホストの情報をどうやって入力するか選んでください");
      }
    });
  });

  setClick('btn-cancel-text-input', () => {
    setElementDisplay('step-text-input-area', 'none');
    if (isHost) {
      setElementDisplay('step-host-choose-input', 'block');
      setStatusText("相手からの返信情報を入力してください");
    } else {
      setElementDisplay('step-guest-choose-input', 'block');
      setStatusText("ホストの情報をどうやって入力するか選んでください");
    }
  });

  setClick('btn-cancel-output-qr', cancelOutputSelection);
  setClick('btn-cancel-output-text', cancelOutputSelection);

  setClick('btn-back-select', () => {
    if (isHost) {
      if (pendingGuestId) removeConnection(pendingGuestId);
      showScreen('lobby-screen');
    } else {
      initConnection();
      showScreen('menu-screen');
    }
  });

  setClick('btn-disconnect-host', handleDisconnectClick);
  setClick('btn-disconnect-guest', handleDisconnectClick);

  setClick('btn-quit-game', handleQuitGame);
  setClick('btn-quit-dots', handleQuitGame);
  setClick('btn-quit-concentration', handleQuitGame);
  setClick('btn-quit-shogi', handleQuitGame);

  setClick('btn-quit-airhockey', () => { 
    stopAirHockey();
    setTimeout(() => {
      if (confirm("ゲームを終了してロビーに戻りますか？")) {
        setStampButtonVisible(false);
        if (isConnected) {
          sendData({ type: "QUIT_TO_LOBBY" });
        }
        showScreen('lobby-screen');
        if (isHost) {
          renderLobbyUI();
          broadcastLobbyState();
        }
      } else {
        resumeAirHockey();
      }
    }, 50);
  });

  setClick('btn-rematch-reversi', () => requestRematch());
  setClick('btn-rematch-dots', () => requestRematchDots());
  setClick('btn-rematch-concentration', () => requestConcentrationRematch());
  setClick('btn-rematch-airhockey', () => { sendData({ type: 'start_airhockey' }); startAirHockey(); });
  setClick('btn-rematch-shogi', () => requestShogiRematch());
  setClick('btn-rematch-mawari', () => initMawariShogi());

  setClick('btn-play-block_drop', () => { 
    setStampButtonVisible(false);
    showScreen('block_drop-game-screen'); 
    initBlock_drop(); 
  });

  setClick('btn-quit-block_drop', () => { 
    if (confirm("ゲームを終了してメニューに戻りますか？")) {
      stopBlock_drop(); 
      showScreen('menu-screen'); 
    }
  });

  setClick('btn-rematch-block_drop', () => initBlock_drop());

  setClick('concentration-game-screen', () => { 
    if (selectedGame === 'concentration') handleConcentrationScreenTap(); 
  });

  setClick('btn-mine-mode', () => toggleInputMode());
  setClick('btn-mine-end-turn', () => endTurn());

  setClick('btn-quit-mine', () => {
    if (isConnected) {
      handleQuitGame(); 
    } else {
      if (confirm("ゲームを終了してメニューに戻りますか？")) showScreen('menu-screen');
    }
  });

  setClick('btn-rematch-mine', () => requestMineRematch());

  setClick('btn-quit-mawari', () => {
    if (confirm("ゲームを終了してロビーに戻りますか？")) {
      stopMawariShogi();
      setStampButtonVisible(false);
      
      if (isConnected) {
        sendData({ type: "QUIT_TO_LOBBY" });
      }
      
      showScreen('lobby-screen');
      
      if (isHost) {
        broadcastLobbyState();
      }
    }
  });

  setClick('btn-mawari-dice', () => {
    rollMawariDice();
  });

  // --- メッセージ受信ハンドラ設定 ---
  setOnMessage((data, sourceId) => {
    if (data.type === "LOBBY_STATE_SYNC") {
      updateLobbyStateFromHost(data.payload);
      return;
    }

    if (data.type === "CHANGE_NAME") {
      if (isHost && sourceId) {
        updateGuestName(sourceId, data.payload.name);
      }
      return;
    }

    if (data.type === "DISCONNECT") {
      if (!isHost) {
        alert("ホストによってロビーが解散されました。");
        resetLobby();
        isConnected = false;
        setStampButtonVisible(false);
        initConnection();
        showScreen('menu-screen');
      } else {
        if (sourceId) {
          removeGuestConnection(sourceId);
        }
      }
      return;
    }

    if (data.type === "KICKED_FROM_LOBBY") {
      if (!isHost && currentGameState?.myConnId === data.payload.targetConnId) {
        alert("参加枠が減らされたため、ロビーから退出しました。");
        disconnectConnection();
      }
      return;
    }

    if (data.type === "QUIT_TO_LOBBY") {
      setStampButtonVisible(false);
      showScreen('lobby-screen');
      if (isHost) {
        sendData({ type: "QUIT_TO_LOBBY" });
        broadcastLobbyState();
      }
      return;
    }  

    if (data.type === "LOBBY_GAME_START") {
      setStampButtonVisible(true); 
      selectedGame = data.payload.game;
      alert("ホストがゲームを開始しました！");
      if (selectedGame === 'reversi') { showScreen('game-screen'); initGame(false); }
      else if (selectedGame === 'dots') { showScreen('dots-game-screen'); initDotsGame(false); }
      else if (selectedGame === 'concentration') { showScreen('concentration-game-screen'); initConcentrationGame(false); }
      else if (selectedGame === 'minesweeper') { showScreen('minesweeper-game-screen'); initPvPGame(false); }
      else if (selectedGame === 'airhockey') { showScreen('airhockey-game-screen'); initAirHockeySystem(false, sendData); startAirHockey(); }
      else if (selectedGame === 'shogi') { showScreen('shogi-game-screen'); initShogiGame(false); }
      else if (selectedGame === 'mawari') { showScreen('mawari-game-screen'); initMawariShogi(false); }
      return;
    }

    if (data.type === "STAMP") {
      showStampPopup(false, data.payload.stampId, data.payload.senderName);
      return;
    }

    if (selectedGame === 'reversi') {
      if (isHost && data.type === "ACTION_PUT_STONE") processAction(data);
      else if (isHost && data.type === "ACTION_REMATCH_REVERSI") { initGame(true); syncStateToGuest(); }
      else if (!isHost && data.type === "STATE_SYNC") updateGameState(data.payload);
    } else if (selectedGame === 'dots') {
      if (data.type === "ACTION_DRAW_LINE") processDotsAction(data);
      else if (isHost && data.type === "ACTION_REMATCH_DOTS") { initDotsGame(true); syncDotsStateToGuest(); }
      else if (!isHost && data.type === "STATE_SYNC_DOTS") updateDotsGameState(data.payload);
    } else if (selectedGame === 'concentration') {
      if (data.type === "CONCENTRATION_FLIP" || data.type === "CONCENTRATION_CONFIRM") processConcentrationAction(data);
      else if (isHost && data.type === "CONCENTRATION_REMATCH") { initConcentrationGame(true); syncConcentrationStateToGuest(); }
      else if (!isHost && data.type === "CONCENTRATION_STATE_SYNC") updateConcentrationGameState(data.payload);
    } else if (selectedGame === 'minesweeper') {
      if (data.type === "MINE_OPEN" || data.type === "MINE_END_TURN") processMineAction(data);
      else if (isHost && data.type === "MINE_REMATCH") { initPvPGame(true); syncMineStateToGuest(); }
      else if (!isHost && data.type === "MINE_STATE_SYNC") updateMineGameState(data.payload);
    } else if (selectedGame === 'airhockey') {
      if (data.type === "ah_sync_host" || data.type === "ah_sync_guest" || data.type === "ah_score") {
        processAirHockeyData(data);
      } else if (data.type === "start_airhockey") {
        startAirHockey();
      }
    } else if (selectedGame === 'shogi') {
      if (data.type === "ACTION_SHOGI_MOVE") processShogiAction(data);
      else if (isHost && data.type === "ACTION_REMATCH_SHOGI") { initShogiGame(true); syncShogiStateToGuest(); }
      else if (!isHost && data.type === "STATE_SYNC_SHOGI") updateShogiGameState(data.payload);
    } else if (selectedGame === 'mawari') {
      if (data.type === "MAWARI_ACTION_ROLL" || data.type === "MAWARI_START_ANIMATION" || data.type === "MAWARI_ACTION_REMATCH" || data.type === "MAWARI_REMATCH") {
        processMawariAction(data);
      } else if (data.type === "MAWARI_STATE_SYNC") {
        updateMawariGameState(data.payload);
      }
    }
  });

  // --- ウィンドウイベント・バージョン情報の適用 ---
  window.addEventListener('beforeunload', (e) => {
    if (isConnected) {
      e.preventDefault();
      e.returnValue = '通信が切断されますがよろしいですか？';
      return e.returnValue;
    }
  });

  history.pushState(null, null, location.href);
  window.addEventListener('popstate', () => {
    history.pushState(null, null, location.href);
    if (isConnected) {
      if (confirm("通信が切断されます。メインメニューに戻りますか？")) disconnectConnection();
    } else {
      const menuScreen = document.getElementById('menu-screen');
      if (menuScreen && !menuScreen.classList.contains('active')) {
        if (confirm("メインメニューに戻りますか？")) showScreen('menu-screen');
      }
    }
  });

  const appVerEl = document.getElementById('app-version-text');
  if (appVerEl && window.APP_VERSION) {
    appVerEl.innerText = `Ver ${window.APP_VERSION}`;
  }
}

// すでにDOMの読み込みが完了していれば即座に実行、まだならイベントを待つ
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}