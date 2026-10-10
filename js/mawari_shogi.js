// mawari_shogi.js
import { sendData } from './connection.js';
import { currentGameState } from './lobby.js';

const RANKS = [
    { name: '歩', key: 'FU' },
    { name: '香', key: 'KYO' },
    { name: '桂', key: 'KEI' },
    { name: '銀', key: 'GIN' },
    { name: '金', key: 'KIN' },
    { name: '角', key: 'KAKU' },
    { name: '飛', key: 'HISHA' },
    { name: '王', key: 'GYOKU' }
];

const BOARD_CELLS = [
    {r:9, c:1, corner:true}, {r:9, c:2}, {r:9, c:3}, {r:9, c:4}, {r:9, c:5}, {r:9, c:6}, {r:9, c:7}, {r:9, c:8}, {r:9, c:9, corner:true},
    {r:8, c:9}, {r:7, c:9}, {r:6, c:9}, {r:5, c:9}, {r:4, c:9}, {r:3, c:9}, {r:2, c:9},
    {r:1, c:9, corner:true}, {r:1, c:8}, {r:1, c:7}, {r:1, c:6}, {r:1, c:5}, {r:1, c:4}, {r:1, c:3}, {r:1, c:2}, {r:1, c:1, corner:true},
    {r:2, c:1}, {r:3, c:1}, {r:4, c:1}, {r:5, c:1}, {r:6, c:1}, {r:7, c:1}, {r:8, c:1}
];

const START_POSITIONS = [0, 24, 16, 8]; 
const PLAYER_COLORS = ['#e53935', '#1e88e5', '#43a047', '#fbc02d'];

let players = [];
let turnIndex = 0;
let gameOver = false;
let isEventsRegistered = false;
let isAnimating = false; 
let lastDiceResults = ['omote', 'omote', 'omote', 'omote'];
let lastLogText = '';

function checkIsHost() {
    return typeof currentGameState !== 'undefined' && currentGameState.isHost === true;
}

// lobby.js の slots 配列から自分の slotId を正確に取得
function getMySlotId() {
    if (typeof currentGameState === 'undefined' || !currentGameState.slots) return -1;
    
    const mySlot = currentGameState.slots.find(s => s.connId === currentGameState.myConnId);
    if (mySlot !== undefined) {
        return Number(mySlot.slotId);
    }
    
    return checkIsHost() ? 0 : -1;
}

function isMyTurn() {
    if (gameOver || players.length === 0 || isAnimating) return false;
    const currentP = players[turnIndex];
    if (!currentP) return false;

    const mySlot = getMySlotId();
    if (mySlot !== -1 && Number(currentP.slotId) === mySlot) {
        return true;
    }

    if (currentGameState.myConnId && currentP.connId && currentP.connId === currentGameState.myConnId) {
        return true;
    }

    return false;
}

// --------------------------------------------------
// 通信処理
// --------------------------------------------------
function sendMawariData(type, payload = {}) {
    sendData({
        type: type,
        payload: payload
    });
}

export function syncStateToAll() {
    if (!checkIsHost()) return;
    sendMawariData("MAWARI_STATE_SYNC", {
        players: players,
        turnIndex: turnIndex,
        gameOver: gameOver,
        lastDiceResults: lastDiceResults,
        lastLogText: lastLogText
    });
}

export function updateMawariGameState(stateData) {
    if (!stateData) return;
    applyGameState(stateData);
}

export function processMawariAction(data) {
    if (!data) return;
    
    const type = data.type;
    const payload = data.payload || data;

    if (type === "MAWARI_ACTION_ROLL") {
        if (checkIsHost()) {
            const senderSlotId = payload.senderSlotId;
            const currentP = players[turnIndex];
            if (currentP && (senderSlotId === undefined || Number(currentP.slotId) === Number(senderSlotId))) {
                executeRollAndBroadcast();
            }
        }
    } else if (type === "MAWARI_START_ANIMATION") {
        const animData = payload.payload !== undefined ? payload.payload : payload;
        if (animData && animData.results && animData.nextState) {
            startRollAnimationAndApply(animData.results, animData.nextState);
        }
    } else if (type === "MAWARI_STATE_SYNC") {
        if (!checkIsHost()) {
            applyGameState(payload);
        }
    } else if (data.players) {
        applyGameState(data);
    }
}

