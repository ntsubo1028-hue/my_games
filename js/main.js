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

// DOM要素へ安全にクリックイベントを登録するヘルパー関数
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

let isHost = false;
let selectedGame = 'reversi'; 
let localConnectionDataStr = ""; 
let isConnected = false; 

let currentGuestCount = 0;
let pendingGuestId = null;

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

// 自分の名前を取得するヘルパー関数
function getMyName() {
  if (typeof currentGameState !== 'undefined' && currentGameState && currentGameState.slots) {
    const mySlot = currentGameState.slots.find(s => s.connId === currentGameState.myConnId);
    if (mySlot && mySlot.name) return mySlot.name;
  }
  return isHost ? 'ホスト' : 'ゲスト';
}

// 名前変更ボタン＆Enterキー入力のイベント設定（nullガード付き）
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

setClick('btn-lobby-add-guest', () => {
  currentGuestCount++;
  pendingGuestId = `guest-${currentGuestCount}`;
  startHostConnectionFlow(pendingGuestId);
});

setClick('btn-quit-lobby', () => {
  const msg = isHost ? "ロビーを解散して通信を切断し、メニューに戻りますか？" : "ロビーから退出してメニューに戻りますか？";
  if (confirm(msg)) {
    resetLobby();
    currentGuestCount = 0;
    
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

initStampSystem();

function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
  const target = document.getElementById(screenId);
  if (target) target.classList.add('active');
}

setClick('btn-goto-host-select', () => { 
  showScreen('host-game-select-screen'); 
  const btnBack = document.getElementById('btn-back-main');
  const btnDisc = document.getElementById('btn-disconnect-host');
  if (btnBack) btnBack.style.display = 'inline-block';
  if (btnDisc) btnDisc.style.display = 'none';
});

setClick('btn-back-main', () => { showScreen('menu-screen'); });
setClick('btn-guest', () => { isHost = false; startGuestScanFlow(); });
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
}

function setStatusText(text) {
  const el = document.getElementById('conn-status');
  if (el) el.innerText = text;
}

async function startHostConnectionFlow(guestId) {
  showScreen('connection-screen');
  const connTitle = document.getElementById('conn-title');
  if (connTitle) connTitle.innerText = "ゲスト接続の準備";
  setStatusText("接続情報を準備しています...");
  resetConnectionUI();

  try {
    const localDesc = await setupHostConnection(guestId, (connectedId) => {
      isConnected = true; 
      alert(`ゲストと接続しました！`);
      showScreen('lobby-screen');
      addGuestConnection(connectedId, `ゲスト ${currentGuestCount}`);
    });

    localConnectionDataStr = encodeSdp({ type: localDesc.type, sdp: localDesc.sdp, gameType: selectedGame, targetId: guestId });

    setStatusText("自分の情報をどうやって相手に伝えますか？");
    setElementDisplay('step-host-choose-output', 'block');

    const showDoneButton = () => { setElementDisplay('step-host-done-container', 'block'); };

    setClick('btn-host-output-qr', () => {
      setElementDisplay('step-host-choose-output', 'none');
      setElementDisplay('qr-container', 'flex');
      generateMultiPartQR('conn-status', localDesc, selectedGame, guestId);
      showDoneButton();
    });

    setClick('btn-host-output-text', () => {
      setElementDisplay('step-host-choose-output', 'none');
      setElementDisplay('text-copy-container', 'block');
      setStatusText("接続情報をコピーして相手に送ってください");
      showDoneButton();
    });

    setClick('btn-copy-sdp', () => {
      navigator.clipboard.writeText(localConnectionDataStr).then(() => {
        alert("接続情報をコピーしました！\nLINE等で相手に送ってください。");
      });
    });

    setClick('btn-host-done-output', () => {
      setElementDisplay('qr-container', 'none');
      setElementDisplay('text-copy-container', 'none');
      setElementDisplay('step-host-done-container', 'none');

      setStatusText("相手からの返信情報を入力してください");
      setElementDisplay('step-host-choose-input', 'block');

      setClick('btn-host-input-qr', () => {
        setElementDisplay('step-host-choose-input', 'none');
        startMultiPartScan(
          async (answerObj) => { 
            await handleGuestAnswer(guestId, answerObj); 
            setStatusText("接続完了！ロビーに戻ります...");
          },
          () => showScreen('camera-screen'),
          () => showScreen('connection-screen')
        );
      });

      setClick('btn-host-input-text', () => {
        setElementDisplay('step-host-choose-input', 'none');
        setElementDisplay('step-text-input-area', 'block');
      });
    });

    const textInput = document.getElementById('text-sdp-input');
    if (textInput) textInput.value = '';
    
    setClick('btn-submit-sdp', () => {
      if (!textInput) return;
      const pasted = textInput.value.trim();
      if (!pasted) return;

      setElementDisplay('step-text-input-area', 'none');
      setStatusText("接続を確立しています...");

      setTimeout(async () => {
        try {
          const answerObj = decodeSdp(pasted);
          await handleGuestAnswer(guestId, answerObj);
          setStatusText("接続完了！ロビーに戻ります...");
        } catch (e) {
          console.error("ホスト側テキスト接続エラー:", e);
          alert("エラーが発生しました！\n詳細: " + e.message);
          setElementDisplay('step-text-input-area', 'block');
          setStatusText("相手からの返信情報を入力してください");
        }
      }, 2000);
    });

  } catch (e) {
    const connStatus = document.getElementById('conn-status');
    if (connStatus) {
      connStatus.className = 'error-text';
      connStatus.innerText = "エラー:\n" + e.message;
    }
  }
}

function startGuestScanFlow() {
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
      const offerObj = { type: scanResult.type || scanResult.t, sdp: scanResult.sdp || scanResult.s };
      selectedGame = scanResult.gameType || scanResult.g;
      const targetGuestId = scanResult.targetId || scanResult.id || 'guest-1';
      
      setMyConnId(targetGuestId);

      setStatusText("ホストへの返信を生成中...");

      const localDesc = await setupGuestConnection(offerObj, () => {
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
    setElementDisplay('step-guest-choose-input', 'none');
    startMultiPartScan(
      async (scanResult) => { await processHostOffer(scanResult); },
      () => showScreen('camera-screen'),
      () => showScreen('connection-screen')
    );
  });

  setClick('btn-guest-input-text', () => {
    setElementDisplay('step-guest-choose-input', 'none');
    setElementDisplay('step-text-input-area', 'block');
  });

  const textInput = document.getElementById('text-sdp-input');
  if (textInput) textInput.value = '';
  
  setClick('btn-submit-sdp', () => {
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
}

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

function cancelOutputSelection() {
  setElementDisplay('qr-container', 'none');
  setElementDisplay('text-copy-container', 'none');
  if (isHost) {
    setElementDisplay('step-host-done-container', 'none');
    setElementDisplay('step-host-choose-output', 'block');
    setStatusText("自分の情報をどうやって相手に伝えますか？");
  } else {
    setElementDisplay('step-guest-choose-output', 'block');
    setStatusText("返信の準備ができました。");
  }
}

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
setClick('btn-disconnect-host', handleDisconnectClick);
setClick('btn-disconnect-guest', handleDisconnectClick);

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

// メッセージ受信ハンドラ
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
  }
  if (selectedGame === 'mawari') {
    if (data.type === "MAWARI_ACTION_ROLL" || data.type === "MAWARI_START_ANIMATION") {
      processMawariAction(data);
    } else if (data.type === "MAWARI_STATE_SYNC") {
      updateMawariGameState(data.payload);
    }
  }
});

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