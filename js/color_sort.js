// js/color_sort.js
import { playSound } from './sounds.js';

let colorSortScreen = null;
let statusText = null;
let canvasCS = null;
let ctxCS = null;
let btnQuit = null;
let btnRematch = null;
let btnStart = null;
let startOverlay = null;
let guestSettings = null;
let syncRateSelect = null;

let isDOMInitialized = false;

const CS_WIDTH = 300;
const CS_HEIGHT = 500;
const OHAJIKI_RADIUS = 13;
const TOTAL_OHAJIKI_COUNT = 20;

let currentSyncRate = 3;

let isTouching = false;
let grabbedOhajiki = null;
let lastDragX = 0;
let lastDragY = 0;
let dragVelX = 0;
let dragVelY = 0;

let hostReady = false;
let guestReady = false;

let csState = {
  isPlaying: false,
  isEnding: false,
  isTallying: false,
  endTextScale: 0.1,
  showEndText: false,
  ohajikis: [], 
  tallyList: [],
  tallyIndex: 0,
  hostScore: 0,
  guestScore: 0,
  hostDisplayScore: 0,
  guestDisplayScore: 0,
  winnerText: ''
};

let csAnimId = null;
let csFrameCount = 0;

let isHost = false;
let sendData = null;

let totalBytesSent = 0;
let totalBytesReceived = 0;
let trafficBadge = null;

function ensureDOM() {
  if (isDOMInitialized && ctxCS) return true;

  colorSortScreen = document.getElementById('colorsort-game-screen');
  statusText = document.getElementById('colorsort-status-text');
  canvasCS = document.getElementById('colorsort-board');
  btnQuit = document.getElementById('btn-quit-colorsort');
  btnRematch = document.getElementById('btn-rematch-colorsort');
  btnStart = document.getElementById('btn-start-colorsort');
  startOverlay = document.getElementById('cs-start-overlay');
  guestSettings = document.getElementById('cs-guest-settings');
  syncRateSelect = document.getElementById('cs-sync-rate-select');

  if (!canvasCS) return false;

  ctxCS = canvasCS.getContext('2d');
  setupEventListeners();
  isDOMInitialized = true;
  return true;
}

function setupEventListeners() {
  if (syncRateSelect) {
    syncRateSelect.addEventListener('change', (e) => {
      if (!isHost) {
        currentSyncRate = parseInt(e.target.value, 10);
        if (sendData) {
          sendDataWrapper({ type: 'cs_config', rate: currentSyncRate });
        }
      }
    });
  }

  if (btnStart) {
    btnStart.onclick = () => {
      if (startOverlay) startOverlay.style.display = 'none';

      if (isHost) {
        hostReady = true;
        if (statusText) statusText.innerText = guestReady ? "まもなくスタート..." : "相手の準備を待っています...";
        
        sendDataWrapper({ 
          type: 'cs_start', 
          initOhajikis: csState.ohajikis 
        });
        checkBothReady();
      } else {
        guestReady = true;
        if (statusText) statusText.innerText = "ホストの開始を待っています...";
        sendDataWrapper({ type: 'cs_ready', side: 'guest' });
      }
    };
  }

  if (canvasCS) {
    const getCanvasCoords = (clientX, clientY) => {
      let rect = canvasCS.getBoundingClientRect();
      let x = (clientX - rect.left) * (CS_WIDTH / rect.width);
      let y = (clientY - rect.top) * (CS_HEIGHT / rect.height);
      if (!isHost) {
        x = CS_WIDTH - x;
        y = CS_HEIGHT - y;
      }
      return { x, y };
    };

    const handleTouchStart = (clientX, clientY) => {
      if (!csState.isPlaying || csState.isEnding || csState.isTallying) return;
      let pos = getCanvasCoords(clientX, clientY);
      
      let target = null;
      let minDst = 999;
      csState.ohajikis.forEach(o => {
        if (o.status !== 'field') return;
        let dst = Math.hypot(o.x - pos.x, o.y - pos.y);
        if (dst < OHAJIKI_RADIUS * 2.5 && dst < minDst) {
          minDst = dst;
          target = o;
        }
      });

      if (target) {
        grabbedOhajiki = target;
        lastDragX = pos.x;
        lastDragY = pos.y;
        dragVelX = 0;
        dragVelY = 0;
        isTouching = true;
      }
    };

    const handleTouchMove = (clientX, clientY) => {
      if (!csState.isPlaying || csState.isEnding || csState.isTallying || !isTouching || !grabbedOhajiki) return;
      let pos = getCanvasCoords(clientX, clientY);

      let dx = pos.x - lastDragX;
      let dy = pos.y - lastDragY;

      dragVelX = dx;
      dragVelY = dy;

      grabbedOhajiki.x = pos.x;
      grabbedOhajiki.y = pos.y;
      grabbedOhajiki.vx = 0;
      grabbedOhajiki.vy = 0;

      lastDragX = pos.x;
      lastDragY = pos.y;
    };

    const handleTouchEnd = () => {
      if (grabbedOhajiki) {
        // ② エアホッケーと同等のしっかりした慣性・飛距離を持たせる
        grabbedOhajiki.vx = dragVelX * 0.7;
        grabbedOhajiki.vy = dragVelY * 0.7;

        let spd = Math.hypot(grabbedOhajiki.vx, grabbedOhajiki.vy);
        if (spd > 16) {
          grabbedOhajiki.vx = (grabbedOhajiki.vx / spd) * 16;
          grabbedOhajiki.vy = (grabbedOhajiki.vy / spd) * 16;
        }
      }
      isTouching = false;
      grabbedOhajiki = null;
    };

    canvasCS.addEventListener('touchstart', (e) => {
      e.preventDefault();
      let touch = e.touches[0];
      handleTouchStart(touch.clientX, touch.clientY);
    }, { passive: false });

    canvasCS.addEventListener('touchmove', (e) => {
      e.preventDefault();
      let touch = e.touches[0];
      handleTouchMove(touch.clientX, touch.clientY);
    }, { passive: false });

    canvasCS.addEventListener('touchend', handleTouchEnd);
    canvasCS.addEventListener('touchcancel', handleTouchEnd);

    canvasCS.addEventListener('mousedown', (e) => { handleTouchStart(e.clientX, e.clientY); });
    canvasCS.addEventListener('mousemove', (e) => { handleTouchMove(e.clientX, e.clientY); });
    canvasCS.addEventListener('mouseup', handleTouchEnd);
  }
}

