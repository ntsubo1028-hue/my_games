import { playSound } from './sounds.js';

const airhockeyScreen = document.getElementById('airhockey-game-screen');
const airhockeyStatusText = document.getElementById('airhockey-status-text');
const canvasAH = document.getElementById('airhockey-board');
const ctxAH = canvasAH.getContext('2d');
const btnQuitAirHockey = document.getElementById('btn-quit-airhockey');
const btnRematchAirHockey = document.getElementById('btn-rematch-airhockey');

// 描画・物理演算の定数
const AH_WIDTH = 300;
const AH_HEIGHT = 500;
const GOAL_WIDTH = 100;
const PUCK_RADIUS = 12;
const MALLET_RADIUS = 20;

// 通信頻度の調整用定数（5フレームごとに同期通信）
const SYNC_RATE = 5;

let ahState = {
  hostScore: 0,
  guestScore: 0,
  puck: { x: AH_WIDTH / 2, y: AH_HEIGHT / 2, vx: 0, vy: 0 },
  hostMallet: { x: AH_WIDTH / 2, y: AH_HEIGHT - 50 },
  guestMallet: { x: AH_WIDTH / 2, y: 50 },
  isPlaying: false
};

let ahAnimId = null;
let ahFrameCount = 0;

// main.jsから受け取る通信設定
let isHost = false;
let sendData = null; 

// 初期設定（main.jsから通信環境を渡してもらう）
export function initAirHockeySystem(hostFlag, sendFunction) {
  isHost = hostFlag;
  sendData = sendFunction;
}

// ゲーム開始処理
export function startAirHockey() {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  airhockeyScreen.classList.add('active');
  
  ahState.hostScore = 0;
  ahState.guestScore = 0;
  ahState.isPlaying = true;
  btnRematchAirHockey.style.display = 'none';
  updateAHScoreBoard();


  resetPuck(true);
  
  airhockeyStatusText.innerText = isHost ? "あなたのターン（赤）" : "あなたのターン（青）";
  
  if (ahAnimId) cancelAnimationFrame(ahAnimId);
  ahLoop();
}

// ゲーム停止（メニューに戻った時など）
export function stopAirHockey() {
  ahState.isPlaying = false;
  if (ahAnimId) {
    cancelAnimationFrame(ahAnimId);
    ahAnimId = null;
  }
}

// パックの位置と速度をリセット（placeAtHost: trueならホスト側、falseならゲスト側）
function resetPuck(placeAtHost) {
  ahState.puck.x = AH_WIDTH / 2;
  // ホスト側は下側 (AH_HEIGHT * 0.75)、ゲスト側は上側 (AH_HEIGHT * 0.25)
  ahState.puck.y = placeAtHost ? AH_HEIGHT * 0.75 : AH_HEIGHT * 0.25;
  ahState.puck.vx = 0; // 完全に停止させる
  ahState.puck.vy = 0; // 完全に停止させる
}

// 描画と物理演算のメインループ
function ahLoop() {
  if (!ahState.isPlaying) return;

  // 1. 物理演算 (ホスト側が絶対的な正解)
  if (isHost) {
    let p = ahState.puck;
    p.x += p.vx;
    p.y += p.vy;

    p.vx *= 0.99;
    p.vy *= 0.99;

    // ▼ 左右の壁バウンド（音を追加）
    if (p.x - PUCK_RADIUS < 0) { p.x = PUCK_RADIUS; p.vx *= -1; playSound('put'); }
    if (p.x + PUCK_RADIUS > AH_WIDTH) { p.x = AH_WIDTH - PUCK_RADIUS; p.vx *= -1; playSound('put'); }

    // ▼ 上下の壁バウンド（ゴール判定と、ゴール以外の壁バウンド音）
    if (p.y - PUCK_RADIUS < 0) {
      if (p.x > (AH_WIDTH - GOAL_WIDTH) / 2 && p.x < (AH_WIDTH + GOAL_WIDTH) / 2) {
        ahState.hostScore++; goalScored(true);
      } else {
        p.y = PUCK_RADIUS; p.vy *= -1; playSound('put'); // ← 上の壁バウンド音を追加
      }
    }
    if (p.y + PUCK_RADIUS > AH_HEIGHT) {
      if (p.x > (AH_WIDTH - GOAL_WIDTH) / 2 && p.x < (AH_WIDTH + GOAL_WIDTH) / 2) {
        ahState.guestScore++; goalScored(false);
      } else {
        p.y = AH_HEIGHT - PUCK_RADIUS; p.vy *= -1; playSound('put'); // ← 下の壁バウンド音を追加
      }
    }

    checkCollision(ahState.hostMallet, p);
    checkCollision(ahState.guestMallet, p);
  }

  // 2. 描画
  drawAHBoard();

  // 3. 通信 (設定したSYNC_RATEに基づく)
  ahFrameCount++;
  if (ahFrameCount % SYNC_RATE === 0 && sendData) {
    if (isHost) {
      sendData({ type: 'ah_sync_host', puck: ahState.puck, mallet: ahState.hostMallet });
    } else {
      sendData({ type: 'ah_sync_guest', mallet: ahState.guestMallet });
    }
  }

  ahAnimId = requestAnimationFrame(ahLoop);
}

