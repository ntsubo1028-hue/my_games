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
import { initLobby, addGuestConnection, removeGuestConnection, updateLobbyStateFromHost, setMyConnId, broadcastLobbyState, currentGameState, resetLobby, renderLobbyUI} from './lobby.js';
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
      btnSend.disabled = false;
    });
  });

  document.getElementById('btn-close-stamp').onclick = () => { modal.style.display = 'none'; };

  btnSend.onclick = () => {
    if (selectedStampId && isConnected) {
      try {
        sendData({ type: "STAMP", payload: { stampId: selectedStampId } });
        showStampPopup(true, selectedStampId);
      } catch (err) {
        console.error("スタンプの送信に失敗しました:", err);
      }
      
      modal.style.display = 'none';
      btnSend.disabled = true;
      options.forEach(o => o.classList.remove('selected'));
      selectedStampId = null;
    }
  };

  document.querySelectorAll('.btn-open-stamp').forEach(btn => {
    btn.onclick = () => {
      selectedStampId = null;
      options.forEach(o => o.classList.remove('selected'));
      btnSend.disabled = true;
      modal.style.display = 'flex';
    };
  });
}

document.getElementById('btn-lobby-add-guest').onclick = () => {
  currentGuestCount++;
  pendingGuestId = `guest-${currentGuestCount}`;
  startHostConnectionFlow(pendingGuestId);
};

// 【修正】解散・退出ボタンの処理（通信切断と状態リセット）
document.getElementById('btn-quit-lobby').onclick = () => {
  const msg = isHost ? "ロビーを解散して通信を切断し、メニューに戻りますか？" : "ロビーから退出してメニューに戻りますか？";
  if (confirm(msg)) {
    resetLobby();
    currentGuestCount = 0;
    
    if (isConnected) {
      disconnectConnection(); // disconnectConnection 内で showScreen('menu-screen') が実行されます
    } else {
      showScreen('menu-screen');
    }
  }
};

// ★ 【追加】ゲームを変更するボタンの処理
document.getElementById('btn-lobby-change-game').onclick = () => {
  // 通信とゲスト状態を維持したまま、ホストのゲーム選択画面へ戻る
  showScreen('host-game-select-screen');
};

document.getElementById('btn-lobby-start').onclick = () => {
  if (isConnected) {
    sendData({ type: "LOBBY_GAME_START", payload: { game: selectedGame } });
  }
  showGameScreenForHost(selectedGame);
};