const r = (val) => Math.round(val * 10) / 10;

function sendDataWrapper(data) {
  if (!sendData) return;
  const jsonStr = JSON.stringify(data);
  totalBytesSent += new TextEncoder().encode(jsonStr).length;
  updateTrafficBadge();
  sendData(data);
}

function updateTrafficBadge() {
  if (!colorSortScreen) return;
  if (!trafficBadge) {
    trafficBadge = document.getElementById('colorsort-traffic-badge');
    if (!trafficBadge) {
      trafficBadge = document.createElement('div');
      trafficBadge.id = 'colorsort-traffic-badge';
      trafficBadge.style.position = 'absolute';
      trafficBadge.style.top = '10px';
      trafficBadge.style.right = '10px';
      trafficBadge.style.fontSize = '12px';
      trafficBadge.style.fontWeight = 'bold';
      trafficBadge.style.color = '#ffffff';
      trafficBadge.style.background = 'rgba(0, 0, 0, 0.8)';
      trafficBadge.style.padding = '4px 8px';
      trafficBadge.style.borderRadius = '4px';
      trafficBadge.style.pointerEvents = 'none';
      trafficBadge.style.zIndex = '10';
      colorSortScreen.style.position = 'relative';
      colorSortScreen.appendChild(trafficBadge);
    }
  }
  let trafficKB = ((totalBytesSent + totalBytesReceived) / 1024).toFixed(2);
  trafficBadge.innerText = `通信量: ${trafficKB} KB`;
}

export function initColorSortSystem(hostFlag, sendFunction) {
  ensureDOM();
  isHost = hostFlag;
  sendData = sendFunction;
  totalBytesSent = 0;
  totalBytesReceived = 0;
}

export function startColorSort() {
  if (!ensureDOM()) return;

  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  colorSortScreen.classList.add('active');

  if (!isHost) {
    if (guestSettings) guestSettings.style.display = 'block';
    if (syncRateSelect) currentSyncRate = parseInt(syncRateSelect.value, 10);
  } else {
    if (guestSettings) guestSettings.style.display = 'none';
  }

  csState.isPlaying = false;
  csState.isEnding = false;
  csState.isTallying = false;
  csState.showEndText = false;
  hostReady = false;
  guestReady = false;

  if (btnRematch) btnRematch.style.display = 'none';
  if (startOverlay) startOverlay.style.display = 'flex';

  resetOhajikis();
  updateCSScoreBoard(0, 0);

  totalBytesSent = 0;
  totalBytesReceived = 0;

  if (statusText) statusText.innerText = "「ゲーム開始」ボタンを押してください";
  updateTrafficBadge();

  if (csAnimId) cancelAnimationFrame(csAnimId);
  csLoop();
}

