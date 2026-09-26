import { 
  setupHostConnection, 
  setupGuestConnection, 
  handleGuestAnswer, 
  generateMultiPartQR, 
  startMultiPartScan, 
  cancelScan, 
  initConnection, 
  setOnMessage,
  sendData
} from './connection.js';

import { initGame, processAction, updateGameState, syncStateToGuest, requestRematch } from './othello.js';
import { initDotsGame, processDotsAction, updateDotsGameState, syncDotsStateToGuest, requestRematchDots } from './dots_and_boxes.js';
import { initTetris, stopTetris } from './tetris.js';
import { initGame as initConcentrationGame, processAction as processConcentrationAction, updateGameState as updateConcentrationGameState, syncStateToGuest as syncConcentrationStateToGuest, requestRematch as requestConcentrationRematch, handleScreenTap as handleConcentrationScreenTap } from './concentration.js';
import { initSoloGame, initPvPGame, toggleInputMode, endTurn, processAction as processMineAction, updateGameState as updateMineGameState, syncStateToGuest as syncMineStateToGuest, requestRematch as requestMineRematch } from './minesweeper.js';
import { initAirHockeySystem, startAirHockey, processAirHockeyData, stopAirHockey } from './airhockey.js';

function encodeSdp(obj) {
  return LZString.compressToBase64(JSON.stringify(obj));
}
function decodeSdp(str) {
  return JSON.parse(LZString.decompressFromBase64(str));
}

let isHost = false;
let selectedGame = 'othello'; 
let localConnectionDataStr = ""; 
let isConnected = false; 

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
document.getElementById('btn-play-solo-mine').onclick = () => { showScreen('minesweeper-game-screen'); initSoloGame(); };

document.getElementById('btn-select-othello').onclick = () => { selectGameFlow('othello'); };
document.getElementById('btn-select-dots').onclick = () => { selectGameFlow('dots'); };
document.getElementById('btn-select-concentration').onclick = () => { selectGameFlow('concentration'); };
document.getElementById('btn-select-minesweeper').onclick = () => { selectGameFlow('minesweeper'); };
document.getElementById('btn-select-airhockey').onclick = () => { selectGameFlow('airhockey'); };

function selectGameFlow(game) {
  selectedGame = game;
  if (isConnected) { 
    sendData({ type: "CHANGE_GAME", payload: { game: game } });
    showGameScreenForHost(game);
  } else {
    isHost = true;
    startHostConnectionFlow();
  }
}