function applyGameState(stateData) {
    if (!stateData || isAnimating) return;
    if (stateData.players) players = stateData.players;
    if (stateData.turnIndex !== undefined) turnIndex = stateData.turnIndex;
    if (stateData.gameOver !== undefined) gameOver = stateData.gameOver;
    if (stateData.lastDiceResults) lastDiceResults = stateData.lastDiceResults;
    if (stateData.lastLogText !== undefined) lastLogText = stateData.lastLogText;

    updateUI();
}

// --------------------------------------------------
// 初期化
// --------------------------------------------------
export function initMawariShogi() {
    if (!isEventsRegistered) {
        const btn = document.getElementById('btn-mawari-dice');
        if (btn) {
            btn.removeEventListener('click', onDiceClick);
            btn.addEventListener('click', onDiceClick);
        }
        isEventsRegistered = true;
    }

    const configPanel = document.getElementById('mawari-config-panel');
    if (configPanel) configPanel.style.display = 'none';

    const gameContainer = document.getElementById('mawari-game-container');
    if (gameContainer) gameContainer.style.display = 'flex';

    const rematchBtn = document.getElementById('btn-rematch-mawari');
    if (rematchBtn) rematchBtn.style.display = 'none';

    const diceBtn = document.getElementById('btn-mawari-dice');
    if (diceBtn) {
        diceBtn.style.display = 'block';
    }

    buildBoardUI();
    setupGameFromLobby();

    if (!checkIsHost()) {
        sendMawariData("MAWARI_REQUEST_SYNC", { senderSlotId: getMySlotId() });
    }
}

function setupGameFromLobby() {
    players = [];
    if (typeof currentGameState !== 'undefined' && currentGameState.slots) {
        currentGameState.slots.forEach((slot, idx) => {
            if (slot.type !== 'none') {
                const slotIdNum = slot.slotId !== undefined ? Number(slot.slotId) : idx;
                players.push({
                    id: players.length,
                    slotId: slotIdNum,
                    name: `${slotIdNum + 1}P (${slot.name})`,
                    type: slot.type,
                    connId: slot.connId || null,
                    pos: START_POSITIONS[slotIdNum % 4],
                    startPos: START_POSITIONS[slotIdNum % 4],
                    rankIdx: 0,
                    color: PLAYER_COLORS[slotIdNum % 4]
                });
            }
        });
    }

    turnIndex = 0;
    gameOver = false;
    isAnimating = false;
    lastDiceResults = ['omote', 'omote', 'omote', 'omote'];
    lastLogText = 'ゲーム開始';

    if (checkIsHost()) {
        syncStateToAll();
    }
    updateUI();
}

function buildBoardUI() {
    const boardEl = document.getElementById('mawari-board');
    if (!boardEl) return;

    boardEl.querySelectorAll('.mawari-cell').forEach(c => c.remove());

    BOARD_CELLS.forEach((data, idx) => {
        const cell = document.createElement('div');
        cell.className = 'mawari-cell' + (data.corner ? ' corner' : '');
        cell.style.gridRow = data.r;
        cell.style.gridColumn = data.c;
        cell.dataset.index = idx;

        const numSpan = document.createElement('span');
        numSpan.className = 'mawari-cell-num';
        numSpan.innerText = idx;
        cell.appendChild(numSpan);

        const pieceContainer = document.createElement('div');
        pieceContainer.className = 'mawari-piece-container';
        pieceContainer.dataset.cellIndex = idx;
        cell.appendChild(pieceContainer);

        boardEl.appendChild(cell);
    });

    // 昇格演出用オーバーレイ要素がなければ動的生成（style_2.css対応）
    if (!document.getElementById('mawari-shokaku-overlay')) {
        const overlay = document.createElement('div');
        overlay.id = 'mawari-shokaku-overlay';
        overlay.innerHTML = `
            <div id="mawari-shokaku-text">昇格！</div>
            <div id="mawari-shokaku-detail">歩 から 香 へ</div>
        `;
        boardEl.appendChild(overlay);
    }
}