function resetOhajikis() {
  csState.ohajikis = [];
  let colors = Array(10).fill('red').concat(Array(10).fill('blue'));
  colors.sort(() => Math.random() - 0.5);

  for (let i = 0; i < TOTAL_OHAJIKI_COUNT; i++) {
    let col = i % 4;
    let row = Math.floor(i / 4);
    csState.ohajikis.push({
      id: i,
      x: 60 + col * 60 + (Math.random() * 10 - 5),
      y: 170 + row * 35 + (Math.random() * 10 - 5),
      vx: 0,
      vy: 0,
      color: colors[i],
      status: 'field'
    });
  }
}

function checkBothReady() {
  if (isHost && hostReady && guestReady) {
    triggerStartGame();
  }
}

function triggerStartGame() {
  if (startOverlay) startOverlay.style.display = 'none';
  if (statusText) statusText.innerText = "スタート！赤と青の箱に正しく仕分けよう！";
  playSound('win');
  csState.isPlaying = true;
}

export function stopColorSort() {
  csState.isPlaying = false;
  if (csAnimId) {
    cancelAnimationFrame(csAnimId);
    csAnimId = null;
  }
  if (trafficBadge) {
    trafficBadge.remove();
    trafficBadge = null;
  }
}

function csLoop() {
  if (csState.isPlaying && isHost && !csState.isEnding && !csState.isTallying) {
    updatePhysics();
  }

  drawCSBoard();

  if (csState.isPlaying && !csState.isEnding && !csState.isTallying) {
    csFrameCount++;
    if (csFrameCount % currentSyncRate === 0 && sendData) {
      let grabbedId = grabbedOhajiki ? grabbedOhajiki.id : -1;
      let syncData = csState.ohajikis.map(o => [o.id, r(o.x), r(o.y), r(o.vx), r(o.vy), o.status]);
      sendDataWrapper({ 
        type: 'cs_sync', 
        d: syncData, 
        grabbedId: grabbedId 
      });
      updateTrafficBadge();
    }
  }

  csAnimId = requestAnimationFrame(csLoop);
}

function updatePhysics() {
  let remainingOnField = 0;

  csState.ohajikis.forEach(o => {
    if (o.status !== 'field') return;

    if (grabbedOhajiki !== o) {
      o.x += o.vx;
      o.y += o.vy;
      o.vx *= 0.96;
      o.vy *= 0.96;
    }

    if (Math.abs(o.vx) < 0.05) o.vx = 0;
    if (Math.abs(o.vy) < 0.05) o.vy = 0;

    if (o.x - OHAJIKI_RADIUS < 5) {
      o.x = 5 + OHAJIKI_RADIUS;
      o.vx *= -0.8;
      playSound('put');
    }
    if (o.x + OHAJIKI_RADIUS > CS_WIDTH - 5) {
      o.x = CS_WIDTH - 5 - OHAJIKI_RADIUS;
      o.vx *= -0.8;
      playSound('put');
    }

    if (o.y - OHAJIKI_RADIUS < 40 && o.x > 10 && o.x < CS_WIDTH - 10) {
      o.status = 'guest_box';
      o.boxType = (o.x < 150) ? 'red' : 'blue';
      if (grabbedOhajiki === o) { grabbedOhajiki = null; isTouching = false; }
      playSound('flip');
      return;
    } else if (o.y - OHAJIKI_RADIUS < 5) {
      o.y = 5 + OHAJIKI_RADIUS;
      o.vy *= -0.8;
      playSound('put');
    }

    if (o.y + OHAJIKI_RADIUS > 460 && o.x > 10 && o.x < CS_WIDTH - 10) {
      o.status = 'host_box';
      o.boxType = (o.x < 150) ? 'red' : 'blue';
      if (grabbedOhajiki === o) { grabbedOhajiki = null; isTouching = false; }
      playSound('flip');
      return;
    } else if (o.y + OHAJIKI_RADIUS > CS_HEIGHT - 5) {
      o.y = CS_HEIGHT - 5 - OHAJIKI_RADIUS;
      o.vy *= -0.8;
      playSound('put');
    }

    if (o.status === 'field') {
      remainingOnField++;
    }
  });

  for (let i = 0; i < csState.ohajikis.length; i++) {
    for (let j = i + 1; j < csState.ohajikis.length; j++) {
      let o1 = csState.ohajikis[i];
      let o2 = csState.ohajikis[j];
      if (o1.status !== 'field' || o2.status !== 'field') continue;

      let dx = o2.x - o1.x;
      let dy = o2.y - o1.y;
      let dist = Math.hypot(dx, dy);

      if (dist < OHAJIKI_RADIUS * 2) {
        let nx = dx / (dist || 1);
        let ny = dy / (dist || 1);

        let overlap = OHAJIKI_RADIUS * 2 - dist;
        
        if (grabbedOhajiki === o1) {
          o2.x += nx * overlap;
          o2.y += ny * overlap;
        } else if (grabbedOhajiki === o2) {
          o1.x -= nx * overlap;
          o1.y -= ny * overlap;
        } else {
          o1.x -= nx * overlap * 0.5;
          o1.y -= ny * overlap * 0.5;
          o2.x += nx * overlap * 0.5;
          o2.y += ny * overlap * 0.5;

          let kx = o1.vx - o2.vx;
          let ky = o1.vy - o2.vy;
          let p = 2 * (nx * kx + ny * ky) / 2;

          o1.vx -= p * nx;
          o1.vy -= p * ny;
          o2.vx += p * nx;
          o2.vy += p * ny;
        }
      }
    }
  }

  if (remainingOnField === 0 && !csState.isEnding && !csState.isTallying) {
    triggerGameEnd();
  }
}

