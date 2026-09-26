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

// 通信頻度の調整用定数（3フレームごとに同期通信）
const SYNC_RATE = 3;

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

// 通信量トラッキング用変数
let totalBytesSent = 0;
let totalBytesReceived = 0;
let trafficBadge = null;

// main.jsから受け取る通信設定
let isHost = false;
let sendData = null; 

// 数値を小数点第一位に丸めてデータ量を削減するヘルパー
const round1 = (val) => Math.round(val * 10) / 10;

// 最適化されたデータ送信ラッパー（通信量を自動計測）
function sendOptimizedData(data) {
  if (!sendData) return;
  const jsonStr = JSON.stringify(data);
  totalBytesSent += new TextEncoder().encode(jsonStr).length;
  sendData(data);
}

// 通信量表示用の控えめなバッジを画面の右上隅に作成・更新
function updateTrafficBadge() {
  if (!trafficBadge) {
    trafficBadge = document.getElementById('airhockey-traffic-badge');
    if (!trafficBadge) {
      trafficBadge = document.createElement('div');
      trafficBadge.id = 'airhockey-traffic-badge';
      trafficBadge.style.position = 'absolute';
      trafficBadge.style.top = '10px';
      trafficBadge.style.right = '10px';
      trafficBadge.style.fontSize = '11px';
      trafficBadge.style.color = '#64748b';
      trafficBadge.style.background = 'rgba(15, 23, 42, 0.75)';
      trafficBadge.style.padding = '3px 8px';
      trafficBadge.style.borderRadius = '4px';
      trafficBadge.style.pointerEvents = 'none';
      trafficBadge.style.zIndex = '10';
      
      airhockeyScreen.style.position = 'relative';
      airhockeyScreen.appendChild(trafficBadge);
    }
  }
  let trafficKB = ((totalBytesSent + totalBytesReceived) / 1024).toFixed(2);
  trafficBadge.innerText = `通信量: ${trafficKB} KB`;
}

// 初期設定
export function initAirHockeySystem(hostFlag, sendFunction) {
  isHost = hostFlag;
  sendData = sendFunction;
  totalBytesSent = 0;
  totalBytesReceived = 0;
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
  totalBytesSent = 0;
  totalBytesReceived = 0;
  
  airhockeyStatusText.innerText = isHost ? "あなたのターン（赤）" : "あなたのターン（青）";
  updateTrafficBadge();
  
  if (ahAnimId) cancelAnimationFrame(ahAnimId);
  ahLoop();
}

// ゲーム停止
export function stopAirHockey() {
  ahState.isPlaying = false;
  if (ahAnimId) {
    cancelAnimationFrame(ahAnimId);
    ahAnimId = null;
  }
  if (trafficBadge) {
    trafficBadge.remove();
    trafficBadge = null;
  }
}

// パックの位置と速度をリセット（placeAtHost: trueならホスト側、falseならゲスト側）
function resetPuck(placeAtHost) {
  ahState.puck.x = AH_WIDTH / 2;
  // ホスト側は下側 (AH_HEIGHT * 0.75)、ゲスト側は上側 (AH_HEIGHT * 0.25)
  ahState.puck.y = placeAtHost ? AH_HEIGHT * 0.75 : AH_HEIGHT * 0.25;
  ahState.puck.vx = 0;
  ahState.puck.vy = 0;
}

