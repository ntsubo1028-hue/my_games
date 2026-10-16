// colorsort.js - 色分けおはじき対戦ゲーム（安定版）
import { playSound } from './sounds.js';

// DOM要素（遅延初期化）
let colorsortScreen = null;
let colorsortStatusText = null;
let canvasCS = null;
let ctxCS = null;
let btnQuitColorSort = null;
let btnRematchColorSort = null;
let btnStartColorSort = null;
let csStartOverlay = null;
let csGuestSettings = null;
let csSyncRateSelect = null;
let csScoreBoard = null;

// ホスト用設定要素
let hostSettingsContainer = null;
let bubbleCountSlider = null;
let bubbleCountLabel = null;

let isDOMInitialized = false;

// 描画・物理演算の定数
const CS_WIDTH = 300;
const CS_HEIGHT = 500;
const BUBBLE_RADIUS = 12;

// ゲーム設定
let currentSyncRate = 3;
let totalBubbles = 20;

// ゲーム状態
let csState = {
  bubbles: [],
  boxes: {},
  particles: [],
  isPlaying: false,
  isPlayballEffect: false,
  isEndingFlow: false,
  isCounting: false,
  playballScale: 0.5,
  tallyList: [],
  tallyIndex: 0,
  myScore: 0,
  opScore: 0
};

let csAnimId = null;
let csFrameCount = 0;
let isHost = false;
let sendData = null;

// タッチ・マウス・ドラッグ・シュート管理
let draggedBubbleId = null;
let touchPos = { x: 0, y: 0 };
let isTouching = false;
let dragVelocityX = 0;
let dragVelocityY = 0;
let mouseCanvasPos = null;
let isMouseActive = false;

let hostReady = false;
let guestReady = false;

let totalBytesSent = 0;
let totalBytesReceived = 0;
let trafficBadge = null;

// DOMの安全な初期化
function ensureDOM() {
  if (isDOMInitialized && ctxCS) return true;

  colorsortScreen = document.getElementById('colorsort-game-screen');
  colorsortStatusText = document.getElementById('colorsort-status-text');
  canvasCS = document.getElementById('colorsort-board');
  btnQuitColorSort = document.getElementById('btn-quit-colorsort');
  btnRematchColorSort = document.getElementById('btn-rematch-colorsort');
  btnStartColorSort = document.getElementById('btn-start-colorsort');
  csStartOverlay = document.getElementById('cs-start-overlay');
  csGuestSettings = document.getElementById('cs-guest-settings');
  csSyncRateSelect = document.getElementById('cs-sync-rate-select');
  csScoreBoard = document.getElementById('colorsort-score-board');

  if (!canvasCS) return false;

  ctxCS = canvasCS.getContext('2d');
  setupUIControls();
  setupEventListeners();
  isDOMInitialized = true;
  return true;
}

// ホスト用スケーラーUIの動的構築
function setupUIControls() {
  if (!csStartOverlay) return;

  csStartOverlay.style.cssText = 'position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.65); display: flex; flex-direction: column; justify-content: center; align-items: center; z-index: 100; gap: 16px;';

  if (!document.getElementById('cs-host-settings-container')) {
    hostSettingsContainer = document.createElement('div');
    hostSettingsContainer.id = 'cs-host-settings-container';
    hostSettingsContainer.style.cssText = 'display: flex; flex-direction: column; align-items: center; gap: 8px; background: rgba(255, 255, 255, 0.95); padding: 14px 20px; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.3); color: #2f3640; font-size: 14px; font-weight: bold;';
    hostSettingsContainer.innerHTML = `
      <div id="cs-slider-wrapper" style="display: flex; flex-direction: column; align-items: center; gap: 6px;">
        <label for="bubble-count-slider" style="background: #dfe4ea; padding: 4px 12px; border-radius: 6px; color: #2f3640; font-size: 13px;">おはじき個数: <span id="bubble-count-val">20</span>個</label>
        <input type="range" id="bubble-count-slider" min="10" max="40" step="2" value="20" style="width: 180px; cursor: pointer;">
      </div>
    `;
    csStartOverlay.appendChild(hostSettingsContainer);
    if (btnStartColorSort) {
      csStartOverlay.appendChild(btnStartColorSort);
    }

    bubbleCountSlider = document.getElementById('bubble-count-slider');
    bubbleCountLabel = document.getElementById('bubble-count-val');

    if (bubbleCountSlider) {
      bubbleCountSlider.addEventListener('input', (e) => {
        totalBubbles = parseInt(e.target.value, 10);
        if (bubbleCountLabel) bubbleCountLabel.innerText = totalBubbles;
        if (isHost && sendData) {
          sendDataWrapper({ type: 'cs_config_bubbles', count: totalBubbles });
        }
      });
    }
  }
}