function triggerGameEnd() {
  csState.isEnding = true;
  csState.showEndText = true;
  csState.endTextScale = 0.1;
  playSound('win');

  if (sendData) {
    sendDataWrapper({ type: 'cs_end' });
  }

  setTimeout(() => {
    csState.showEndText = false;
    startTallyAnimation();
  }, 1800);
}

function startTallyAnimation() {
  csState.isTallying = true;
  csState.hostScore = 0;
  csState.guestScore = 0;
  csState.hostDisplayScore = 0;
  csState.guestDisplayScore = 0;
  updateCSScoreBoard(0, 0);

  let list = [];
  csState.ohajikis.forEach(o => {
    if (o.status === 'host_box') {
      let pts = (o.color === o.boxType) ? 1 : -1;
      csState.hostScore += pts;
      list.push({ owner: 'host', color: o.color, boxType: o.boxType, pts: pts, id: o.id });
    } else if (o.status === 'guest_box') {
      let pts = (o.color === o.boxType) ? 1 : -1;
      csState.guestScore += pts;
      list.push({ owner: 'guest', color: o.color, boxType: o.boxType, pts: pts, id: o.id });
    }
  });

  csState.tallyList = list;
  csState.tallyIndex = 0;

  processNextTallyBall();
}

function processNextTallyBall() {
  if (csState.tallyIndex >= csState.tallyList.length) {
    finishTallyAndShowResult();
    return;
  }

  let item = csState.tallyList[csState.tallyIndex];
  csState.tallyIndex++;

  playSound('flip');

  if (item.owner === 'host') {
    csState.hostDisplayScore += item.pts;
  } else {
    csState.guestDisplayScore += item.pts;
  }

  setTimeout(() => {
    playSound(item.pts > 0 ? 'win' : 'put');
    updateCSScoreBoard(csState.hostDisplayScore, csState.guestDisplayScore);
  }, 350);

  // ③ 点数集計のテンポをもう少しだけ遅く調整（0.45秒間隔）
  setTimeout(processNextTallyBall, 650);
}

function finishTallyAndShowResult() {
  csState.isTallying = false;
  csState.isPlaying = false;

  let hostFinal = csState.hostScore;
  let guestFinal = csState.guestScore;

  let isHostWin = hostFinal > guestFinal;
  let isHostLose = hostFinal < guestFinal;
  let isDraw = hostFinal === guestFinal;

  if (isDraw) {
    csState.winnerText = '引き分け！';
  } else {
    // ④ ホスト側・ゲスト側で判定が逆転して両方「勝ち」になっていた不具合を修正
    if (isHost) {
      csState.winnerText = isHostWin ? '勝ち！' : '負け';
    } else {
      csState.winnerText = isHostLose ? '勝ち！' : '負け';
    }
  }

  if (csState.winnerText === '勝ち！' && window.confetti) {
    window.confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
  }

  if (statusText) statusText.innerText = `ゲーム終了 - ${csState.winnerText}`;
  if (btnRematch) btnRematch.style.display = 'block';
}