// 描画と物理演算のメインループ
function ahLoop() {
  if (!ahState.isPlaying) return;

  // 1. 物理演算 (ホスト側)
  if (isHost) {
    let p = ahState.puck;
    p.x += p.vx;
    p.y += p.vy;

    p.vx *= 0.99;
    p.vy *= 0.99;

    if (p.x - PUCK_RADIUS < 0) { p.x = PUCK_RADIUS; p.vx *= -1; playSound('put'); }
    if (p.x + PUCK_RADIUS > AH_WIDTH) { p.x = AH_WIDTH - PUCK_RADIUS; p.vx *= -1; playSound('put'); }

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

  // 3. 通信 (短縮オブジェクト形式で送信)
  ahFrameCount++;
  if (ahFrameCount % SYNC_RATE === 0 && sendData) {
    if (isHost) {
      sendOptimizedData({
        t: 'ah_sync_host',
        p: [round1(ahState.puck.x), round1(ahState.puck.y), round1(ahState.puck.vx), round1(ahState.puck.vy)],
        m: [round1(ahState.hostMallet.x), round1(ahState.hostMallet.y)]
      });
    } else {
      sendOptimizedData({
        t: 'ah_sync_guest',
        m: [round1(ahState.guestMallet.x), round1(ahState.guestMallet.y)]
      });
    }
    updateTrafficBadge();
  }

  ahAnimId = requestAnimationFrame(ahLoop);
}

// 衝突判定
function checkCollision(mallet, puck) {
  let dx = puck.x - mallet.x;
  let dy = puck.y - mallet.y;
  let distance = Math.hypot(dx, dy);
  
  if (distance < PUCK_RADIUS + MALLET_RADIUS) {
    playSound('flip');
    
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
  playSound('win');
  updateAHScoreBoard();
  
  sendOptimizedData({
    t: 'ah_score',
    hs: ahState.hostScore,
    gs: ahState.guestScore,
    win: isHostScored ? 1 : 0
  });
  
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
  updateTrafficBadge();
}

// 描画処理
function drawAHBoard() {
  ctxAH.fillStyle = '#0f172a';
  ctxAH.fillRect(0, 0, AH_WIDTH, AH_HEIGHT);

  ctxAH.strokeStyle = '#334155';
  ctxAH.lineWidth = 4;
  ctxAH.strokeRect(2, 2, AH_WIDTH - 4, AH_HEIGHT - 4);

  // ゴールエリア（上）
  ctxAH.fillStyle = 'rgba(59, 130, 246, 0.4)';
  ctxAH.fillRect((AH_WIDTH - GOAL_WIDTH) / 2, 0, GOAL_WIDTH, 12);
  ctxAH.strokeStyle = '#60a5fa';
  ctxAH.lineWidth = 2;
  ctxAH.strokeRect((AH_WIDTH - GOAL_WIDTH) / 2, 0, GOAL_WIDTH, 12);

  // ゴールエリア（下）
  ctxAH.fillStyle = 'rgba(239, 68, 68, 0.4)';
  ctxAH.fillRect((AH_WIDTH - GOAL_WIDTH) / 2, AH_HEIGHT - 12, GOAL_WIDTH, 12);
  ctxAH.strokeStyle = '#f87171';
  ctxAH.lineWidth = 2;
  ctxAH.strokeRect((AH_WIDTH - GOAL_WIDTH) / 2, AH_HEIGHT - 12, GOAL_WIDTH, 12);

  // センターライン & サークル
  ctxAH.strokeStyle = '#1e293b';
  ctxAH.lineWidth = 3;
  ctxAH.beginPath();
  ctxAH.moveTo(0, AH_HEIGHT / 2);
  ctxAH.lineTo(AH_WIDTH, AH_HEIGHT / 2);
  ctxAH.stroke();

  ctxAH.beginPath();
  ctxAH.arc(AH_WIDTH / 2, AH_HEIGHT / 2, 45, 0, Math.PI * 2);
  ctxAH.stroke();

  ctxAH.fillStyle = '#334155';
  ctxAH.beginPath();
  ctxAH.arc(AH_WIDTH / 2, AH_HEIGHT / 2, 6, 0, Math.PI * 2);
  ctxAH.fill();

  let drawX = (x) => (isHost ? x : AH_WIDTH - x);
  let drawY = (y) => (isHost ? y : AH_HEIGHT - y);

  // パック
  let puckX = drawX(ahState.puck.x);
  let puckY = drawY(ahState.puck.y);

  ctxAH.fillStyle = 'rgba(0, 0, 0, 0.4)';
  ctxAH.beginPath();
  ctxAH.arc(puckX, puckY + 3, PUCK_RADIUS, 0, Math.PI * 2);
  ctxAH.fill();

  let puckGrad = ctxAH.createRadialGradient(puckX - 3, puckY - 3, 2, puckX, puckY, PUCK_RADIUS);
  puckGrad.addColorStop(0, '#ffffff');
  puckGrad.addColorStop(0.7, '#cbd5e1');
  puckGrad.addColorStop(1, '#64748b');
  ctxAH.fillStyle = puckGrad;
  ctxAH.beginPath();
  ctxAH.arc(puckX, puckY, PUCK_RADIUS, 0, Math.PI * 2);
  ctxAH.fill();

  // ホスト側マレット（赤）
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

  ctxAH.strokeStyle = '#7f1d1d';
  ctxAH.lineWidth = 3;
  ctxAH.beginPath();
  ctxAH.arc(hostX, hostY, MALLET_RADIUS * 0.5, 0, Math.PI * 2);
  ctxAH.stroke();

  // ゲスト側マレット（青）
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

  if (!isHost) {
    x = AH_WIDTH - x;
    y = AH_HEIGHT - y;
  }

  x = Math.max(MALLET_RADIUS, Math.min(AH_WIDTH - MALLET_RADIUS, x));

  if (isHost) {
    let minY = AH_HEIGHT / 2 + MALLET_RADIUS;
    let maxY = AH_HEIGHT - MALLET_RADIUS;
    y = Math.max(minY, Math.min(maxY, y));

    ahState.hostMallet.x = x;
    ahState.hostMallet.y = y;
  } else {
    let minY = MALLET_RADIUS;
    let maxY = AH_HEIGHT / 2 - MALLET_RADIUS;
    y = Math.max(minY, Math.min(maxY, y));

    ahState.guestMallet.x = x;
    ahState.guestMallet.y = y; 
  }
}

canvasAH.addEventListener('touchmove', handleAHInput, { passive: false });
canvasAH.addEventListener('mousemove', handleAHInput);

// 通信データ受信時の処理（短縮オブジェクト形式に対応）
export function processAirHockeyData(data) {
  if (!data) return;
  
  const jsonStr = JSON.stringify(data);
  totalBytesReceived += new TextEncoder().encode(jsonStr).length;

  if (typeof data === 'object' && data !== null) {
    const type = data.t;
    if (type === 'ah_sync_host' && !isHost) {
      ahState.puck = { x: data.p[0], y: data.p[1], vx: data.p[2], vy: data.p[3] };
      ahState.hostMallet = { x: data.m[0], y: data.m[1] };
    } else if (type === 'ah_sync_guest' && isHost) {
      ahState.guestMallet = { x: data.m[0], y: data.m[1] };
    } else if (type === 'ah_score') {
      playSound('win');
      ahState.hostScore = data.hs;
      ahState.guestScore = data.gs;
      updateAHScoreBoard();
      if (ahState.hostScore >= 5 || ahState.guestScore >= 5) {
        endAirHockey(ahState.hostScore >= 5 ? 'host' : 'guest');
      } else {
        resetPuck(data.win !== 1);
      }
    }
  }
  updateTrafficBadge();
}