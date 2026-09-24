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

import { initGame, processAction, updateGameState, syncStateToGuest, requestRematch } from './othello.js';
import { initDotsGame, processDotsAction, updateDotsGameState, syncDotsStateToGuest, requestRematchDots } from './dots_and_boxes.js';
import { initTetris, stopTetris, moveTetris, dropTetris, rotateTetris, hardDropTetris } from './tetris.js';
import { initGame as initConcentrationGame, processAction as processConcentrationAction, updateGameState as updateConcentrationGameState, syncStateToGuest as syncConcentrationStateToGuest, requestRematch as requestConcentrationRematch, handleScreenTap as handleConcentrationScreenTap } from './concentration.js';
import { initSoloGame, initPvPGame, toggleInputMode, endTurn, processAction as processMineAction, updateGameState as updateMineGameState, syncStateToGuest as syncMineStateToGuest, requestRematch as requestMineRematch } from './minesweeper.js';

function encodeSdp(obj) {
  return LZString.compressToBase64(JSON.stringify(obj));
}
function decodeSdp(str) {
  return JSON.parse(LZString.decompressFromBase64(str));
}

let isHost = false;
let selectedGame = 'othello'; 
let localConnectionDataStr = ""; 

// --- 画面切り替え ---
function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
  document.getElementById(screenId).classList.add('active');
}

// --- メインメニューのボタン制御 ---
document.getElementById('btn-goto-host-select').onclick = () => { showScreen('host-game-select-screen'); };
document.getElementById('btn-back-main').onclick = () => { initConnection(); showScreen('menu-screen'); };
document.getElementById('btn-guest').onclick = () => { isHost = false; startGuestScanFlow(); };
document.getElementById('btn-play-solo-mine').onclick = () => { showScreen('minesweeper-game-screen'); initSoloGame(); };

// --- ホスト：ゲーム選択 ---
document.getElementById('btn-select-othello').onclick = () => { selectGameFlow('othello'); };
document.getElementById('btn-select-dots').onclick = () => { selectGameFlow('dots'); };
document.getElementById('btn-select-concentration').onclick = () => { selectGameFlow('concentration'); };
document.getElementById('btn-select-minesweeper').onclick = () => { selectGameFlow('minesweeper'); };