function setupEventListeners() {
  if (csSyncRateSelect) {
    csSyncRateSelect.addEventListener('change', (e) => {
      if (!isHost) {
        currentSyncRate = parseInt(e.target.value, 10);
        if (sendData) {
          sendDataWrapper({ type: 'cs_config', rate: currentSyncRate });
        }
      }
    });
  }

  if (btnStartColorSort) {
    btnStartColorSort.onclick = () => {
      if (csStartOverlay) csStartOverlay.style.display = 'none';

      if (isHost) {
        hostReady = true;
        if (colorsortStatusText) colorsortStatusText.innerText = guestReady ? "まもなくスタート..." : "相手の準備を待っています...";
        sendDataWrapper({ type: 'cs_ready', side: 'host', count: totalBubbles });
        checkBothReady();
      } else {
        guestReady = true;
        if (colorsortStatusText) colorsortStatusText.innerText = "ホストの開始を待っています...";
        sendDataWrapper({ type: 'cs_ready', side: 'guest' });
      }
    };
  }

  if (canvasCS) {
    const getPos = (clientX, clientY) => {
      let rect = canvasCS.getBoundingClientRect();
      let scaleX = CS_WIDTH / rect.width;
      let scaleY = CS_HEIGHT / rect.height;
      let x = (clientX - rect.left) * scaleX;
      let y = (clientY - rect.top) * scaleY;
      if (!isHost) {
        x = CS_WIDTH - x;
        y = CS_HEIGHT - y;
      }
      return { x, y };
    };

    const handleStart = (clientX, clientY) => {
      if (!csState.isPlaying || csState.isPlayballEffect || csState.isEndingFlow || csState.isCounting) return;
      let pos = getPos(clientX, clientY);
      touchPos = pos;
      isTouching = true;
      dragVelocityX = 0;
      dragVelocityY = 0;

      let clickedBubble = null;
      for (let b of csState.bubbles) {
        if (b.inBox !== null) continue;
        let dist = Math.hypot(b.x - pos.x, b.y - pos.y);
        if (dist <= BUBBLE_RADIUS * 2.2) {
          clickedBubble = b;
          break;
        }
      }

      if (clickedBubble) {
        draggedBubbleId = clickedBubble.id;
        clickedBubble.grabbedBy = isHost ? 'host' : 'guest';
      } else {
        draggedBubbleId = null;
      }
    };

    const handleMove = (clientX, clientY) => {
      let pos = getPos(clientX, clientY);
      mouseCanvasPos = pos;
      isMouseActive = true;

      if (!isTouching) return;

      if (draggedBubbleId !== null) {
        let b = csState.bubbles.find(item => item.id === draggedBubbleId);
        if (b && b.inBox === null) {
          dragVelocityX = (pos.x - b.x) * 0.8;
          dragVelocityY = (pos.y - b.y) * 0.8;

          b.x = pos.x;
          b.y = pos.y;
          b.vx = 0;
          b.vy = 0;
        }
      }
      touchPos = pos;
    };

    const handleEnd = () => {
      if (!isTouching) return;
      isTouching = false;

      if (draggedBubbleId !== null) {
        let b = csState.bubbles.find(item => item.id === draggedBubbleId);
        if (b) {
          b.grabbedBy = null;
          b.vx = dragVelocityX;
          b.vy = dragVelocityY;
        }
        draggedBubbleId = null;
      }
    };

    canvasCS.addEventListener('touchstart', (e) => {
      e.preventDefault();
      isMouseActive = false;
      if (e.touches.length > 0) handleStart(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: false });

    canvasCS.addEventListener('touchmove', (e) => {
      e.preventDefault();
      if (e.touches.length > 0) handleMove(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: false });

    canvasCS.addEventListener('touchend', handleEnd);
    canvasCS.addEventListener('touchcancel', handleEnd);

    canvasCS.addEventListener('mousedown', (e) => {
      isMouseActive = true;
      handleStart(e.clientX, e.clientY);
    });
    window.addEventListener('mousemove', (e) => {
      let rect = canvasCS.getBoundingClientRect();
      if (e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom) {
        handleMove(e.clientX, e.clientY);
      } else {
        isMouseActive = false;
      }
    });
    window.addEventListener('mouseup', handleEnd);
  }
}

function sendDataWrapper(data) {
  if (!sendData) return;
  const jsonStr = JSON.stringify(data);
  totalBytesSent += new TextEncoder().encode(jsonStr).length;
  sendData(data);
}

function updateTrafficBadge() {
  if (!colorsortScreen) return;
  if (!trafficBadge) {
    trafficBadge = document.createElement('div');
    trafficBadge.id = 'colorsort-traffic-badge';
    trafficBadge.style.position = 'absolute';
    trafficBadge.style.top = '10px';
    trafficBadge.style.right = '10px';
    trafficBadge.style.fontSize = '13px';
    trafficBadge.style.fontWeight = 'bold';
    trafficBadge.style.color = '#333';
    trafficBadge.style.background = 'rgba(255, 255, 255, 0.8)';
    trafficBadge.style.padding = '4px 10px';
    trafficBadge.style.borderRadius = '4px';
    trafficBadge.style.border = '1px solid #ccc';
    trafficBadge.style.pointerEvents = 'none';
    trafficBadge.style.zIndex = '10';

    colorsortScreen.style.position = 'relative';
    colorsortScreen.appendChild(trafficBadge);
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
  colorsortScreen.classList.add('active');

  if (hostSettingsContainer) {
    hostSettingsContainer.style.display = isHost ? 'flex' : 'none';
  }

  if (!isHost) {
    if (csGuestSettings) csGuestSettings.style.display = 'block';
  } else {
    if (csGuestSettings) csGuestSettings.style.display = 'none';
  }

  if (csScoreBoard) csScoreBoard.style.display = 'none';

  csState.isPlaying = false;
  csState.isPlayballEffect = false;
  csState.isEndingFlow = false;
  csState.isCounting = false;
  csState.particles = [];
  csState.bubbles = [];
  hostReady = false;
  guestReady = false;

  if (btnRematchColorSort) btnRematchColorSort.style.display = 'none';
  if (csStartOverlay) csStartOverlay.style.display = 'flex';

  initBoxes();

  totalBytesSent = 0;
  totalBytesReceived = 0;

  if (colorsortStatusText) {
    colorsortStatusText.innerText = isHost ? "「ゲーム開始」ボタンを押してください" : "ホストの開始を待っています...";
  }
  updateTrafficBadge();

  if (csAnimId) cancelAnimationFrame(csAnimId);
  csLoop();
}

function initBoxes() {
  csState.boxes = {
    myRed: { x: 30, y: CS_HEIGHT - 45, w: 70, h: 45, color: '#ff7675', owner: 'me', type: 'red', openSide: 'top' },
    myBlue: { x: CS_WIDTH - 100, y: CS_HEIGHT - 45, w: 70, h: 45, color: '#74b9ff', owner: 'me', type: 'blue', openSide: 'top' },
    opRed: { x: 30, y: 0, w: 70, h: 45, color: '#ff7675', owner: 'op', type: 'red', openSide: 'bottom' },
    opBlue: { x: CS_WIDTH - 100, y: 0, w: 70, h: 45, color: '#74b9ff', owner: 'op', type: 'blue', openSide: 'bottom' }
  };
}

function initBubbles() {
  csState.bubbles = [];
  let half = Math.floor(totalBubbles / 2);
  for (let i = 0; i < totalBubbles; i++) {
    let type = i < half ? 'red' : 'blue';
    let x, y, overlap;
    let attempts = 0;
    do {
      overlap = false;
      x = 40 + Math.random() * (CS_WIDTH - 80);
      y = 120 + Math.random() * (CS_HEIGHT - 240);
      for (let b of csState.bubbles) {
        if (Math.hypot(b.x - x, b.y - y) < BUBBLE_RADIUS * 2.5) {
          overlap = true;
          break;
        }
      }
      attempts++;
    } while (overlap && attempts < 100);

    csState.bubbles.push({
      id: i,
      x: x,
      y: y,
      prevX: x,
      prevY: y,
      vx: 0,
      vy: 0,
      type: type,
      inBox: null,
      grabbedBy: null
    });
  }
}

function checkBothReady() {
  if (isHost && hostReady && guestReady) {
    sendDataWrapper({ type: 'cs_start', count: totalBubbles });
    triggerPlayball();
  }
}

function triggerPlayball() {
  if (csStartOverlay) csStartOverlay.style.display = 'none';
  
  initBubbles();

  csState.isPlayballEffect = true;
  csState.playballScale = 0.3;
  if (colorsortStatusText) {
    colorsortStatusText.innerText = "まもなくスタート！";
  }
  playSound('win');

  setTimeout(() => {
    csState.isPlayballEffect = false;
    csState.isPlaying = true;
    if (colorsortStatusText) {
      colorsortStatusText.innerText = "ゲーム中！ おはじきを箱に入れよう";
    }
  }, 1000);
}

export function stopColorSort() {
  csState.isPlaying = false;
  csState.isPlayballEffect = false;
  if (csAnimId) {
    cancelAnimationFrame(csAnimId);
    csAnimId = null;
  }
  if (trafficBadge) {
    trafficBadge.remove();
    trafficBadge = null;
  }
}

export function resumeColorSort() {
  csState.isPlaying = true;
  csState.isPlayballEffect = false;
  if (csAnimId) {
    cancelAnimationFrame(csAnimId);
    csAnimId = null;
  }
  csLoop();
}

function createBurstParticles(x, y, color) {
  for (let i = 0; i < 10; i++) {
    let angle = Math.random() * Math.PI * 2;
    let speed = 2 + Math.random() * 5;
    csState.particles.push({
      x: x,
      y: y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      radius: 3 + Math.random() * 3,
      color: color,
      alpha: 1.0
    });
  }
}

function csLoop() {
  if (csState.isPlaying && isHost && !csState.isPlayballEffect && !csState.isEndingFlow && !csState.isCounting) {
    for (let b of csState.bubbles) {
      if (b.inBox !== null) continue;

      if (b.id !== draggedBubbleId) {
        b.prevX = b.x;
        b.prevY = b.y;

        b.vx *= 0.94;
        b.vy *= 0.94;
        b.x += b.vx;
        b.y += b.vy;
      }

      let m = BUBBLE_RADIUS;
      if (b.x < m) { b.x = m; b.vx *= -0.5; }
      if (b.x > CS_WIDTH - m) { b.x = CS_WIDTH - m; b.vx *= -0.5; }
      if (b.y < m) { b.y = m; b.vy *= -0.5; }
      if (b.y > CS_HEIGHT - m) { b.y = CS_HEIGHT - m; b.vy *= -0.5; }

      for (let key in csState.boxes) {
        let box = csState.boxes[key];
        
        if (b.x >= box.x && b.x <= box.x + box.w && b.y >= box.y && b.y <= box.y + box.h) {
          let entered = false;
          
          if (box.openSide === 'top') {
            if (b.prevY <= box.y && b.y >= box.y) {
              entered = true;
            }
          } else if (box.openSide === 'bottom') {
            if (b.prevY >= box.y + box.h && b.y <= box.y + box.h) {
              entered = true;
            }
          }

          if (entered) {
            b.inBox = key;
            b.grabbedBy = null;
            if (draggedBubbleId === b.id) draggedBubbleId = null;
            createBurstParticles(b.x, b.y, b.type === 'red' ? '#ff7675' : '#74b9ff');
            playSound('put');
            break;
          } else {
            if (box.openSide === 'top') {
              if (b.y > box.y + box.h - 8) {
                b.y = box.y + box.h + BUBBLE_RADIUS;
                b.vy = Math.abs(b.vy) * 0.6 + 2;
              } else {
                if (b.x < box.x + box.w / 2) {
                  b.x = box.x - BUBBLE_RADIUS;
                  b.vx *= -0.5;
                } else {
                  b.x = box.x + box.w + BUBBLE_RADIUS;
                  b.vx *= -0.5;
                }
              }
            } else {
              if (b.y < box.y + 8) {
                b.y = box.y - BUBBLE_RADIUS;
                b.vy = -Math.abs(b.vy) * 0.6 - 2;
              } else {
                if (b.x < box.x + box.w / 2) {
                  b.x = box.x - BUBBLE_RADIUS;
                  b.vx *= -0.5;
                } else {
                  b.x = box.x + box.w + BUBBLE_RADIUS;
                  b.vx *= -0.5;
                }
              }
            }
          }
        }
      }
    }

    for (let i = 0; i < csState.bubbles.length; i++) {
      for (let j = i + 1; j < csState.bubbles.length; j++) {
        let b1 = csState.bubbles[i];
        let b2 = csState.bubbles[j];
        if (b1.inBox !== null || b2.inBox !== null) continue;

        let dx = b2.x - b1.x;
        let dy = b2.y - b1.y;
        let dist = Math.hypot(dx, dy);
        let minDist = BUBBLE_RADIUS * 2;

        if (dist < minDist && dist > 0) {
          let overlap = minDist - dist;
          let nx = dx / dist;
          let ny = dy / dist;

          b1.x -= nx * overlap * 0.5;
          b1.y -= ny * overlap * 0.5;
          b2.x += nx * overlap * 0.5;
          b2.y += ny * overlap * 0.5;

          let kx = b1.vx - b2.vx;
          let ky = b1.vy - b2.vy;
          let p = 2 * (nx * kx + ny * ky) / 2;

          b1.vx -= p * nx * 0.8;
          b1.vy -= p * ny * 0.8;
          b2.vx += p * nx * 0.8;
          b2.vy += p * ny * 0.8;
        }
      }
    }

    for (let p of csState.particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.alpha -= 0.03;
    }
    csState.particles = csState.particles.filter(p => p.alpha > 0);

    let allFinished = csState.bubbles.every(b => b.inBox !== null);
    if (allFinished && csState.bubbles.length > 0) {
      triggerEndingFlow();
    }
  }

  drawCSBoard();

  if (csState.isPlaying) {
    csFrameCount++;
    if (csFrameCount % currentSyncRate === 0 && sendData && isHost) {
      sendDataWrapper({
        type: 'cs_sync_host',
        d: csState.bubbles.map(b => [Math.round(b.x), Math.round(b.y), b.inBox])
      });
      updateTrafficBadge();
    } else if (csState.isPlaying && !isHost && sendData) {
      sendDataWrapper({
        type: 'cs_sync_guest',
        dragId: draggedBubbleId,
        tx: Math.round(touchPos.x),
        ty: Math.round(touchPos.y)
      });
    }
  }

  csAnimId = requestAnimationFrame(csLoop);
}

function triggerEndingFlow() {
  csState.isEndingFlow = true;
  if (sendData && isHost) {
    sendDataWrapper({ type: 'cs_end_flow' });
  }

  if (colorsortStatusText) colorsortStatusText.innerText = "すべてのおはじきが入りました！";
  playSound('win');

  setTimeout(() => {
    startCountingPhase();
  }, 1500);
}

function startCountingPhase() {
  csState.isEndingFlow = false;
  csState.isCounting = true;

  if (csScoreBoard) csScoreBoard.style.display = 'flex';

  let tallyList = [];
  ['myRed', 'myBlue', 'opRed', 'opBlue'].forEach(boxKey => {
    let box = csState.boxes[boxKey];
    let matchedBubbles = csState.bubbles.filter(b => b.inBox === boxKey);
    matchedBubbles.forEach(b => {
      let isMatch = (box.type === b.type);
      let isMine = (box.owner === 'me');
      tallyList.push({ boxKey, b, isMatch, isMine });
    });
  });

  csState.tallyList = tallyList;
  csState.tallyIndex = 0;
  csState.myScore = 0;
  csState.opScore = 0;

  if (colorsortStatusText) colorsortStatusText.innerText = "採点中（玉入れ集計）...";

  runTallyStep();
}

function runTallyStep() {
  if (!csState.isCounting) return;

  if (csState.tallyIndex < csState.tallyList.length) {
    let item = csState.tallyList[csState.tallyIndex];
    if (item.isMatch) {
      if (item.isMine) csState.myScore += 1;
      else csState.opScore += 1;
      playSound('win');
    } else {
      if (item.isMine) csState.myScore -= 1;
      else csState.opScore -= 1;
      playSound('put');
    }
    
    const hostScoreEl = document.getElementById('colorsort-score-host');
    const guestScoreEl = document.getElementById('colorsort-score-guest');
    if (hostScoreEl) hostScoreEl.innerText = `ホスト(赤箱): ${isHost ? csState.myScore : csState.opScore}点`;
    if (guestScoreEl) guestScoreEl.innerText = `ゲスト(青箱): ${isHost ? csState.opScore : csState.myScore}点`;

    csState.tallyIndex++;
    setTimeout(runTallyStep, 700);
  } else {
    finishColorSortGame();
  }
}

function finishColorSortGame() {
  csState.isCounting = false;
  csState.isPlaying = false;

  let myWin = csState.myScore >= csState.opScore;
  if (colorsortStatusText) {
    colorsortStatusText.innerText = `ゲーム終了！ 自分: ${csState.myScore}点 vs 相手: ${csState.opScore}点`;
  }

  if (btnRematchColorSort) btnRematchColorSort.style.display = 'block';

  showResultOverlay(myWin, csState.myScore, csState.opScore);
}

function showResultOverlay(isWin, myScore, opScore) {
  let overlay = document.createElement('div');
  overlay.style.cssText = 'position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.75); display: flex; flex-direction: column; justify-content: center; align-items: center; z-index: 200;';

  if (isWin) {
    overlay.innerHTML = `
      <div style="font-size: 56px; color: #ffeb3b; font-weight: 900; text-shadow: 0 0 20px rgba(255,235,59,0.8); animation: bounce 0.6s infinite alternate;">勝 ち ！</div>
      <div style="font-size: 18px; color: #fff; margin-top: 10px;">スコア: ${myScore}点 vs ${opScore}点</div>
    `;
    if (typeof confetti === 'function') {
      confetti({ particleCount: 150, spread: 80, origin: { y: 0.6 } });
    }
  } else {
    overlay.innerHTML = `
      <div style="font-size: 56px; color: #9e9e9e; font-weight: 900; animation: shake 0.3s infinite;">負 け …</div>
      <div style="font-size: 28px; margin-top: 10px; color: #ff5252;">ガ〜ン orz</div>
      <div style="font-size: 18px; color: #ccc; margin-top: 10px;">スコア: ${myScore}点 vs ${opScore}点</div>
    `;
  }

  colorsortScreen.appendChild(overlay);

  let closeBtn = document.createElement('button');
  closeBtn.className = 'btn-action';
  closeBtn.style.cssText = 'margin-top: 20px; background-color: #ff9800; width: auto; padding: 10px 24px;';
  closeBtn.innerText = '閉じる';
  closeBtn.onclick = () => overlay.remove();
  overlay.appendChild(closeBtn);
}

function drawCSBoard() {
  if (!ctxCS) return;

  ctxCS.clearRect(0, 0, CS_WIDTH, CS_HEIGHT);

  // フィールド背景
  ctxCS.fillStyle = '#f5f6fa';
  ctxCS.fillRect(0, 0, CS_WIDTH, CS_HEIGHT);

  ctxCS.strokeStyle = '#dcdde1';
  ctxCS.lineWidth = 2;
  ctxCS.beginPath();
  ctxCS.moveTo(0, CS_HEIGHT / 2);
  ctxCS.lineTo(CS_WIDTH, CS_HEIGHT / 2);
  ctxCS.stroke();

  // 箱の描画
  for (let key in csState.boxes) {
    let box = csState.boxes[key];
    let bx = isHost ? box.x : CS_WIDTH - (box.x + box.w);
    let by = isHost ? box.y : CS_HEIGHT - (box.y + box.h);

    ctxCS.save();
    let boxGrad = ctxCS.createLinearGradient(bx, by, bx, by + box.h);
    boxGrad.addColorStop(0, box.color);
    boxGrad.addColorStop(1, 'rgba(255, 255, 255, 0.2)');
    ctxCS.fillStyle = boxGrad;
    ctxCS.globalAlpha = 0.45;
    ctxCS.fillRect(bx, by, box.w, box.h);
    ctxCS.restore();

    ctxCS.save();
    ctxCS.strokeStyle = box.color;
    ctxCS.lineWidth = 3;
    ctxCS.shadowColor = box.color;
    ctxCS.shadowBlur = 6;
    ctxCS.beginPath();

    if (box.openSide === 'top') {
      ctxCS.moveTo(bx, by + box.h);
      ctxCS.lineTo(bx, by);
      ctxCS.lineTo(bx + box.w, by);
      ctxCS.lineTo(bx + box.w, by + box.h);
    } else {
      ctxCS.moveTo(bx, by);
      ctxCS.lineTo(bx, by + box.h);
      ctxCS.lineTo(bx + box.w, by + box.h);
      ctxCS.lineTo(bx + box.w, by);
    }
    ctxCS.stroke();
    ctxCS.restore();
  }

  // 引っ張りエフェクト（ゴム紐ライン）
  if (isTouching && draggedBubbleId !== null) {
    let b = csState.bubbles.find(item => item.id === draggedBubbleId);
    if (b && b.inBox === null) {
      let rx = isHost ? b.x : CS_WIDTH - b.x;
      let ry = isHost ? b.y : CS_HEIGHT - b.y;
      let tpx = isHost ? touchPos.x : CS_WIDTH - touchPos.x;
      let tpy = isHost ? touchPos.y : CS_HEIGHT - touchPos.y;

      ctxCS.save();
      ctxCS.strokeStyle = '#ff7675';
      ctxCS.lineWidth = 2.5;
      ctxCS.setLineDash([4, 4]);
      ctxCS.beginPath();
      ctxCS.moveTo(rx, ry);
      ctxCS.lineTo(tpx, tpy);
      ctxCS.stroke();

      ctxCS.fillStyle = '#ff7675';
      ctxCS.beginPath();
      ctxCS.arc(tpx, tpy, 5, 0, Math.PI * 2);
      ctxCS.fill();
      ctxCS.restore();
    }
  }

  // おはじきの描画
  csState.bubbles.forEach(b => {
    if (b.inBox !== null) return;

    let rx = isHost ? b.x : CS_WIDTH - b.x;
    let ry = isHost ? b.y : CS_HEIGHT - b.y;

    let baseColor = b.type === 'red' ? '#ff7675' : '#74b9ff';
    let highlightColor = b.type === 'red' ? '#ffcccc' : '#d2f8ff';

    let grad = ctxCS.createRadialGradient(
      rx - 3, ry - 3, 2, 
      rx, ry, BUBBLE_RADIUS
    );
    grad.addColorStop(0, highlightColor);
    grad.addColorStop(0.4, baseColor);
    grad.addColorStop(1, b.type === 'red' ? '#d63031' : '#0984e3');

    ctxCS.beginPath();
    ctxCS.arc(rx, ry, BUBBLE_RADIUS, 0, Math.PI * 2);
    ctxCS.fillStyle = grad;
    ctxCS.fill();
    ctxCS.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctxCS.lineWidth = 1.5;
    ctxCS.stroke();
    ctxCS.closePath();

    ctxCS.beginPath();
    ctxCS.arc(rx - 4, ry - 4, 3, 0, Math.PI * 2);
    ctxCS.fillStyle = 'rgba(255, 255, 255, 0.65)';
    ctxCS.fill();
    ctxCS.closePath();

    if (b.grabbedBy) {
      let isMyGrab = (isHost && b.grabbedBy === 'host') || (!isHost && b.grabbedBy === 'guest');
      ctxCS.save();
      if (isMyGrab) {
        ctxCS.font = '16px sans-serif';
        ctxCS.textAlign = 'center';
        ctxCS.textBaseline = 'middle';
        ctxCS.fillText('✋', rx, ry + 16);
      } else {
        ctxCS.translate(rx, ry - 16);
        ctxCS.scale(1, -1);
        ctxCS.font = '16px sans-serif';
        ctxCS.textAlign = 'center';
        ctxCS.textBaseline = 'middle';
        ctxCS.fillText('✋', 0, 0);
      }
      ctxCS.restore();
    }
  });

  if (isMouseActive && mouseCanvasPos && csState.isPlaying) {
    let mtx = isHost ? mouseCanvasPos.x : CS_WIDTH - mouseCanvasPos.x;
    let mty = isHost ? mouseCanvasPos.y : CS_HEIGHT - mouseCanvasPos.y;
    ctxCS.save();
    ctxCS.font = '18px sans-serif';
    ctxCS.textAlign = 'center';
    ctxCS.textBaseline = 'middle';
    ctxCS.fillText('👆', mtx, mty);
    ctxCS.restore();
  }

  csState.particles.forEach(p => {
    let prx = isHost ? p.x : CS_WIDTH - p.x;
    let pry = isHost ? p.y : CS_HEIGHT - p.y;
    ctxCS.save();
    ctxCS.globalAlpha = p.alpha;
    ctxCS.fillStyle = p.color;
    ctxCS.beginPath();
    ctxCS.arc(prx, pry, p.radius, 0, Math.PI * 2);
    ctxCS.fill();
    ctxCS.restore();
  });

  if (csState.isEndingFlow) {
    ctxCS.save();
    ctxCS.fillStyle = 'rgba(211, 47, 47, 0.9)';
    ctxCS.fillRect(0, CS_HEIGHT / 2 - 40, CS_WIDTH, 80);
    ctxCS.fillStyle = '#fff';
    ctxCS.font = 'bold 36px sans-serif';
    ctxCS.textAlign = 'center';
    ctxCS.textBaseline = 'middle';
    ctxCS.fillText('終 了', CS_WIDTH / 2, CS_HEIGHT / 2);
    ctxCS.restore();
  }

  if (csState.isPlayballEffect) {
    csState.playballScale += (1.2 - csState.playballScale) * 0.15;
    ctxCS.save();
    ctxCS.translate(CS_WIDTH / 2, CS_HEIGHT / 2);
    ctxCS.scale(csState.playballScale, csState.playballScale);
    ctxCS.fillStyle = '#00b894';
    ctxCS.font = "italic 900 48px 'Impact', sans-serif";
    ctxCS.textAlign = "center";
    ctxCS.textBaseline = "middle";
    ctxCS.strokeStyle = "#ffffff";
    ctxCS.lineWidth = 4;
    ctxCS.strokeText("PLAYBALL!", 0, 0);
    ctxCS.fillText("PLAYBALL!", 0, 0);
    ctxCS.restore();
  }
}

export function processColorSortData(data) {
  if (!data) return;
  const jsonStr = JSON.stringify(data);
  totalBytesReceived += new TextEncoder().encode(jsonStr).length;

  switch (data.type) {
    case 'cs_ready':
      if (isHost && data.side === 'guest') {
        guestReady = true;
        if (colorsortStatusText && hostReady) {
          colorsortStatusText.innerText = "まもなくスタート...";
        }
        checkBothReady();
      }
      break;
    case 'cs_start':
      if (!isHost) {
        if (data.count) totalBubbles = data.count;
        startColorSort();
        triggerPlayball();
      }
      break;
    case 'cs_config_bubbles':
      if (!isHost && data.count) {
        totalBubbles = data.count;
      }
      break;
    case 'cs_config':
      if (isHost && data.rate) {
        currentSyncRate = parseInt(data.rate, 10);
      }
      break;
    case 'cs_sync_host':
      if (!isHost && csState.isPlaying) {
        if (data.d) {
          if (csState.bubbles.length === 0 && totalBubbles > 0) {
            initBubbles();
          }
          data.d.forEach((item, idx) => {
            if (csState.bubbles[idx]) {
              csState.bubbles[idx].x = item[0];
              csState.bubbles[idx].y = item[1];
              csState.bubbles[idx].inBox = item[2];
            }
          });
        }
      }
      break;
    case 'cs_sync_guest':
      if (isHost && csState.isPlaying) {
        if (data.dragId !== undefined) {
          draggedBubbleId = data.dragId;
          touchPos = { x: data.tx, y: data.ty };
          csState.bubbles.forEach(b => {
            b.grabbedBy = (b.id === draggedBubbleId) ? 'guest' : null;
          });
        }
      }
      break;
  }

  updateTrafficBadge();
}