// --------------------------------------------------
// ボタン操作
// --------------------------------------------------
function onDiceClick() {
    rollMawariDice();
}

export function rollMawariDice() {
    if (gameOver || !isMyTurn() || isAnimating) return;

    const diceBtn = document.getElementById('btn-mawari-dice');
    if (diceBtn) diceBtn.disabled = true;

    if (checkIsHost()) {
        executeRollAndBroadcast();
    } else {
        sendMawariData("MAWARI_ACTION_ROLL", {
            senderSlotId: getMySlotId()
        });
    }
}

// --------------------------------------------------
// サイコロ・移動ロジック（軌跡生成：重なり演出 & 昇格演出対応）
// --------------------------------------------------
function rollKomaLogic() {
    const results = [];
    let score = 0; let detailText = ""; let extraTurn = false;
    const counts = { omote: 0, ura: 0, yoko: 0, tate: 0, gyaku: 0 };

    for (let i = 0; i < 4; i++) {
        const rand = Math.random() * 100;
        let type = 'omote';
        if (rand < 55) { type = 'omote'; score += 1; }
        else if (rand < 90) { type = 'ura'; }
        else if (rand < 96) { type = 'yoko'; score += 3; }
        else if (rand < 99) { type = 'tate'; score += 6; }
        else { type = 'gyaku'; score += 12; }
        results.push(type); counts[type]++;
    }

    if (counts.ura === 4) {
        score = 5; 
        detailText = "✨ 【総裏】 5マス進む！（もう一度振れます）"; 
        extraTurn = true;
    } else if (counts.omote === 4) {
        score = 10; 
        detailText = "✨ 【総表】 10マス進む！（もう一度振れます）"; 
        extraTurn = true;
    } else {
        const parts = [];
        if (counts.omote > 0) parts.push(`表×${counts.omote}(${counts.omote}点)`);
        if (counts.yoko > 0)  parts.push(`横立×${counts.yoko}(${counts.yoko * 3}点)`);
        if (counts.tate > 0)  parts.push(`縦立×${counts.tate}(${counts.tate * 6}点)`);
        if (counts.gyaku > 0) parts.push(`逆立×${counts.gyaku}(${counts.gyaku * 12}点)`);
        if (counts.ura > 0 && parts.length === 0) parts.push(`裏×${counts.ura}(0点)`);
        detailText = `${parts.join(' + ')} ＝ ${score}マス進む`;
    }
    return { score, detailText, results, extraTurn };
}