// 衝突判定
function checkCollision(mallet, puck) {
  let dx = puck.x - mallet.x;
  let dy = puck.y - mallet.y;
  let distance = Math.hypot(dx, dy);
  
  if (distance < PUCK_RADIUS + MALLET_RADIUS) {
    playSound('flip'); // ← マレットで打った時の音を追加（pではなくpuckです）
    
    let angle = Math.atan2(dy, dx);
    let speed = Math.hypot(puck.vx, puck.vy);
    let newSpeed = Math.min(speed + 4, 15);
    puck.vx = Math.cos(angle) * newSpeed;
    puck.vy = Math.sin(angle) * newSpeed;
    
    puck.x = mallet.x + Math.cos(angle) * (PUCK_RADIUS + MALLET_RADIUS + 1);
    puck.y = mallet.y + Math.sin(angle) * (PUCK_RADIUS + MALLET_RADIUS + 1);
  }
}

// ゴール処理
function goalScored(isHostScored) {
  playSound('win'); // ← ゴール時の音を追加
  
  updateAHScoreBoard();
  if (sendData) {
    sendData({ type: 'ah_score', hostScore: ahState.hostScore, guestScore: ahState.guestScore, isHostScored });
  }
  
  if (ahState.hostScore >= 5 || ahState.guestScore >= 5) {
    endAirHockey(ahState.hostScore >= 5 ? 'host' : 'guest');
  } else {
    resetPuck(!isHostScored);
  }
}

function updateAHScoreBoard() {
  document.getElementById('airhockey-score-host').innerText = `ホスト(赤): ${ahState.hostScore}`;
  document.getElementById('airhockey-score-guest').innerText = `ゲスト(青): ${ahState.guestScore}`;
}

function endAirHockey(winner) {
  ahState.isPlaying = false;
  let winText = (winner === 'host' && isHost) || (winner === 'guest' && !isHost) ? "🎉 あなたの勝ち！" : "😭 あなたの負け...";
  airhockeyStatusText.innerText = `ゲーム終了 - ${winText}`;
  btnRematchAirHockey.style.display = 'block';
}

