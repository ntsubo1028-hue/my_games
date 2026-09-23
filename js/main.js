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

import { 
  initDotsGame, 
  processDotsAction, 
  updateDotsGameState, 
  syncDotsStateToGuest 
} from './dots_and_boxes.js';

let isHost = false;
let selectedGame = 'othello'; // 初期値（ホスト選択時やゲストQR読み取り時に上書きされます）

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
  showScreen('menu-screen');
};

// ゲストはゲームを選ばず直接QRスキャンへ
document.getElementById('btn-guest').onclick = () => {
  isHost = false;
  startGuestScanFlow();
};

// --- ホスト：ゲーム選択 ---
document.getElementById('btn-select-othello').onclick = () => {
  isHost = true;
  selectedGame = 'othello';
  startHostConnectionFlow();
};

document.getElementById('btn-select-dots').onclick = () => {
  isHost = true;
  selectedGame = 'dots';
  startHostConnectionFlow();
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
      // 通信が開通したときの処理（選んだゲームによって起動先を分岐）
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
    // QRコードに選んだゲームのID(selectedGame)を混ぜて生成する
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
      // scanResult に含まれるゲームIDを上書き設定
      const offerObj = { type: scanResult.type, sdp: scanResult.sdp };
      selectedGame = scanResult.gameType;

      const localDesc = await setupGuestConnection(offerObj, () => {
        // 通信が開通したときの処理（ホストのQR情報から自動判別して起動）
        if (selectedGame === 'othello') {
          showScreen('game-screen');
          initGame(false);
        } else if (selectedGame === 'dots') {
          showScreen('dots-game-screen');
          initDotsGame(false);
        }
      });

      // ゲストのAnswerQRを表示
      document.getElementById('conn-title').innerText = "ホストに読ませるQR (全3枚)";
      btnScan.style.display = 'none';
      document.getElementById('btn-toggle-qr').style.display = 'inline-block';
      generateMultiPartQR('conn-qr', 'conn-status', localDesc, selectedGame);
    },
    () => showScreen('camera-screen'),
    () => showScreen('connection-screen')
  );
}

// --- その他のUIボタン処理 ---
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

// ゲーム終了ボタン（オセロ用）
document.getElementById('btn-quit-game').onclick = () => {
  initConnection();
  showScreen('menu-screen');
};

// ゲーム終了ボタン（ドット＆ボックス用）
document.getElementById('btn-quit-dots').onclick = () => {
  initConnection();
  showScreen('menu-screen');
};

// --- 通信メッセージの受信処理（ルーティング） ---
setOnMessage((data) => {
  if (selectedGame === 'othello') {
    if (isHost && data.type === "ACTION_PUT_STONE") {
      processAction(data);
    } else if (!isHost && data.type === "STATE_SYNC") {
      updateGameState(data.payload);
    }
  } else if (selectedGame === 'dots') {
    if (data.type === "ACTION_DRAW_LINE") {
      processDotsAction(data);
    } else if (!isHost && data.type === "STATE_SYNC_DOTS") {
      updateDotsGameState(data.payload);
    }
  }
});