function calculateNextState(rollRes) {
    const clonedPlayers = JSON.parse(JSON.stringify(players));
    const p = clonedPlayers[turnIndex];
    let currentTurnIndex = turnIndex;
    let currentGameOver = gameOver;
    let logStr = `${p.name}: ${rollRes.detailText}`;
    let isWon = false;

    const steps = rollRes.score;
    const isKing = (p.rankIdx === RANKS.length - 1);
    const path = []; 

    if (steps > 0) {
        for (let i = 0; i < steps; i++) {
            const oldPos = p.pos;
            const newPos = (p.pos + 1) % 32;

            let passedStart = false;
            if (oldPos < p.startPos && newPos >= p.startPos) passedStart = true;
            else if (oldPos === 31 && newPos === 0 && p.startPos === 0) passedStart = true;

            p.pos = newPos;

            let promotedThisStep = false;
            let promotionName = "";

            if (isKing && (newPos === p.startPos || passedStart)) {
                p.pos = p.startPos;
                isWon = true;
                path.push({
                    players: JSON.parse(JSON.stringify(clonedPlayers)),
                    logText: logStr + ` 🎉 ${p.name} が上がり達成で勝利！`,
                    shokaku: null
                });
                break;
            }

            if (passedStart && p.rankIdx < RANKS.length - 1) {
                p.rankIdx++;
                promotedThisStep = true;
                promotionName = RANKS[p.rankIdx].name;
                logStr = `${p.name}: ${rollRes.detailText} (1周達成で${promotionName}へ昇級！)`;
            }

            path.push({
                players: JSON.parse(JSON.stringify(clonedPlayers)),
                logText: logStr,
                shokaku: promotedThisStep ? promotionName : null
            });
        }

        if (!isWon) {
            let promotedThisStep = false;
            let promotionName = "";

            if (!isKing && BOARD_CELLS[p.pos].corner && p.rankIdx < RANKS.length - 1) {
                p.rankIdx++;
                promotedThisStep = true;
                promotionName = RANKS[p.rankIdx].name;
                logStr += ` (角マス到達で${promotionName}へ昇級！)`;
            }

            // 相手の駒を踏んだかどうかの判定
            const opponentsOnSameSpot = clonedPlayers.filter(other => other.id !== p.id && other.pos === p.pos);
            if (opponentsOnSameSpot.length > 0) {
                // 1. まず「重なった瞬間」をパスに1フレーム追加
                path.push({
                    players: JSON.parse(JSON.stringify(clonedPlayers)),
                    logText: logStr + ` 💥 ${p.name} が相手のマスに重なった！`,
                    shokaku: promotedThisStep ? promotionName : null
                });

                // 2. 相手をスタート位置（ふりだし）に戻す
                opponentsOnSameSpot.forEach(t => t.pos = t.startPos);
                logStr += ` 💥 相手を踏んだ！ふりだしへ！`;

                // 3. 戻された後の状態をパスに追加
                path.push({
                    players: JSON.parse(JSON.stringify(clonedPlayers)),
                    logText: logStr,
                    shokaku: null
                });
            } else if (path.length > 0) {
                path[path.length - 1].players = JSON.parse(JSON.stringify(clonedPlayers));
                path[path.length - 1].logText = logStr;
                if (promotedThisStep) {
                    path[path.length - 1].shokaku = promotionName;
                }
            }
        }
    } else {
        path.push({
            players: JSON.parse(JSON.stringify(clonedPlayers)),
            logText: logStr,
            shokaku: null
        });
    }

    if (isWon) {
        currentGameOver = true;
    } else {
        if (rollRes.extraTurn) {
            logStr += ` ⭐もう一度！`;
            if (path.length > 0) path[path.length - 1].logText = logStr;
        } else {
            currentTurnIndex = (currentTurnIndex + 1) % clonedPlayers.length;
        }
    }

    return {
        players: clonedPlayers,
        turnIndex: currentTurnIndex,
        gameOver: currentGameOver,
        lastDiceResults: rollRes.results,
        lastLogText: logStr,
        isWon: isWon,
        winnerName: p.name,
        path: path
    };
}

function executeRollAndBroadcast() {
    if (!checkIsHost() || gameOver || isAnimating) return;

    const rollRes = rollKomaLogic();
    const nextState = calculateNextState(rollRes);

    startRollAnimationAndApply(rollRes.results, nextState);
    sendMawariData("MAWARI_START_ANIMATION", {
        results: rollRes.results,
        nextState: nextState
    });
}

// --------------------------------------------------
// アニメーション実行と結果の確定
// --------------------------------------------------
function startRollAnimationAndApply(results, nextState) {
    isAnimating = true;

    const komaEls = document.querySelectorAll('.mawari-koma');
    komaEls.forEach(el => {
        el.className = 'mawari-koma rolling';
        el.innerText = '金';
    });

    const activeP = players[turnIndex];
    const logEl = document.getElementById('mawari-log-text');
    if (logEl) {
        logEl.innerText = `${activeP ? activeP.name : ''} が金を振っています...`;
    }

    const diceBtn = document.getElementById('btn-mawari-dice');
    if (diceBtn) diceBtn.disabled = true;

    // 1.2秒間金駒を回転
    setTimeout(() => {
        lastDiceResults = results;
        komaEls.forEach((el, idx) => {
            el.classList.remove('rolling');
            const type = lastDiceResults[idx] || 'omote';
            el.className = `mawari-koma ${type}`;
            el.innerText = type === 'ura' ? '' : '金';
        });

        const path = nextState.path || [];
        if (path.length === 0) {
            finalizeState(nextState);
            return;
        }

        // 0.25秒ごとに1歩ずつ進めるステップアニメーション
        let stepIdx = 0;
        const intervalId = setInterval(() => {
            if (stepIdx < path.length) {
                const step = path[stepIdx];
                players = step.players;
                lastLogText = step.logText;
                updateUI();

                // 昇格が発生したステップならポップアップ演出を表示
                if (step.shokaku) {
                    showShokakuOverlay(step.shokaku);
                }

                stepIdx++;
            } else {
                clearInterval(intervalId);
                finalizeState(nextState);
            }
        }, 250);

    }, 1200);
}