function showStampPopup(isMe, stampId) {
  const stamp = STAMPS[stampId];
  if (!stamp) return;

  const popup = document.createElement('div');
  popup.className = `stamp-popup ${isMe ? 'stamp-popup-me' : 'stamp-popup-opponent'}`;
  popup.innerHTML = `
    <div class="stamp-popup-icon">${stamp.icon}</div>
    <div class="stamp-popup-text">${stamp.text}</div>
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
  document.getElementById(screenId).classList.add('active');
}

document.getElementById('btn-goto-host-select').onclick = () => { 
  showScreen('host-game-select-screen'); 
  document.getElementById('btn-back-main').style.display = 'inline-block';
  document.getElementById('btn-disconnect-host').style.display = 'none';
};
document.getElementById('btn-back-main').onclick = () => { showScreen('menu-screen'); };
document.getElementById('btn-guest').onclick = () => { isHost = false; startGuestScanFlow(); };
document.getElementById('btn-play-solo-mine').onclick = () => { 
  setStampButtonVisible(false); 
  showScreen('minesweeper-game-screen'); 
  initSoloGame(); 
};

document.getElementById('btn-select-reversi').onclick = () => { selectGameFlow('reversi'); };
document.getElementById('btn-select-dots').onclick = () => { selectGameFlow('dots'); };
document.getElementById('btn-select-concentration').onclick = () => { selectGameFlow('concentration'); };
document.getElementById('btn-select-minesweeper').onclick = () => { selectGameFlow('minesweeper'); };
document.getElementById('btn-select-airhockey').onclick = () => { selectGameFlow('airhockey'); };
document.getElementById('btn-select-shogi').onclick = () => { selectGameFlow('shogi'); };
document.getElementById('btn-select-mawari').onclick = () => { selectGameFlow('mawari'); };

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

function resetConnectionUI() {
  document.getElementById('qr-container').style.display = 'none';
  document.getElementById('text-copy-container').style.display = 'none';
  document.getElementById('step-guest-choose-input').style.display = 'none';
  document.getElementById('step-host-choose-output').style.display = 'none';
  document.getElementById('step-host-done-container').style.display = 'none';
  document.getElementById('step-host-choose-input').style.display = 'none';
  document.getElementById('step-guest-choose-output').style.display = 'none';
  document.getElementById('step-text-input-area').style.display = 'none';
}

async function startHostConnectionFlow(guestId) {
  showScreen('connection-screen');
  document.getElementById('conn-title').innerText = "ゲスト接続の準備";
  document.getElementById('conn-status').innerText = "接続情報を準備しています...";
  resetConnectionUI();

  try {
    const localDesc = await setupHostConnection(guestId, (connectedId) => {
      isConnected = true; 
      alert(`ゲストと接続しました！`);
      showScreen('lobby-screen');
      addGuestConnection(connectedId, `ゲスト ${currentGuestCount}`);
    });

    localConnectionDataStr = encodeSdp({ type: localDesc.type, sdp: localDesc.sdp, gameType: selectedGame, targetId: guestId });

    document.getElementById('conn-status').innerText = "自分の情報をどうやって相手に伝えますか？";

    const hostChooseOutput = document.getElementById('step-host-choose-output');
    hostChooseOutput.style.display = 'block';

    const showDoneButton = () => { document.getElementById('step-host-done-container').style.display = 'block'; };

    document.getElementById('btn-host-output-qr').onclick = () => {
      hostChooseOutput.style.display = 'none';
      document.getElementById('qr-container').style.display = 'flex';
      generateMultiPartQR('conn-status', localDesc, selectedGame, guestId);
      showDoneButton();
    };

    document.getElementById('btn-host-output-text').onclick = () => {
      hostChooseOutput.style.display = 'none';
      document.getElementById('text-copy-container').style.display = 'block';
      document.getElementById('conn-status').innerText = "接続情報をコピーして相手に送ってください";
      showDoneButton();
    };

    document.getElementById('btn-copy-sdp').onclick = () => {
      navigator.clipboard.writeText(localConnectionDataStr).then(() => {
        alert("接続情報をコピーしました！\nLINE等で相手に送ってください。");
      });
    };

    document.getElementById('btn-host-done-output').onclick = () => {
      document.getElementById('qr-container').style.display = 'none';
      document.getElementById('text-copy-container').style.display = 'none';
      document.getElementById('step-host-done-container').style.display = 'none';

      document.getElementById('conn-status').innerText = "相手からの返信情報を入力してください";
      const hostChooseInput = document.getElementById('step-host-choose-input');
      hostChooseInput.style.display = 'block';

      document.getElementById('btn-host-input-qr').onclick = () => {
        hostChooseInput.style.display = 'none';
        startMultiPartScan(
          async (answerObj) => { 
            await handleGuestAnswer(guestId, answerObj); 
            document.getElementById('conn-status').innerText = "接続完了！ロビーに戻ります...";
          },
          () => showScreen('camera-screen'),
          () => showScreen('connection-screen')
        );
      };

      document.getElementById('btn-host-input-text').onclick = () => {
        hostChooseInput.style.display = 'none';
        document.getElementById('step-text-input-area').style.display = 'block';
      };
    };

    const textInput = document.getElementById('text-sdp-input');
    textInput.value = '';
    
    document.getElementById('btn-submit-sdp').onclick = () => {
      const pasted = textInput.value.trim();
      if (!pasted) return;

      document.getElementById('step-text-input-area').style.display = 'none';
      document.getElementById('conn-status').innerText = "接続を確立しています...";

      setTimeout(async () => {
        try {
          const answerObj = decodeSdp(pasted);
          await handleGuestAnswer(guestId, answerObj);
          document.getElementById('conn-status').innerText = "接続完了！ロビーに戻ります...";
        } catch (e) {
          console.error("ホスト側テキスト接続エラー:", e);
          alert("エラーが発生しました！\n詳細: " + e.message);
          document.getElementById('step-text-input-area').style.display = 'block';
          document.getElementById('conn-status').innerText = "相手からの返信情報を入力してください";
        }
      }, 2000);
    };

  } catch (e) {
    document.getElementById('conn-status').className = 'error-text';
    document.getElementById('conn-status').innerText = "エラー:\n" + e.message;
  }
}

function startGuestScanFlow() {
  showScreen('connection-screen');
  document.getElementById('conn-title').innerText = "ゲスト参加の準備";
  document.getElementById('conn-status').innerText = "ホストの情報をどうやって入力するか選んでください";
  resetConnectionUI();

  document.getElementById('btn-back-select').style.display = 'inline-block';
  document.getElementById('btn-disconnect-guest').style.display = 'none';

  const guestChooseInput = document.getElementById('step-guest-choose-input');
  guestChooseInput.style.display = 'block';

  const processHostOffer = async (scanResult) => {
    try {
      const offerObj = { type: scanResult.type || scanResult.t, sdp: scanResult.sdp || scanResult.s };
      selectedGame = scanResult.gameType || scanResult.g;
      const targetGuestId = scanResult.targetId || scanResult.id || 'guest-1';
      
      setMyConnId(targetGuestId); // ゲスト側で自身のIDを設定

      document.getElementById('conn-status').innerText = "ホストへの返信を生成中...";

      const localDesc = await setupGuestConnection(offerObj, () => {
        isConnected = true;
        setStampButtonVisible(true);
        initLobby(selectedGame, false);
        showScreen('lobby-screen');
      });

      localConnectionDataStr = encodeSdp({ type: localDesc.type, sdp: localDesc.sdp, gameType: selectedGame });
      document.getElementById('conn-title').innerText = "ホストに情報を返す";
      document.getElementById('conn-status').innerText = "返信の準備ができました。";

      const guestChooseOutput = document.getElementById('step-guest-choose-output');
      guestChooseOutput.style.display = 'block';

      document.getElementById('btn-guest-output-qr').onclick = () => {
        guestChooseOutput.style.display = 'none';
        document.getElementById('qr-container').style.display = 'flex';
        generateMultiPartQR('conn-status', localDesc, selectedGame);
      };

      document.getElementById('btn-guest-output-text').onclick = () => {
        guestChooseOutput.style.display = 'none';
        document.getElementById('text-copy-container').style.display = 'block';
        document.getElementById('conn-status').innerText = "接続情報をコピーして相手に送ってください";
      };

      document.getElementById('btn-copy-sdp').onclick = () => {
        navigator.clipboard.writeText(localConnectionDataStr).then(() => {
          alert("返信情報をコピーしました！");
        });
      };

    } catch (e) {
      alert("処理に失敗しました。");
      document.getElementById('step-guest-choose-input').style.display = 'block';
      document.getElementById('conn-status').innerText = "ホストの情報をどうやって入力するか選んでください";
    }
  };

  document.getElementById('btn-guest-input-qr').onclick = () => {
    guestChooseInput.style.display = 'none';
    startMultiPartScan(
      async (scanResult) => { await processHostOffer(scanResult); },
      () => showScreen('camera-screen'),
      () => showScreen('connection-screen')
    );
  };

  document.getElementById('btn-guest-input-text').onclick = () => {
    guestChooseInput.style.display = 'none';
    document.getElementById('step-text-input-area').style.display = 'block';
  };

  const textInput = document.getElementById('text-sdp-input');
  textInput.value = '';
  
  document.getElementById('btn-submit-sdp').onclick = () => {
    const pasted = textInput.value.trim();
    if (!pasted) return;

    document.getElementById('step-text-input-area').style.display = 'none';
    document.getElementById('conn-status').innerText = "接続を確立しています...";

    setTimeout(async () => {
      try {
        const scanResult = decodeSdp(pasted);
        await processHostOffer(scanResult);
      } catch (e) {
        console.error("ゲスト側テキスト接続エラー:", e);
        alert("エラーが発生しました！\n詳細: " + e.message);
        document.getElementById('step-text-input-area').style.display = 'block';
        document.getElementById('conn-status').innerText = "ホストの情報をどうやって入力するか選んでください";
      }
    }, 2000);
  };
}

document.getElementById('btn-cancel-scan').onclick = () => {
  cancelScan(() => {
    showScreen('connection-screen');
    if (isHost) {
      document.getElementById('step-host-choose-input').style.display = 'block';
      document.getElementById('conn-status').innerText = "相手からの返信情報を入力してください";
    } else {
      document.getElementById('step-guest-choose-input').style.display = 'block';
      document.getElementById('conn-status').innerText = "ホストの情報をどうやって入力するか選んでください";
    }
  });
};

document.getElementById('btn-cancel-text-input').onclick = () => {
  document.getElementById('step-text-input-area').style.display = 'none';
  if (isHost) {
    document.getElementById('step-host-choose-input').style.display = 'block';
    document.getElementById('conn-status').innerText = "相手からの返信情報を入力してください";
  } else {
    document.getElementById('step-guest-choose-input').style.display = 'block';
    document.getElementById('conn-status').innerText = "ホストの情報をどうやって入力するか選んでください";
  }
};

function cancelOutputSelection() {
  document.getElementById('qr-container').style.display = 'none';
  document.getElementById('text-copy-container').style.display = 'none';
  if (isHost) {
    document.getElementById('step-host-done-container').style.display = 'none';
    document.getElementById('step-host-choose-output').style.display = 'block';
    document.getElementById('conn-status').innerText = "自分の情報をどうやって相手に伝えますか？";
  } else {
    document.getElementById('step-guest-choose-output').style.display = 'block';
    document.getElementById('conn-status').innerText = "返信の準備ができました。";
  }
}
document.getElementById('btn-cancel-output-qr').onclick = cancelOutputSelection;
document.getElementById('btn-cancel-output-text').onclick = cancelOutputSelection;

document.getElementById('btn-back-select').onclick = () => {
  if (isHost) {
    if (pendingGuestId) removeConnection(pendingGuestId);
    showScreen('lobby-screen');
  } else {
    initConnection();
    showScreen('menu-screen');
  }
};

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
document.getElementById('btn-disconnect-host').onclick = handleDisconnectClick;
document.getElementById('btn-disconnect-guest').onclick = handleDisconnectClick;

// 【修正】どちらかが抜けたら全員ロビーに戻る共通処理
const handleQuitGame = () => {
  if (!confirm("ゲームを終了してロビーに戻りますか？")) return;
  setStampButtonVisible(false);

  // 接続中であれば相手（または全員）にロビーへ戻る通知を送る
  if (isConnected) {
    sendData({ type: "QUIT_TO_LOBBY" });
  }

  showScreen('lobby-screen');
  
  // ホストの場合はロビーの表示を更新して再ブロードキャスト
  if (isHost) {
    renderLobbyUI();
    broadcastLobbyState();
  }
};

document.getElementById('btn-quit-game').onclick = handleQuitGame;
document.getElementById('btn-quit-dots').onclick = handleQuitGame;
document.getElementById('btn-quit-concentration').onclick = handleQuitGame;
document.getElementById('btn-quit-shogi').onclick = handleQuitGame;

// エアホッケーの独自終了処理も同様に共通化
document.getElementById('btn-quit-airhockey').onclick = () => { 
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
};

document.getElementById('btn-rematch-reversi').onclick = () => requestRematch();
document.getElementById('btn-rematch-dots').onclick = () => requestRematchDots();
document.getElementById('btn-rematch-concentration').onclick = () => requestConcentrationRematch();
document.getElementById('btn-rematch-airhockey').onclick = () => { sendData({ type: 'start_airhockey' }); startAirHockey(); };
document.getElementById('btn-rematch-shogi').onclick = () => requestShogiRematch();
document.getElementById('btn-rematch-mawari').onclick = () => initMawariShogi();

// メッセージ受信ハンドラ
setOnMessage((data, sourceId) => {
  if (data.type === "LOBBY_STATE_SYNC") {
    updateLobbyStateFromHost(data.payload);
    return;
  }

  if (data.type === "DISCONNECT") {
    if (!isHost) {
      // ゲストの場合：ホストがロビーを解散した
      alert("ホストによってロビーが解散されました。");
      resetLobby();
      isConnected = false;
      setStampButtonVisible(false);
      initConnection();
      showScreen('menu-screen');
    } else {
      // ホストの場合：ゲストが自主退出した
      if (sourceId) {
        removeGuestConnection(sourceId);
      }
    }
    return;
  }

  // 枠削減による退出通知
  if (data.type === "KICKED_FROM_LOBBY") {
    if (!isHost && currentGameState.myConnId === data.payload.targetConnId) {
      alert("参加枠が減らされたため、ロビーから退出しました。");
      disconnectConnection();
    }
    return;
  }

  // ★どちらかがゲームを終了してロビーに戻ったときの共通処理
  if (data.type === "QUIT_TO_LOBBY") {
    setStampButtonVisible(false);
    showScreen('lobby-screen');
    if (isHost) {
      // ★ホストが通知を受け取ったら、他のゲスト全員にも転送し、ロビー状態を同期する
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
    showStampPopup(false, data.payload.stampId);
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
    if (data.type === "MAWARI_ACTION_ROLL") {
      processMawariAction(data);
    } else if (data.type === "MAWARI_STATE_SYNC") {
      updateMawariGameState(data.payload);
    }
  }
});

document.getElementById('btn-play-block_drop').onclick = () => { 
  setStampButtonVisible(false);
  showScreen('block_drop-game-screen'); 
  initBlock_drop(); 
};
document.getElementById('btn-quit-block_drop').onclick = () => { 
  if (confirm("ゲームを終了してメニューに戻りますか？")) {
    stopBlock_drop(); 
    showScreen('menu-screen'); 
  }
};
document.getElementById('btn-rematch-block_drop').onclick = () => initBlock_drop();
document.getElementById('concentration-game-screen').onclick = () => { if (selectedGame === 'concentration') handleConcentrationScreenTap(); };

document.getElementById('btn-mine-mode').onclick = () => toggleInputMode();
document.getElementById('btn-mine-end-turn').onclick = () => endTurn();

document.getElementById('btn-quit-mine').onclick = () => {
  if (isConnected) {
    handleQuitGame(); 
  } else {
    if (confirm("ゲームを終了してメニューに戻りますか？")) showScreen('menu-screen');
  }
};
document.getElementById('btn-rematch-mine').onclick = () => requestMineRematch();

document.getElementById('btn-quit-mawari').onclick = () => {
  if (confirm("ゲームを終了してロビーに戻りますか？")) {
    stopMawariShogi();
    setStampButtonVisible(false);
    
    // 相手にもロビーに戻るよう通知する
    if (isConnected) {
      sendData({ type: "QUIT_TO_LOBBY" });
    }
    
    showScreen('lobby-screen');
    
    if (isHost) {
      broadcastLobbyState();
    }
  }
};

document.getElementById('btn-mawari-dice').onclick = () => {
  rollMawariDice();
};

window.addEventListener('beforeunload', (e) => {
  if (isConnected) {
    e.preventDefault();
    e.returnValue = '通信が切断されますがよろしいですか？';
    return e.returnValue;
  }
});

history.pushState(null, null, location.href);
window.addEventListener('popstate', (e) => {
  history.pushState(null, null, location.href);
  if (isConnected) {
    if (confirm("通信が切断されます。メインメニューに戻りますか？")) disconnectConnection();
  } else {
    if (!document.getElementById('menu-screen').classList.contains('active')) {
      if (confirm("メインメニューに戻りますか？")) showScreen('menu-screen');
    }
  }
});

if (document.getElementById('app-version-text') && window.APP_VERSION) {
  document.getElementById('app-version-text').innerText = `Ver ${window.APP_VERSION}`;
}