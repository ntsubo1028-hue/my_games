import { sendData } from './connection.js';
import { playSound } from './sound.js'; // 音声モジュールをインポート

let isHostPlayer = false;
let isMyTurn = false;
let lines = [];
let boxes = [];
let hostScore = 0;
let guestScore = 0;
let gameOver = false;

// UI elements
const turnText = document.getElementById('dots-turn-text');
const scoreHost = document.getElementById('dots-score-host');
const scoreGuest = document.getElementById('dots-score-guest');
const board = document.getElementById('dots-board-container');
const btnRematch = document.getElementById('btn-rematch-dots'); // 再戦ボタン

export function initDotsGame(isHost) {
  isHostPlayer = isHost;
  isMyTurn = isHost; // ホスト先手
  lines = new Array(24).fill(null); // 横線12本、縦線12本
  boxes = new Array(9).fill(null);  // 3x3ボックス
  hostScore = 0;
  guestScore = 0;
  gameOver = false;
  
  btnRematch.style.display = 'none'; // 開始時は再戦ボタンを隠す
  
  renderBoard();
  updateUI();
}

function renderBoard() {
  board.innerHTML = '';
  // 7x7 グリッドを生成
  for(let r = 0; r < 7; r++) {
    for(let c = 0; c < 7; c++) {
      const cell = document.createElement('div');
      
      if(r % 2 === 0 && c % 2 === 0) {
        // ドット (0,0), (0,2)...
        cell.className = 'dot';
      } else if (r % 2 === 0 && c % 2 !== 0) {
        // 横の線
        const lineR = r / 2; // 0~3
        const lineC = Math.floor(c / 2); // 0~2
        const index = lineR * 3 + lineC;
        cell.className = 'line-h';
        cell.dataset.index = index;
        cell.onclick = () => handleLineClick(index);
      } else if (r % 2 !== 0 && c % 2 === 0) {
        // 縦の線
        const lineR = Math.floor(r / 2); // 0~2
        const lineC = c / 2; // 0~3
        const index = 12 + lineR * 4 + lineC;
        cell.className = 'line-v';
        cell.dataset.index = index;
        cell.onclick = () => handleLineClick(index);
      } else {
        // ボックス (中身の陣地)
        const boxR = Math.floor(r / 2);
        const boxC = Math.floor(c / 2);
        const index = boxR * 3 + boxC;
        cell.className = 'box';
        cell.id = 'box-' + index;
      }
      board.appendChild(cell);
    }
  }
}

function updateUI() {
  scoreHost.innerText = `ホスト(赤): ${hostScore}`;
  scoreGuest.innerText = `ゲスト(青): ${guestScore}`;
  
  if (gameOver) {
    btnRematch.style.display = 'inline-block'; // ゲーム終了で再戦ボタン表示
    if (hostScore > guestScore) turnText.innerText = "🏆 ホストの勝ち！";
    else if (guestScore > hostScore) turnText.innerText = "🏆 ゲストの勝ち！";
    else turnText.innerText = "🤝 引き分け！";
  } else {
    turnText.innerText = isMyTurn ? "🟢 あなたのターン" : "🔴 相手のターン";
  }

  // 線の描画
  lines.forEach((val, idx) => {
    const el = document.querySelector(`[data-index="${idx}"]`);
    if(el) {
      el.classList.remove('active-host', 'active-guest');
      if (val === 'host') el.classList.add('active-host');
      if (val === 'guest') el.classList.add('active-guest');
    }
  });

  // ボックス(陣地)の描画
  boxes.forEach((val, idx) => {
    const el = document.getElementById('box-' + idx);
    if(el) {
      el.classList.remove('host', 'guest');
      if (val === 'host') el.classList.add('host');
      if (val === 'guest') el.classList.add('guest');
    }
  });
}

function handleLineClick(index) {
  if (!isMyTurn || gameOver || lines[index] !== null) return;
  
  const moveData = {
    type: "ACTION_DRAW_LINE",
    payload: { index: index, player: isHostPlayer ? 'host' : 'guest' }
  };
  
  applyMove(moveData.payload);
  sendData(moveData); // 相手に自分の操作を送信
}

// 相手から操作データを受け取った時に実行される
export function processDotsAction(data) {
  if(data.type === "ACTION_DRAW_LINE") applyMove(data.payload);
}

// 線を引くコア処理（音もここで鳴らします）
function applyMove({index, player}) {
  lines[index] = player;
  playSound('line'); // 線を引いた音
  
  let scored = false;
  // 9つのボックスすべてについて「4辺が囲まれたか」をチェック
  for(let r = 0; r < 3; r++){
    for(let c = 0; c < 3; c++){
      const bIdx = r * 3 + c;
      if (boxes[bIdx] === null) {
        const top = r * 3 + c;
        const bottom = (r + 1) * 3 + c;
        const left = 12 + r * 4 + c;
        const right = 12 + r * 4 + (c + 1);
        
        if (lines[top] !== null && lines[bottom] !== null && lines[left] !== null && lines[right] !== null) {
          boxes[bIdx] = player;
          if (player === 'host') hostScore++;
          else guestScore++;
          scored = true; // ボックスを獲得！
        }
      }
    }
  }

  // ボックスを獲得した場合の音
  if (scored) {
    playSound('box'); 
  }

  // 終了判定
  if (boxes.every(b => b !== null)) {
    if (!gameOver) {
      gameOver = true;
      playSound('win'); // 勝敗決定のファンファーレ
    }
  } else {
    // 陣地が取れなかった場合のみ、相手にターンを譲る (取れたら連続ターン)
    if (!scored) {
      isMyTurn = (player === (isHostPlayer ? 'host' : 'guest')) ? false : true;
    } else {
      isMyTurn = (player === (isHostPlayer ? 'host' : 'guest')) ? true : false;
    }
  }
  
  updateUI();
  
  // ホストなら念のため最新状態全体をゲストに同期
  if (isHostPlayer) syncDotsStateToGuest();
}

export function syncDotsStateToGuest() {
  if (isHostPlayer) {
    sendData({
      type: "STATE_SYNC_DOTS",
      payload: {
        lines, boxes, hostScore, guestScore,
        turn: isMyTurn ? 'host' : 'guest',
        gameOver
      }
    });
  }
}

export function updateDotsGameState(payload) {
  if (!isHostPlayer) {
    lines = payload.lines;
    boxes = payload.boxes;
    hostScore = payload.hostScore;
    guestScore = payload.guestScore;
    gameOver = payload.gameOver;
    isMyTurn = payload.turn === 'guest';
    
    // 再戦でリセットされた時用
    if (!gameOver) {
      btnRematch.style.display = 'none';
    }

    updateUI();
  }
}

// --- 再戦リクエストの処理 ---
export function requestRematchDots() {
  if (isHostPlayer) {
    // ホストが押した場合は即初期化して同期
    initDotsGame(true);
    syncDotsStateToGuest();
  } else {
    // ゲストが押した場合はホストに依頼を送る
    sendData({ type: "ACTION_REMATCH_DOTS" });
  }
}