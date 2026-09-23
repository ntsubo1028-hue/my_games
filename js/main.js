import { 
  setupHostConnection, 
  setupGuestConnection, 
  handleGuestAnswer, 
  generateMultiPartQR, 
  toggleQR, 
  startMultiPartScan, 
  cancelScan, 
  initConnection, 
  setOnMessage 
} from './connection.js';

import { 
  initGame, 
  processAction, 
  updateGameState, 
  syncStateToGuest 
} from './othello.js';

let isHost = false;
let selectedGame = 'othello'; // 将来の拡張用

function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
  document.getElementById(screenId).classList.add('active');
}

// --- メインメニューのボタン制御 ---
document.getElementById('btn-goto-host-select').onclick = () => {
  showScreen('host-game-select-screen');
};

document.getElementById('btn-back-main').onclick = () => {
  showScreen('menu-screen');
};

// ゲストはゲームを選ばず直接QRスキャンへ
document.getElementById('btn-guest').onclick = () => {
  isHost = false;
  startGuestScanFlow();
};

// --- ホスト：オセロを選択した場合 ---
document.getElementById('btn-select-othello').onclick = async () => {
  isHost = true;
  selectedGame = 'othello';
  showScreen('connection-screen');
  document.getElementById('conn-title').innerText = "ホスト接続情報 (全3枚)";
  document.getElementById('conn-status').innerText = "接続情報を収集中...";
  document.getElementById('conn-qr').style.display = 'none';
  document.getElementById('btn-toggle-qr').style.display = 'inline-block';
  document.getElementById('btn-start-scan').style.display = 'inline-block';
  document.getElementById('btn-start-scan').innerText = "ゲストのQRを読む (全3枚)";
  
  document.getElementById('btn-start-scan').onclick = () => startMultiPartScan(
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
      }
    });
    generateMultiPartQR('conn-qr', 'conn-status', localDesc, selectedGame);
  } catch (e) {
    document.getElementById('conn-status').className = 'error-text';
    document.getElementById('conn-status').innerText = "エラー:\n" + e.message;
  }
};

// --- ゲスト：スキャンフロー ---
function startGuestScanFlow() {
  showScreen('connection-screen');
  document.getElementById('conn-title').innerText = "ゲスト接続準備";
  document.getElementById('conn-status').innerText = "ホストのQRを読み取ってください";
  document.getElementById('conn-qr').style.display = 'none';
  document.getElementById('btn-toggle-qr').style.display = 'none';
  document.getElementById('btn-start-scan').style.display = 'inline-block';
  document.getElementById('btn-start-scan').innerText = "ホストのQRを読む (全3枚)";

  document.getElementById('btn-start-scan').onclick = () => startMultiPartScan(
    async (scanResult) => {
      // scanResult = { type, sdp, gameType }
      const offerObj = { type: scanResult.type, sdp: scanResult.sdp };
      selectedGame = scanResult.gameType;

      const localDesc = await setupGuestConnection(offerObj, () => {
        if (selectedGame === 'othello') {
          showScreen('game-screen');
          initGame(false);
        }
      });

      // ゲスト側も自分のAnswer QRをホストに読ませるため表示
      document.getElementById('conn-title').innerText = "ホストに読ませるQR (全3枚)";
      document.getElementById('btn-start-scan').style.display = 'none';
      document.getElementById('btn-toggle-qr').style.display = 'inline-block';
      generateMultiPartQR('conn-qr', 'conn-status', localDesc, selectedGame);
    },
    () => showScreen('camera-screen'),
    () => showScreen('connection-screen')
  );
}

document.getElementById('btn-toggle-qr').onclick = () => {
  toggleQR('conn-qr', 'conn-status');
};

document.getElementById('btn-cancel-scan').onclick = () => {
  cancelScan(() => {
    if (isHost) {
      showScreen('connection-screen');
    } else {
      showScreen('menu-screen');
    }
  });
};

document.getElementById('btn-back-select').onclick = () => {
  initConnection();
  if (isHost) {
    showScreen('host-game-select-screen');
  } else {
    showScreen('menu-screen');
  }
};

document.getElementById('btn-quit-game').onclick = () => {
  initConnection();
  showScreen('menu-screen');
};

setOnMessage((data) => {
  if (selectedGame === 'othello') {
    if (isHost && data.type === "ACTION_PUT_STONE") {
      processAction(data);
    } else if (!isHost && data.type === "STATE_SYNC") {
      updateGameState(data.payload);
    }
  }
});