// グラフィカルにリニューアルした描画処理
function drawAHBoard() {
  // 1. 背景（引き締まったダークネイビー）
  ctxAH.fillStyle = '#0f172a';
  ctxAH.fillRect(0, 0, AH_WIDTH, AH_HEIGHT);

  // リンクの外枠
  ctxAH.strokeStyle = '#334155';
  ctxAH.lineWidth = 4;
  ctxAH.strokeRect(2, 2, AH_WIDTH - 4, AH_HEIGHT - 4);

  // 2. ゴールエリア（見やすさを改善：明るい色と枠線を追加）
  // 相手側ゴール（上）
  ctxAH.fillStyle = 'rgba(59, 130, 246, 0.4)';
  ctxAH.fillRect((AH_WIDTH - GOAL_WIDTH) / 2, 0, GOAL_WIDTH, 12);
  ctxAH.strokeStyle = '#60a5fa';
  ctxAH.lineWidth = 2;
  ctxAH.strokeRect((AH_WIDTH - GOAL_WIDTH) / 2, 0, GOAL_WIDTH, 12);

  // 自分側ゴール（下）
  ctxAH.fillStyle = 'rgba(239, 68, 68, 0.4)';
  ctxAH.fillRect((AH_WIDTH - GOAL_WIDTH) / 2, AH_HEIGHT - 12, GOAL_WIDTH, 12);
  ctxAH.strokeStyle = '#f87171';
  ctxAH.lineWidth = 2;
  ctxAH.strokeRect((AH_WIDTH - GOAL_WIDTH) / 2, AH_HEIGHT - 12, GOAL_WIDTH, 12);

  // 3. センターライン & センターサークル
  ctxAH.strokeStyle = '#1e293b';
  ctxAH.lineWidth = 3;
  ctxAH.beginPath();
  ctxAH.moveTo(0, AH_HEIGHT / 2);
  ctxAH.lineTo(AH_WIDTH, AH_HEIGHT / 2);
  ctxAH.stroke();

  ctxAH.beginPath();
  ctxAH.arc(AH_WIDTH / 2, AH_HEIGHT / 2, 45, 0, Math.PI * 2);
  ctxAH.stroke();

  // 中央のドット
  ctxAH.fillStyle = '#334155';
  ctxAH.beginPath();
  ctxAH.arc(AH_WIDTH / 2, AH_HEIGHT / 2, 6, 0, Math.PI * 2);
  ctxAH.fill();

  let drawX = (x) => (isHost ? x : AH_WIDTH - x);
  let drawY = (y) => (isHost ? y : AH_HEIGHT - y);

  // 4. パック（ツヤと立体感のあるグラデーション）
  let puckX = drawX(ahState.puck.x);
  let puckY = drawY(ahState.puck.y);

  // パックの影
  ctxAH.fillStyle = 'rgba(0, 0, 0, 0.4)';
  ctxAH.beginPath();
  ctxAH.arc(puckX, puckY + 3, PUCK_RADIUS, 0, Math.PI * 2);
  ctxAH.fill();

  // パック本体
  let puckGrad = ctxAH.createRadialGradient(puckX - 3, puckY - 3, 2, puckX, puckY, PUCK_RADIUS);
  puckGrad.addColorStop(0, '#ffffff');
  puckGrad.addColorStop(0.7, '#cbd5e1');
  puckGrad.addColorStop(1, '#64748b');
  ctxAH.fillStyle = puckGrad;
  ctxAH.beginPath();
  ctxAH.arc(puckX, puckY, PUCK_RADIUS, 0, Math.PI * 2);
  ctxAH.fill();

  // 5. ホスト側マレット（赤・立体感）
  let hostX = drawX(ahState.hostMallet.x);
  let hostY = drawY(ahState.hostMallet.y);

  ctxAH.fillStyle = 'rgba(0, 0, 0, 0.4)';
  ctxAH.beginPath();
  ctxAH.arc(hostX, hostY + 4, MALLET_RADIUS, 0, Math.PI * 2);
  ctxAH.fill();

  let hostGrad = ctxAH.createRadialGradient(hostX - 5, hostY - 5, 4, hostX, hostY, MALLET_RADIUS);
  hostGrad.addColorStop(0, '#fca5a5');
  hostGrad.addColorStop(0.6, '#ef4444');
  hostGrad.addColorStop(1, '#991b1b');
  ctxAH.fillStyle = hostGrad;
  ctxAH.beginPath();
  ctxAH.arc(hostX, hostY, MALLET_RADIUS, 0, Math.PI * 2);
  ctxAH.fill();

  // マレットの持ち手（内側のリング）
  ctxAH.strokeStyle = '#7f1d1d';
  ctxAH.lineWidth = 3;
  ctxAH.beginPath();
  ctxAH.arc(hostX, hostY, MALLET_RADIUS * 0.5, 0, Math.PI * 2);
  ctxAH.stroke();

  // 6. ゲスト側マレット（青・立体感）
  let guestX = drawX(ahState.guestMallet.x);
  let guestY = drawY(ahState.guestMallet.y);

  ctxAH.fillStyle = 'rgba(0, 0, 0, 0.4)';
  ctxAH.beginPath();
  ctxAH.arc(guestX, guestY + 4, MALLET_RADIUS, 0, Math.PI * 2);
  ctxAH.fill();

  let guestGrad = ctxAH.createRadialGradient(guestX - 5, guestY - 5, 4, guestX, guestY, MALLET_RADIUS);
  guestGrad.addColorStop(0, '#93c5fd');
  guestGrad.addColorStop(0.6, '#3b82f6');
  guestGrad.addColorStop(1, '#1e3a8a');
  ctxAH.fillStyle = guestGrad;
  ctxAH.beginPath();
  ctxAH.arc(guestX, guestY, MALLET_RADIUS, 0, Math.PI * 2);
  ctxAH.fill();

  // マレットの持ち手（内側のリング）
  ctxAH.strokeStyle = '#1e3a8a';
  ctxAH.lineWidth = 3;
  ctxAH.beginPath();
  ctxAH.arc(guestX, guestY, MALLET_RADIUS * 0.5, 0, Math.PI * 2);
  ctxAH.stroke();
}