function selectGameFlow(game) {
  selectedGame = game;
  if (isConnectionEstablished()) {
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
}

// --- ホスト：接続確立フロー ---
async function startHostConnectionFlow() {
  showScreen('connection-screen');
  document.getElementById('conn-title').innerText = "ホスト接続情報";
  document.getElementById('conn-status').innerText = "接続情報を収集中...";
  document.getElementById('qr-container').style.display = 'none';
  
  const btnScan = document.getElementById('btn-start-scan');
  btnScan.style.display = 'inline-block';
  btnScan.innerText = "ゲストのQRを読む";

  const textSection = document.getElementById('text-signaling-section');
  const btnCopy = document.getElementById('btn-copy-sdp');
  const inputArea = document.getElementById('text-input-area');
  const textInput = document.getElementById('text-sdp-input');
  const btnSubmit = document.getElementById('btn-submit-sdp');
  
  if (textSection) textSection.style.display = 'block';
  btnCopy.style.display = 'none';
  inputArea.style.display = 'block';
  textInput.value = '';
  textInput.placeholder = "ゲストからの返信テキストをペースト";

  btnSubmit.onclick = async () => {
    try {
      const pasted = textInput.value.trim();
      if (!pasted) return;
      const answerObj = decodeSdp(pasted);
      await handleGuestAnswer(answerObj);
      document.getElementById('conn-status').innerText = "接続完了！";
      inputArea.style.display = 'none';
    } catch (e) {
      alert("無効なテキストです。正しくコピーできているか確認してください。");
    }
  };

  btnScan.onclick = () => startMultiPartScan(
    async (answerObj) => { await handleGuestAnswer(answerObj); },
    () => showScreen('camera-screen'),
    () => showScreen('connection-screen')
  );

  try {
    const localDesc = await setupHostConnection(() => showGameScreenForHost(selectedGame));
    
    document.getElementById('conn-status').innerText = "接続情報を生成しました";
    document.getElementById('qr-container').style.display = 'flex';
    generateMultiPartQR('conn-status', localDesc, selectedGame);

    localConnectionDataStr = encodeSdp({ type: localDesc.type, sdp: localDesc.sdp, gameType: selectedGame });
    btnCopy.style.display = 'inline-block';
    btnCopy.innerText = "📋 自分の接続情報をコピー";
    btnCopy.onclick = () => {
      navigator.clipboard.writeText(localConnectionDataStr).then(() => {
        alert("接続情報をコピーしました！\nLINE等でゲストに送ってください。");
      });
    };

  } catch (e) {
    document.getElementById('conn-status').className = 'error-text';
    document.getElementById('conn-status').innerText = "エラー:\n" + e.message;
  }
}

// --- ゲスト：スキャンフロー ---
function startGuestScanFlow() {
  showScreen('connection-screen');
  document.getElementById('conn-title').innerText = "ゲスト接続準備";
  document.getElementById('conn-status').innerText = "ホストの情報を入力するか、QRを読んでください";
  document.getElementById('qr-container').style.display = 'none';
  
  const btnScan = document.getElementById('btn-start-scan');
  btnScan.style.display = 'inline-block';
  btnScan.innerText = "ホストのQRを読む";

  const textSection = document.getElementById('text-signaling-section');
  const btnCopy = document.getElementById('btn-copy-sdp');
  const inputArea = document.getElementById('text-input-area');
  const textInput = document.getElementById('text-sdp-input');
  const btnSubmit = document.getElementById('btn-submit-sdp');

  if (textSection) textSection.style.display = 'block';
  btnCopy.style.display = 'none';
  inputArea.style.display = 'block';
  textInput.value = '';
  textInput.placeholder = "ホストから送られたテキストをペースト";

  const processHostOffer = async (scanResult) => {
    const offerObj = { type: scanResult.type, sdp: scanResult.sdp };
    selectedGame = scanResult.gameType;
    document.getElementById('conn-status').innerText = "ホストへの返信を生成中...";

    const localDesc = await setupGuestConnection(offerObj, () => {
      if (selectedGame === 'othello') { showScreen('game-screen'); initGame(false); }
      else if (selectedGame === 'dots') { showScreen('dots-game-screen'); initDotsGame(false); }
      else if (selectedGame === 'concentration') { showScreen('concentration-game-screen'); initConcentrationGame(false); }
      else if (selectedGame === 'minesweeper') { showScreen('minesweeper-game-screen'); initPvPGame(false); }
    });

    document.getElementById('conn-title').innerText = "ホストに情報を送る";
    btnScan.style.display = 'none';
    inputArea.style.display = 'none'; 
    document.getElementById('qr-container').style.display = 'flex';
    generateMultiPartQR('conn-status', localDesc, selectedGame);

    localConnectionDataStr = encodeSdp({ type: localDesc.type, sdp: localDesc.sdp, gameType: selectedGame });
    btnCopy.style.display = 'inline-block';
    btnCopy.innerText = "📋 ホストへの返信情報をコピー";
    btnCopy.onclick = () => {
      navigator.clipboard.writeText(localConnectionDataStr).then(() => {
        alert("返信情報をコピーしました！\nホストに送って接続を完了させてください。");
      });
    };
  };

  btnSubmit.onclick = async () => {
    try {
      const pasted = textInput.value.trim();
      if (!pasted) return;
      const scanResult = decodeSdp(pasted);
      await processHostOffer(scanResult);
    } catch (e) {
      alert("無効なテキストです。正しくコピーできているか確認してください。");
    }
  };

  btnScan.onclick = () => startMultiPartScan(
    async (scanResult) => { await processHostOffer(scanResult); },
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
    const textSection = document.getElementById('text-signaling-section');
    if (textSection) textSection.style.display = 'none'; 
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
    if (selectedGame === 'othello') { showScreen('game-screen'); initGame(false); }
    else if (selectedGame === 'dots') { showScreen('dots-game-screen'); initDotsGame(false); }
    else if (selectedGame === 'concentration') { showScreen('concentration-game-screen'); initConcentrationGame(false); }
    else if (selectedGame === 'minesweeper') { showScreen('minesweeper-game-screen'); initPvPGame(false); }
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
  }
});

// --- テトリス・一人用などの処理 ---
document.getElementById('btn-play-tetris').onclick = () => { showScreen('tetris-game-screen'); initTetris(); };
document.getElementById('btn-quit-tetris').onclick = () => { stopTetris(); showScreen('menu-screen'); };
document.getElementById('btn-rematch-tetris').onclick = () => initTetris();
document.getElementById('btn-tetris-left').onclick = () => moveTetris(-1);
document.getElementById('btn-tetris-right').onclick = () => moveTetris(1);
document.getElementById('btn-tetris-down').onclick = () => dropTetris();
document.getElementById('btn-tetris-up').onclick = () => rotateTetris();
document.getElementById('btn-tetris-drop').onclick = () => hardDropTetris();
document.getElementById('concentration-game-screen').onclick = () => { if (selectedGame === 'concentration') handleConcentrationScreenTap(); };

document.getElementById('btn-mine-mode').onclick = () => toggleInputMode();
document.getElementById('btn-mine-end-turn').onclick = () => endTurn();
document.getElementById('btn-quit-mine').onclick = () => {
  if (isConnectionEstablished()) handleQuitGame(); 
  else showScreen('menu-screen');
};
document.getElementById('btn-rematch-mine').onclick = () => requestMineRematch();