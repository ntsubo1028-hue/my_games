import { 
  setupHostConnection, 
  setupGuestConnection, 
  handleGuestAnswer, 
  generateMultiPartQR, 
  startMultiPartScan, 
  cancelScan, 
  initConnection, 
  setOnMessage,
  isConnectionEstablished,
  sendData
} from './connection.js';

import { 
  initGame, 
  processAction, 
  updateGameState, 
  syncStateToGuest, 
  requestRematch 
} from './othello.js';

import { 
  initDotsGame, 
  processDotsAction, 
  updateDotsGameState, 
  syncDotsStateToGuest, 
  requestRematchDots 
} from './dots_and_boxes.js';

import { 
  initTetris, 
  stopTetris, 
  moveTetris, 
  dropTetris, 
  rotateTetris, 
  hardDropTetris 
} from './tetris.js';

import { 
  initGame as initConcentrationGame, 
  processAction as processConcentrationAction, 
  updateGameState as updateConcentrationGameState, 
  syncStateToGuest as syncConcentrationStateToGuest, 
  requestRematch as requestConcentrationRematch,
  handleScreenTap as handleConcentrationScreenTap
} from './concentration.js';

import { 
  initSoloGame, 
  initPvPGame, 
  toggleInputMode, 
  endTurn, 
  processAction as processMineAction, 
  updateGameState as updateMineGameState, 
  syncStateToGuest as syncMineStateToGuest, 
  requestRematch as requestMineRematch 
} from './minesweeper.js';

let isHost = false;
let selectedGame = 'othello'; 

// --- 画面切り替え ---
function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
  document.getElementById(screenId).classList.add('active');
}

// --- メインメニューのボタン制御 ---
document.getElementById('btn-goto-host-select').onclick = () => {
  showScreen('host-game-select-screen');
};

document.getElementById('btn-back-main').onclick = () => {
  initConnection(); 
  showScreen('menu-screen');
};

document.getElementById('btn-guest').onclick = () => {
  isHost = false;
  startGuestScanFlow();
};

document.getElementById('btn-play-solo-mine').onclick = () => {
  showScreen('minesweeper-game-screen');
  initSoloGame();
};

// --- ホスト：ゲーム選択 ---
document.getElementById('btn-select-othello').onclick = () => {
  selectedGame = 'othello';
  if (isConnectionEstablished()) {
    sendData({ type: "CHANGE_GAME", payload: { game: 'othello' } });
    showScreen('game-screen');
    initGame(true);
    syncStateToGuest();
  } else {
    isHost = true;
    startHostConnectionFlow();
  }
};

document.getElementById('btn-select-dots').onclick = () => {
  selectedGame = 'dots';
  if (isConnectionEstablished()) {
    sendData({ type: "CHANGE_GAME", payload: { game: 'dots' } });
    showScreen('dots-game-screen');
    initDotsGame(true);
    syncDotsStateToGuest();
  } else {
    isHost = true;
    startHostConnectionFlow();
  }
};

document.getElementById('btn-select-concentration').onclick = () => {
  selectedGame = 'concentration';
  if (isConnectionEstablished()) {
    sendData({ type: "CHANGE_GAME", payload: { game: 'concentration' } });
    showScreen('concentration-game-screen');
    initConcentrationGame(true);
    syncConcentrationStateToGuest();
  } else {
    isHost = true;
    startHostConnectionFlow();
  }
};

document.getElementById('btn-select-minesweeper').onclick = () => {
  selectedGame = 'minesweeper';
  if (isConnectionEstablished()) {
    sendData({ type: "CHANGE_GAME", payload: { game: 'minesweeper' } });
    showScreen('minesweeper-game-screen');
    initPvPGame(true);
    syncMineStateToGuest();
  } else {
    isHost = true;
    startHostConnectionFlow();
  }
};