function showGameScreenForHost(game) {
  if (game === 'othello') { showScreen('game-screen'); initGame(true); syncStateToGuest(); }
  else if (game === 'dots') { showScreen('dots-game-screen'); initDotsGame(true); syncDotsStateToGuest(); }
  else if (game === 'concentration') { showScreen('concentration-game-screen'); initConcentrationGame(true); syncConcentrationStateToGuest(); }
  else if (game === 'minesweeper') { showScreen('minesweeper-game-screen'); initPvPGame(true); syncMineStateToGuest(); }
  else if (game === 'airhockey') { showScreen('airhockey-game-screen'); initAirHockeySystem(true, sendData); startAirHockey(); }
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

async function startHostConnectionFlow() {
  showScreen('connection-screen');
  document.getElementById('conn-title').innerText = "ホスト接続の準備";
  document.getElementById('conn-status').innerText = "接続情報を準備しています...";
  resetConnectionUI();

  try {
    const localDesc = await setupHostConnection(() => {
      isConnected = true; 
      showGameScreenForHost(selectedGame);
    });
    localConnectionDataStr = encodeSdp({ type: localDesc.type, sdp: localDesc.sdp, gameType: selectedGame });

    // 文言を修正
    document.getElementById('conn-status').innerText = "自分の情報をどうやって相手に伝えますか？";

    const hostChooseOutput = document.getElementById('step-host-choose-output');
    hostChooseOutput.style.display = 'block';

    const showDoneButton = () => {
      document.getElementById('step-host-done-container').style.display = 'block';
    };

    document.getElementById('btn-host-output-qr').onclick = () => {
      hostChooseOutput.style.display = 'none';
      document.getElementById('qr-container').style.display = 'flex';
      generateMultiPartQR('conn-status', localDesc, selectedGame);
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
            await handleGuestAnswer(answerObj); 
            document.getElementById('conn-status').innerText = "接続完了！ゲームを開始します...";
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
          await handleGuestAnswer(answerObj);
          document.getElementById('conn-status').innerText = "接続完了！ゲームを開始します...";
        } catch (e) {
          alert("無効なテキストです。");
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
      const offerObj = { type: scanResult.type, sdp: scanResult.sdp };
      selectedGame = scanResult.gameType;
      document.getElementById('conn-status').innerText = "ホストへの返信を生成中...";

      const localDesc = await setupGuestConnection(offerObj, () => {
        isConnected = true;
        if (selectedGame === 'othello') { showScreen('game-screen'); initGame(false); }
        else if (selectedGame === 'dots') { showScreen('dots-game-screen'); initDotsGame(false); }
        else if (selectedGame === 'concentration') { showScreen('concentration-game-screen'); initConcentrationGame(false); }
        else if (selectedGame === 'minesweeper') { showScreen('minesweeper-game-screen'); initPvPGame(false); }
        else if (selectedGame === 'airhockey') { showScreen('airhockey-game-screen'); initAirHockeySystem(false, sendData); startAirHockey();}
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
        alert("無効なテキストです。");
        document.getElementById('step-text-input-area').style.display = 'block';
        document.getElementById('conn-status').innerText = "ホストの情報をどうやって入力するか選んでください";
      }
    }, 2000);
  };
}

// ==========================================
// ★ キャンセル（選び直し）処理の統合 ★
// ==========================================

// 1. カメラ読み取りのキャンセル
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

// 2. テキスト入力のキャンセル
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

// 3. 出力方法（QR / テキスト）のキャンセル
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
// ==========================================


document.getElementById('btn-back-select').onclick = () => {
  initConnection();
  if (isHost) showScreen('host-game-select-screen');
  else showScreen('menu-screen');
};

function disconnectConnection() {
  if (isConnected) {
    sendData({ type: "DISCONNECT" });
  }
  isConnected = false;
  setTimeout(() => {
    initConnection();
    showScreen('menu-screen');
  }, 100);
}

const handleDisconnectClick = () => {
  if (confirm("通信を切断してメインメニューに戻りますか？")) {
    disconnectConnection();
  }
};
document.getElementById('btn-disconnect-host').onclick = handleDisconnectClick;
document.getElementById('btn-disconnect-guest').onclick = handleDisconnectClick;

const handleQuitGame = () => {
  if (!confirm("ゲームを終了してメニューに戻りますか？")) return;

  if (isHost) {
    if (isConnected) sendData({ type: "HOST_QUIT_TO_MENU" });
    showScreen('host-game-select-screen');
    document.getElementById('btn-back-main').style.display = 'none';
    document.getElementById('btn-disconnect-host').style.display = 'inline-block';
  } else {
    if (isConnected) sendData({ type: "GUEST_QUIT_TO_MENU" });
    showScreen('connection-screen');
    document.getElementById('conn-title').innerText = "ホストの選択待ち";
    document.getElementById('conn-status').innerText = "ホストが次のゲームを選んでいます...";
    resetConnectionUI();
    document.getElementById('btn-back-select').style.display = 'none';
    document.getElementById('btn-disconnect-guest').style.display = 'block';
  }
};

document.getElementById('btn-quit-game').onclick = handleQuitGame;
document.getElementById('btn-quit-dots').onclick = handleQuitGame;
document.getElementById('btn-quit-concentration').onclick = handleQuitGame;
document.getElementById('btn-quit-airhockey').onclick = () => { stopAirHockey(); handleQuitGame(); };

document.getElementById('btn-rematch-othello').onclick = () => requestRematch();
document.getElementById('btn-rematch-dots').onclick = () => requestRematchDots();
document.getElementById('btn-rematch-concentration').onclick = () => requestConcentrationRematch();
document.getElementById('btn-rematch-airhockey').onclick = () => { sendData({ type: 'start_airhockey' }); startAirHockey(); };

setOnMessage((data) => {
  if (data.type === "DISCONNECT") {
    alert("相手が通信を切断しました。");
    isConnected = false;
    initConnection();
    showScreen('menu-screen');
    return;
  }

  if (data.type === "HOST_QUIT_TO_MENU") {
    showScreen('connection-screen');
    document.getElementById('conn-title').innerText = "ホストの選択待ち";
    document.getElementById('conn-status').innerText = "ホストが次のゲームを選んでいます...";
    resetConnectionUI();
    document.getElementById('btn-back-select').style.display = 'none';
    document.getElementById('btn-disconnect-guest').style.display = 'block';
    return;
  }

  if (data.type === "GUEST_QUIT_TO_MENU") {
    if (isHost) {
      alert("ゲストがゲームを終了しました。");
      showScreen('host-game-select-screen');
      document.getElementById('btn-back-main').style.display = 'none';
      document.getElementById('btn-disconnect-host').style.display = 'inline-block';
    }
    return;
  }

  if (data.type === "CHANGE_GAME") {
    selectedGame = data.payload.game;
    if (selectedGame === 'othello') { showScreen('game-screen'); initGame(false); }
    else if (selectedGame === 'dots') { showScreen('dots-game-screen'); initDotsGame(false); }
    else if (selectedGame === 'concentration') { showScreen('concentration-game-screen'); initConcentrationGame(false); }
    else if (selectedGame === 'minesweeper') { showScreen('minesweeper-game-screen'); initPvPGame(false); }
    else if (selectedGame === 'airhockey') { showScreen('airhockey-game-screen'); initAirHockeySystem(false, sendData); startAirHockey(); }
    return;
  }

  if (selectedGame === 'othello') {
    if (isHost && data.type === "ACTION_PUT_STONE") processAction(data);
    else if (isHost && data.type === "ACTION_REMATCH_OTHELLO") { initGame(true); syncStateToGuest(); }
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
  }
});

document.getElementById('btn-play-tetris').onclick = () => { showScreen('tetris-game-screen'); initTetris(); };
document.getElementById('btn-quit-tetris').onclick = () => { 
  if (confirm("ゲームを終了してメニューに戻りますか？")) {
    stopTetris(); 
    showScreen('menu-screen'); 
  }
};
document.getElementById('btn-rematch-tetris').onclick = () => initTetris();
document.getElementById('concentration-game-screen').onclick = () => { if (selectedGame === 'concentration') handleConcentrationScreenTap(); };

document.getElementById('btn-mine-mode').onclick = () => toggleInputMode();
document.getElementById('btn-mine-end-turn').onclick = () => endTurn();

document.getElementById('btn-quit-mine').onclick = () => {
  if (isConnected) {
    handleQuitGame(); 
  } else {
    if (confirm("ゲームを終了してメニューに戻りますか？")) {
      showScreen('menu-screen');
    }
  }
};
document.getElementById('btn-rematch-mine').onclick = () => requestMineRematch();

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
    if (confirm("通信が切断されます。メインメニューに戻りますか？")) {
      disconnectConnection();
    }
  } else {
    if (!document.getElementById('menu-screen').classList.contains('active')) {
      if (confirm("メインメニューに戻りますか？")) {
        showScreen('menu-screen');
      }
    }
  }
});