// 昇格ポップアップ演出のトリガー（style_2.cssのkeyframes連動）[cite: 7]
function showShokakuOverlay(rankName) {
    const overlay = document.getElementById('mawari-shokaku-overlay');
    const textEl = document.getElementById('mawari-shokaku-text');
    const detailEl = document.getElementById('mawari-shokaku-detail');
    if (!overlay || !textEl) return;

    if (detailEl) detailEl.innerText = `${rankName} へ昇格！`;

    // アニメーションを再トリガーするため一旦displayをnoneにしてリセット
    overlay.style.display = 'block';
    textEl.style.animation = 'none';
    textEl.offsetHeight; // reflow
    textEl.style.animation = 'mawari-popShokaku 0.8s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards';

    setTimeout(() => {
        overlay.style.display = 'none';
    }, 1000);
}

function finalizeState(nextState) {
    players = nextState.players;
    turnIndex = nextState.turnIndex;
    gameOver = nextState.gameOver;
    lastDiceResults = nextState.lastDiceResults;
    lastLogText = nextState.lastLogText;

    isAnimating = false;

    if (checkIsHost()) {
        syncStateToAll();
    }

    updateUI();

    if (nextState.isWon) {
        alert(`🎉 おめでとうございます！${nextState.winnerName} が勝利しました！`);
    } else {
        checkComTurn();
    }
}

// --------------------------------------------------
// UI画面更新
// --------------------------------------------------
function updateUI() {
    if (players.length === 0) return;
    const p = players[turnIndex];

    const badge = document.getElementById('mawari-turn-badge');
    if (badge) {
        badge.innerText = gameOver ? `🏆 ゲーム終了` : `ターン: ${p.name} (${RANKS[p.rankIdx].name})`;
        badge.style.backgroundColor = p.color;
    }

    const komaEls = document.querySelectorAll('.mawari-koma');
    komaEls.forEach((el, idx) => {
        if (!el.classList.contains('rolling')) {
            const type = lastDiceResults[idx] || 'omote';
            el.className = `mawari-koma ${type}`;
            el.innerText = type === 'ura' ? '' : '金';
        }
    });

    const containers = document.querySelectorAll('.mawari-piece-container');
    containers.forEach(container => {
        container.innerHTML = '';
    });

    players.forEach(pl => {
        const targetContainer = document.querySelector(`.mawari-piece-container[data-cell-index="${pl.pos}"]`);
        if (targetContainer) {
            const pieceEl = document.createElement('div');
            pieceEl.className = 'mawari-piece';
            pieceEl.style.backgroundColor = pl.color;
            pieceEl.innerText = RANKS[pl.rankIdx].name;
            targetContainer.appendChild(pieceEl);
        }
    });

    const logEl = document.getElementById('mawari-log-text');
    if (logEl) {
        logEl.innerText = lastLogText;
    }

    const listEl = document.getElementById('mawari-player-list');
    if (listEl) {
        listEl.innerHTML = '';
        players.forEach((pl, idx) => {
            const card = document.createElement('div');
            card.className = 'mawari-player-card' + (idx === turnIndex ? ' active' : '');
            card.style.borderLeftColor = pl.color;
            card.innerText = `${pl.name}: ${RANKS[pl.rankIdx].name} [現在地: ${pl.pos}マス目]`;
            listEl.appendChild(card);
        });
    }

    const diceBtn = document.getElementById('btn-mawari-dice');
    if (diceBtn) {
        diceBtn.disabled = (!isMyTurn() || gameOver || isAnimating);
    }
}

function checkComTurn() {
    if (!checkIsHost()) return;
    const p = players[turnIndex];
    if (p && p.type === 'com' && !gameOver && !isAnimating) {
        setTimeout(() => executeRollAndBroadcast(), 1000);
    }
}

export function stopMawariShogi() {
    gameOver = true;
}