// --- ホスト：接続確立フロー ---
async function startHostConnectionFlow() {
  showScreen('connection-screen');
  document.getElementById('conn-title').innerText = "ホスト接続情報";
  document.getElementById('conn-status').innerText = "接続情報を収集中...";
  document.getElementById('qr-container').style.display = 'none';
  
  const btnScan = document.getElementById('btn-start-scan');
  btnScan.style.display = 'inline-block';
  btnScan.innerText = "ゲストのQRを読む";
  btnScan.onclick = () => startMultiPartScan(
    async (answerObj) => {
      await handleGuestAnswer(answerObj);
    },
    () => showScreen('camera-screen'),
    () => showScreen('connection-screen')
  );

  try {
    const localDesc = await setupHostConnection(() => {
      if (selectedGame === 'othello') {
        showScreen('game-screen');
        initGame(true);
        syncStateToGuest();
      } else if (selectedGame === 'dots') {
        showScreen('dots-game-screen');
        initDotsGame(true);
        syncDotsStateToGuest();
      } else if (selectedGame === 'concentration') {
        showScreen('concentration-game-screen');
        initConcentrationGame(true);
        syncConcentrationStateToGuest();
      } else if (selectedGame === 'minesweeper') {
        showScreen('minesweeper-game-screen');
        initPvPGame(isHost);
        if (isHost) syncMineStateToGuest();
      }
    });
    document.getElementById('qr-container').style.display = 'flex';
    generateMultiPartQR('conn-status', localDesc, selectedGame);
  } catch (e) {
    document.getElementById('conn-status').className = 'error-text';
    document.getElementById('conn-status').innerText = "エラー:\n" + e.message;
  }
}

// --- ゲスト：スキャンフロー ---
function startGuestScanFlow() {
  showScreen('connection-screen');
  document.getElementById('conn-title').innerText = "ゲスト接続準備";
  document.getElementById('conn-status').innerText = "ホストのQRを読み取ってください";
  document.getElementById('qr-container').style.display = 'none';
  
  const btnScan = document.getElementById('btn-start-scan');
  btnScan.style.display = 'inline-block';
  btnScan.innerText = "ホストのQRを読む";
  btnScan.onclick = () => startMultiPartScan(
    async (scanResult) => {
      const offerObj = { type: scanResult.type, sdp: scanResult.sdp };
      selectedGame = scanResult.gameType;

      const localDesc = await setupGuestConnection(offerObj, () => {
        if (selectedGame === 'othello') {
          showScreen('game-screen');
          initGame(false);
        } else if (selectedGame === 'dots') {
          showScreen('dots-game-screen');
          initDotsGame(false);
        } else if (selectedGame === 'concentration') {
          showScreen('concentration-game-screen');
          initConcentrationGame(false);
        } else if (selectedGame === 'minesweeper') { // ★ここを追加しました
          showScreen('minesweeper-game-screen');
          initPvPGame(false);
        }
      });

      document.getElementById('conn-title').innerText = "ホストに読ませるQR";
      btnScan.style.display = 'none';
      document.getElementById('qr-container').style.display = 'flex';
      generateMultiPartQR('conn-status', localDesc, selectedGame);
    },
    () => showScreen('camera-screen'),
    () => showScreen('connection-screen')
  );
}

// --- 各種ボタン処理 ---
document.getElementById('btn-cancel-scan').onclick = () => {
  cancelScan(() => {
    if (isHost) showScreen('connection-screen');
    else showScreen('menu-screen');
  });
};

document.getElementById('btn-back-select').onclick = () => {
  initConnection();
  if (isHost) showScreen('host-game-select-screen');
  else showScreen('menu-screen');
};

const handleQuitGame = () => {
  if (isHost) {
    showScreen('host-game-select-screen');
  } else {
    showScreen('connection-screen');
    document.getElementById('conn-title').innerText = "ホストの選択待ち";
    document.getElementById('conn-status').innerText = "ホストが次のゲームを選んでいます...";
    document.getElementById('qr-container').style.display = 'none';
    document.getElementById('btn-start-scan').style.display = 'none';
  }
};

document.getElementById('btn-quit-game').onclick = handleQuitGame;
document.getElementById('btn-quit-dots').onclick = handleQuitGame;
document.getElementById('btn-quit-concentration').onclick = handleQuitGame;