function updateCSScoreBoard(hostScore, guestScore) {
  const hostEl = document.getElementById('colorsort-score-host');
  const guestEl = document.getElementById('colorsort-score-guest');
  if (hostEl) hostEl.innerText = `あなたのスコア: ${isHost ? hostScore : guestScore}点`;
  if (guestEl) guestEl.innerText = `相手のスコア: ${isHost ? guestScore : hostScore}点`;
}

function drawCSBoard() {
  if (!ctxCS) return;

  ctxCS.fillStyle = '#f8fafc';
  ctxCS.fillRect(0, 0, CS_WIDTH, CS_HEIGHT);

  ctxCS.strokeStyle = '#cbd5e1';
  ctxCS.lineWidth = 3;
  ctxCS.strokeRect(2, 2, CS_WIDTH - 4, CS_HEIGHT - 4);

  let drawX = (x) => (isHost ? x : CS_WIDTH - x);
  let drawY = (y) => (isHost ? y : CS_HEIGHT - y);

  // 上部（相手側）の箱
  ctxCS.fillStyle = 'rgba(239, 68, 68, 0.12)';
  ctxCS.fillRect(10, 0, 135, 40);
  ctxCS.strokeStyle = '#f87171';
  ctxCS.lineWidth = 2;
  ctxCS.strokeRect(10, 0, 135, 40);
  ctxCS.fillStyle = '#b91c1c';
  ctxCS.font = "bold 11px sans-serif";
  ctxCS.textAlign = "center";
  ctxCS.fillText("相手:赤箱", 77, 25);

  ctxCS.fillStyle = 'rgba(59, 130, 246, 0.12)';
  ctxCS.fillRect(155, 0, 135, 40);
  ctxCS.strokeStyle = '#60a5fa';
  ctxCS.lineWidth = 2;
  ctxCS.strokeRect(155, 0, 135, 40);
  ctxCS.fillStyle = '#1d4ed8';
  ctxCS.fillText("相手:青箱", 222, 25);

  // 下部（自分側）の箱
  ctxCS.fillStyle = 'rgba(239, 68, 68, 0.12)';
  ctxCS.fillRect(10, CS_HEIGHT - 40, 135, 40);
  ctxCS.strokeStyle = '#f87171';
  ctxCS.lineWidth = 2;
  ctxCS.strokeRect(10, CS_HEIGHT - 40, 135, 40);
  ctxCS.fillStyle = '#b91c1c';
  ctxCS.fillText("自分:赤箱", 77, CS_HEIGHT - 15);

  ctxCS.fillStyle = 'rgba(59, 130, 246, 0.12)';
  ctxCS.fillRect(155, CS_HEIGHT - 40, 135, 40);
  ctxCS.strokeStyle = '#60a5fa';
  ctxCS.lineWidth = 2;
  ctxCS.strokeRect(155, CS_HEIGHT - 40, 135, 40);
  ctxCS.fillStyle = '#1d4ed8';
  ctxCS.fillText("自分:青箱", 222, CS_HEIGHT - 15);

  ctxCS.strokeStyle = '#e2e8f0';
  ctxCS.lineWidth = 2;
  ctxCS.beginPath();
  ctxCS.moveTo(0, CS_HEIGHT / 2);
  ctxCS.lineTo(CS_WIDTH, CS_HEIGHT / 2);
  ctxCS.stroke();

  csState.ohajikis.forEach(o => {
    if (o.status !== 'field') return;

    let ox = drawX(o.x);
    let oy = drawY(o.y);

    ctxCS.fillStyle = 'rgba(0, 0, 0, 0.15)';
    ctxCS.beginPath();
    ctxCS.arc(ox, oy + 3, OHAJIKI_RADIUS, 0, Math.PI * 2);
    ctxCS.fill();

    let grad = ctxCS.createRadialGradient(ox - 4, oy - 4, 1, ox, oy, OHAJIKI_RADIUS);
    if (o.color === 'red') {
      grad.addColorStop(0, 'rgba(254, 202, 202, 0.9)');
      grad.addColorStop(0.5, 'rgba(239, 68, 68, 0.85)');
      grad.addColorStop(1, 'rgba(153, 27, 27, 0.95)');
    } else {
      grad.addColorStop(0, 'rgba(191, 219, 254, 0.9)');
      grad.addColorStop(0.5, 'rgba(59, 130, 246, 0.85)');
      grad.addColorStop(1, 'rgba(30, 58, 138, 0.95)');
    }

    ctxCS.fillStyle = grad;
    ctxCS.beginPath();
    ctxCS.arc(ox, oy, OHAJIKI_RADIUS, 0, Math.PI * 2);
    ctxCS.fill();

    ctxCS.fillStyle = 'rgba(255, 255, 255, 0.55)';
    ctxCS.beginPath();
    ctxCS.arc(ox - 4, oy - 4, 3.5, 0, Math.PI * 2);
    ctxCS.fill();

    ctxCS.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    ctxCS.lineWidth = 1.5;
    ctxCS.beginPath();
    ctxCS.arc(ox, oy, OHAJIKI_RADIUS - 1, 0, Math.PI * 2);
    ctxCS.stroke();

    // ⑤ 相手が現在つまんでいるおじきの上に手のアイコン（🖐️）を表示してわかりやすくする
    if (o.id === csState.remoteGrabbedId) {
      ctxCS.save();
      ctxCS.font = "18px sans-serif";
      ctxCS.textAlign = "center";
      ctxCS.textBaseline = "middle";
      ctxCS.fillText("🖐️", ox, oy - 18);
      ctxCS.restore();
    }
  });

  if (csState.showEndText) {
    csState.endTextScale += (1.0 - csState.endTextScale) * 0.2;
    ctxCS.save();
    ctxCS.translate(CS_WIDTH / 2, CS_HEIGHT / 2);
    ctxCS.scale(csState.endTextScale, csState.endTextScale);

    ctxCS.fillStyle = '#f59e0b';
    ctxCS.font = "italic 900 52px sans-serif";
    ctxCS.textAlign = "center";
    ctxCS.textBaseline = "middle";

    ctxCS.shadowColor = "#000";
    ctxCS.shadowBlur = 10;
    ctxCS.strokeStyle = "#ffffff";
    ctxCS.lineWidth = 5;
    ctxCS.strokeText("終了！", 0, 0);
    ctxCS.fillText("終了！", 0, 0);

    ctxCS.restore();
  }

  if (!csState.isPlaying && csState.winnerText) {
    ctxCS.save();
    ctxCS.translate(CS_WIDTH / 2, CS_HEIGHT / 2);
    ctxCS.fillStyle = csState.winnerText === '勝ち！' ? '#16a34a' : '#dc2626';
    ctxCS.font = "bold 44px sans-serif";
    ctxCS.textAlign = "center";
    ctxCS.textBaseline = "middle";
    ctxCS.strokeStyle = "#ffffff";
    ctxCS.lineWidth = 4;
    ctxCS.strokeText(csState.winnerText, 0, 0);
    ctxCS.fillText(csState.winnerText, 0, 0);
    ctxCS.restore();
  }
}

