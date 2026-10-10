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

// 自分のターンかどうかを判定（ボタン制御用）
function isMyTurn() {
    if (gameOver || players.length === 0) return false;
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
        // ホストからのアニメーション＆結果指示を受信（ゲスト側）
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
    if (!stateData) return;
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

        boardEl.appendChild(cell);
    });
}

// --------------------------------------------------
// ボタン操作
// --------------------------------------------------
function onDiceClick() {
    rollMawariDice();
}

export function rollMawariDice() {
    if (gameOver || !isMyTurn()) return;

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
// サイコロ・移動・ターン進行のシミュレーション
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

    if (steps > 0) {
        for (let i = 0; i < steps; i++) {
            const oldPos = p.pos;
            const newPos = (p.pos + 1) % 32;

            let passedStart = false;
            if (oldPos < p.startPos && newPos >= p.startPos) passedStart = true;
            else if (oldPos === 31 && newPos === 0 && p.startPos === 0) passedStart = true;

            p.pos = newPos;

            if (isKing && (newPos === p.startPos || passedStart)) {
                p.pos = p.startPos;
                isWon = true;
                break;
            }

            if (passedStart && p.rankIdx < RANKS.length - 1) {
                p.rankIdx++;
                logStr += ` (1周達成で${RANKS[p.rankIdx].name}へ昇級！)`;
            }
        }

        if (!isWon && !isKing && BOARD_CELLS[p.pos].corner && p.rankIdx < RANKS.length - 1) {
            p.rankIdx++;
            logStr += ` (角マス到達で${RANKS[p.rankIdx].name}へ昇級！)`;
        }

        if (!isWon) {
            const targets = clonedPlayers.filter(other => other.id !== p.id && other.pos === p.pos);
            if (targets.length > 0) {
                targets.forEach(t => t.pos = t.startPos);
                logStr += ` 💥 相手を踏んだ！ふりだしへ！`;
            }
        }
    }

    if (isWon) {
        currentGameOver = true;
        logStr += ` 🎉 ${p.name} が上がり達成で勝利！`;
    } else {
        if (rollRes.extraTurn) {
            logStr += ` ⭐もう一度！`;
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
        winnerName: p.name
    };
}

function executeRollAndBroadcast() {
    if (!checkIsHost() || gameOver) return;

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

    setTimeout(() => {
        players = nextState.players;
        turnIndex = nextState.turnIndex;
        gameOver = nextState.gameOver;
        lastDiceResults = nextState.lastDiceResults;
        lastLogText = nextState.lastLogText;

        if (checkIsHost()) {
            syncStateToAll();
        }

        updateUI();

        if (nextState.isWon) {
            alert(`🎉 おめでとうございます！${nextState.winnerName} が勝利しました！`);
        } else {
            checkComTurn();
        }
    }, 1200);
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
        const type = lastDiceResults[idx] || 'omote';
        el.className = `mawari-koma ${type}`;
        el.innerText = type === 'ura' ? '' : '金';
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
        diceBtn.disabled = (!isMyTurn() || gameOver);
    }
}

function checkComTurn() {
    if (!checkIsHost()) return;
    const p = players[turnIndex];
    if (p && p.type === 'com' && !gameOver) {
        setTimeout(() => executeRollAndBroadcast(), 1000);
    }
}

export function stopMawariShogi() {
    gameOver = true;
}