// タッチ・マウス操作
function handleAHInput(e) {
  if (!ahState.isPlaying) return;
  e.preventDefault();
  
  let rect = canvasAH.getBoundingClientRect();
  let clientX = e.touches ? e.touches[0].clientX : e.clientX;
  let clientY = e.touches ? e.touches[0].clientY : e.clientY;
  
  let scaleX = AH_WIDTH / rect.width;
  let scaleY = AH_HEIGHT / rect.height;
  let x = (clientX - rect.left) * scaleX;
  let y = (clientY - rect.top) * scaleY;

  // ゲスト視点のタッチ座標をホスト基準（絶対座標）に変換
  if (!isHost) {
    x = AH_WIDTH - x;
    y = AH_HEIGHT - y;
  }

  x = Math.max(MALLET_RADIUS, Math.min(AH_WIDTH - MALLET_RADIUS, x));

  if (isHost) {
    // ホストは下半分（AH_HEIGHT / 2 〜 AH_HEIGHT）
    let minY = AH_HEIGHT / 2 + MALLET_RADIUS;
    let maxY = AH_HEIGHT - MALLET_RADIUS;
    y = Math.max(minY, Math.min(maxY, y));

    ahState.hostMallet.x = x;
    ahState.hostMallet.y = y;
  } else {
    // ゲストは上半分（0 〜 AH_HEIGHT / 2）
    let minY = MALLET_RADIUS;
    let maxY = AH_HEIGHT / 2 - MALLET_RADIUS;
    y = Math.max(minY, Math.min(maxY, y));

    // ホスト基準の座標をそのまま格納（二重反転を解消）
    ahState.guestMallet.x = x;
    ahState.guestMallet.y = y; 
  }
}

canvasAH.addEventListener('touchmove', handleAHInput, { passive: false });
canvasAH.addEventListener('mousemove', handleAHInput);

// 通信データ受信時の処理（main.jsから呼ばれる）
export function processAirHockeyData(data) {
  switch (data.type) {
    case 'ah_sync_host':
      if (!isHost) {
        ahState.puck = data.puck;
        ahState.hostMallet = data.mallet;
      }
      break;
    case 'ah_sync_guest':
      if (isHost) {
        ahState.guestMallet = data.mallet;
      }
      break;
    case 'ah_score':
      playSound('win'); // ← ★ゲスト側にもゴール音が鳴るように追加しました
      ahState.hostScore = data.hostScore;
      ahState.guestScore = data.guestScore;
      updateAHScoreBoard();
      if (ahState.hostScore >= 5 || ahState.guestScore >= 5) {
        endAirHockey(ahState.hostScore >= 5 ? 'host' : 'guest');
      } else {
        resetPuck(!data.isHostScored);
      }
      break;
  }
}