export function processColorSortData(data) {
  if (!data) return;

  const jsonStr = JSON.stringify(data);
  totalBytesReceived += new TextEncoder().encode(jsonStr).length;
  updateTrafficBadge();

  switch (data.type) {
    case 'cs_ready':
      if (isHost && data.side === 'guest') {
        guestReady = true;
        if (statusText && hostReady) statusText.innerText = "まもなくスタート...";
        checkBothReady();
      }
      break;
    case 'cs_start':
      if (!isHost) {
        if (data.initOhajikis) {
          csState.ohajikis = data.initOhajikis;
        }
        triggerStartGame();
      }
      break;
    case 'cs_config':
      if (isHost && data.rate) currentSyncRate = parseInt(data.rate, 10);
      break;
    case 'cs_sync':
      if (data.d) {
        data.d.forEach(item => {
          let o = csState.ohajikis.find(x => x.id === item[0]);
          if (o) {
            o.x = item[1];
            o.y = item[2];
            o.vx = item[3];
            o.vy = item[4];
            o.status = item[5];
          }
        });
      }
      // ⑤ 相手がつまんでいるおはじきのIDを受信して記録
      if (typeof data.grabbedId !== 'undefined') {
        csState.remoteGrabbedId = data.grabbedId;
      }
      break;
    case 'cs_end':
      triggerGameEnd();
      break;
  }
}