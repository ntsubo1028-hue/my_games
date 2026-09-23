import { 
  setupHostConnection, 
  setupGuestConnection, 
  handleGuestAnswer, 
  generateMultiPartQR, 
  toggleQR, 
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

let isHost = false;
let selectedGame = 'othello'; // 初期値

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
  initConnection(); // メインメニューに戻る時だけ完全に切断
  showScreen('menu-screen');
};

// ゲストはゲームを選ばず直接QRスキャンへ
document.getElementById('btn-guest').onclick = () => {
  isHost = false;
  startGuestScanFlow();
};

// --- ホスト：ゲーム選択 ---
document.getElementById('btn-select-othello').onclick = () => {
  selectedGame = 'othello';
  if (isConnectionEstablished()) {
    // すでに接続がつながっている場合は、QRを通らず直接切り替えを通知
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
    // すでに接続がつながっている場合は、QRを通らず直接切り替えを通知
    sendData({ type: "CHANGE_GAME", payload: { game: 'dots' } });
    showScreen('dots-game-screen');
    initDotsGame(true);
    syncDotsStateToGuest();
  } else {
    isHost = true;
    startHostConnectionFlow();
  }
};

// --- ホスト：接続確立フロー（ゲーム共通） ---
async function startHostConnectionFlow() {
  showScreen('connection-screen');
  document.getElementById('conn-title').innerText = "ホスト接続情報 (全3枚)";
  document.getElementById('conn-status').innerText = "接続情報を収集中...";
  document.getElementById('conn-qr').style.display = 'none';
  document.getElementById('btn-toggle-qr').style.display = 'inline-block';
  
  const btnScan = document.getElementById('btn-start-scan');
  btnScan.style.display = 'inline-block';
  btnScan.innerText = "ゲストのQRを読む (全3枚)";
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
      }
    });
    generateMultiPartQR('conn-qr', 'conn-status', localDesc, selectedGame);
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
  document.getElementById('conn-qr').style.display = 'none';
  document.getElementById('btn-toggle-qr').style.display = 'none';
  
  const btnScan = document.getElementById('btn-start-scan');
  btnScan.style.display = 'inline-block';
  btnScan.innerText = "ホストのQRを読む (全3枚)";
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
        }
      });

      document.getElementById('conn-title').innerText = "ホストに読ませるQR (全3枚)";
      btnScan.style.display = 'none';
      document.getElementById('btn-toggle-qr').style.display = 'inline-block';
      generateMultiPartQR('conn-qr', 'conn-status', localDesc, selectedGame);
    },
    () => showScreen('camera-screen'),
    () => showScreen('connection-screen')
  );
}

// --- 各種ボタン処理 ---
document.getElementById('btn-toggle-qr').onclick = () => {
  toggleQR('conn-qr', 'conn-status');
};

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

// ゲーム終了ボタン（接続を切断せず、ホストは選択画面へ、ゲストは待機へ）
const handleQuitGame = () => {
  if (isHost) {
    showScreen('host-game-select-screen');
  } else {
    showScreen('connection-screen');
    document.getElementById('conn-title').innerText = "ホストの選択待ち";
    document.getElementById('conn-status').innerText = "ホストが次のゲームを選んでいます...";
    document.getElementById('conn-qr').style.display = 'none';
    document.getElementById('btn-toggle-qr').style.display = 'none';
    document.getElementById('btn-start-scan').style.display = 'none';
  }
};

document.getElementById('btn-quit-game').onclick = handleQuitGame;
document.getElementById('btn-quit-dots').onclick = handleQuitGame;

// 再戦ボタン（もう一度遊ぶ）
document.getElementById('btn-rematch-othello').onclick = () => {
  requestRematch();
};

document.getElementById('btn-rematch-dots').onclick = () => {
  requestRematchDots();
};

// --- 通信メッセージの受信処理（ルーティング） ---
setOnMessage((data) => {
  // ゲストがホストからのゲーム変更通知を受け取った場合
  if (data.type === "CHANGE_GAME") {
    selectedGame = data.payload.game;
    if (selectedGame === 'othello') {
      showScreen('game-screen');
      initGame(false);
    } else if (selectedGame === 'dots') {
      showScreen('dots-game-screen');
      initDotsGame(false);
    }
    return;
  }

  // 各ゲームのアクション・同期処理
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

// テトリスの画面コントローラー
document.getElementById('btn-tetris-left').onclick = () => moveTetris(-1);
document.getElementById('btn-tetris-right').onclick = () => moveTetris(1);
document.getElementById('btn-tetris-down').onclick = () => dropTetris();
document.getElementById('btn-tetris-up').onclick = () => rotateTetris();
document.getElementById('btn-tetris-drop').onclick = () => hardDropTetris();