document.getElementById('btn-rematch-othello').onclick = () => requestRematch();
document.getElementById('btn-rematch-dots').onclick = () => requestRematchDots();
document.getElementById('btn-rematch-concentration').onclick = () => requestConcentrationRematch();

// --- 通信メッセージの受信処理 ---
setOnMessage((data) => {
  if (data.type === "CHANGE_GAME") {
    selectedGame = data.payload.game;
    if (selectedGame === 'othello') {
      showScreen('game-screen');
      initGame(false);
    } else if (selectedGame === 'dots') {
      showScreen('dots-game-screen');
      initDotsGame(false);
    } else if (selectedGame === 'concentration') {
      showScreen('concentration-game-screen');
      initConcentrationGame(false);
    } else if (selectedGame === 'minesweeper') {
      showScreen('minesweeper-game-screen');
      initPvPGame(false);
    }
    return;
  }

  if (selectedGame === 'othello') {
    if (isHost && data.type === "ACTION_PUT_STONE") {
      processAction(data);
    } else if (isHost && data.type === "ACTION_REMATCH_OTHELLO") {
      initGame(true);
      syncStateToGuest();
    } else if (!isHost && data.type === "STATE_SYNC") {
      updateGameState(data.payload);
    }
  } else if (selectedGame === 'dots') {
    if (data.type === "ACTION_DRAW_LINE") {
      processDotsAction(data);
    } else if (isHost && data.type === "ACTION_REMATCH_DOTS") {
      initDotsGame(true);
      syncDotsStateToGuest();
    } else if (!isHost && data.type === "STATE_SYNC_DOTS") {
      updateDotsGameState(data.payload);
    }
  } else if (selectedGame === 'concentration') {
    if (data.type === "CONCENTRATION_FLIP" || data.type === "CONCENTRATION_CONFIRM") {
      processConcentrationAction(data);
    } else if (isHost && data.type === "CONCENTRATION_REMATCH") {
      initConcentrationGame(true);
      syncConcentrationStateToGuest();
    } else if (!isHost && data.type === "CONCENTRATION_STATE_SYNC") {
      updateConcentrationGameState(data.payload);
    }
    } else if (selectedGame === 'minesweeper') {
      if (data.type === "MINE_OPEN" || data.type === "MINE_END_TURN") {
        processMineAction(data);
      } else if (isHost && data.type === "MINE_REMATCH") {
        initPvPGame(true);
        syncMineStateToGuest();
      } else if (!isHost && data.type === "MINE_STATE_SYNC") {
        updateMineGameState(data.payload);
      }
    }
});

// --- テトリス（一人用）のボタン処理 ---
document.getElementById('btn-play-tetris').onclick = () => {
  showScreen('tetris-game-screen');
  initTetris();
};

document.getElementById('btn-quit-tetris').onclick = () => {
  stopTetris();
  showScreen('menu-screen');
};

document.getElementById('btn-rematch-tetris').onclick = () => {
  initTetris();
};

document.getElementById('btn-tetris-left').onclick = () => moveTetris(-1);
document.getElementById('btn-tetris-right').onclick = () => moveTetris(1);
document.getElementById('btn-tetris-down').onclick = () => dropTetris();
document.getElementById('btn-tetris-up').onclick = () => rotateTetris();
document.getElementById('btn-tetris-drop').onclick = () => hardDropTetris();

document.getElementById('concentration-game-screen').onclick = () => {
  if (selectedGame === 'concentration') {
    handleConcentrationScreenTap();
  }
};

//マインスイーパー専用ボタンのイベント追加
document.getElementById('btn-mine-mode').onclick = () => toggleInputMode();
document.getElementById('btn-mine-end-turn').onclick = () => endTurn();
document.getElementById('btn-quit-mine').onclick = () => {
  if (isConnectionEstablished()) {
    // 対戦中の場合は既存の通信切断＆退出処理
    handleQuitGame(); 
  } else {
    // 一人用の場合は強制的にメインメニューへ戻る
    showScreen('menu-screen');
  }
};
document.getElementById('btn-rematch-mine').onclick = () => requestMineRematch();