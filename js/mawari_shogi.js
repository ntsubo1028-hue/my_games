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
let isRolling = false;
let gameOver = false;
let isEventsRegistered = false;

// 演出中に届いた同期データを保持する変数
let pendingStateSync = null;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ホスト判定の厳格化関数
function checkIsHost() {
    return typeof currentGameState !== 'undefined' && currentGameState.isHost === true;
}

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

    document.getElementById('mawari-game-container').style.display = 'flex';
    document.getElementById('btn-rematch-mawari').style.display = 'none';

    buildBoardUI();

    if (checkIsHost()) {
        setupGameFromLobby();
    }
}

function setupGameFromLobby() {
    players = [];
    currentGameState.slots.forEach((slot, idx) => {
        if (slot.type !== 'none') {
            players.push({
                id: idx,
                slotId: slot.slotId,
                name: `${slot.slotId + 1}P (${slot.name})`,
                type: slot.type,
                connId: slot.connId,
                pos: START_POSITIONS[idx],
                startPos: START_POSITIONS[idx],
                rankIdx: 0,
                color: PLAYER_COLORS[idx]
            });
        }
    });

    buildBoardUI();
    turnIndex = 0;
    gameOver = false;
    isRolling = false;
    pendingStateSync = null;

    syncStateToAll();
    updateUI();
    checkComTurn();
}

export function syncStateToAll() {
    if (!checkIsHost()) return;
    sendData({
        type: "MAWARI_STATE_SYNC",
        payload: {
            players: players,
            turnIndex: turnIndex,
            gameOver: gameOver,
            isRolling: isRolling
        }
    });
}

// 通信データの受信（汎用ルーティング対応）
export function updateMawariGameState(payload) {
    if (!payload) return;
    if (payload.type) {
        processMawariAction(payload);
        return;
    }
    const stateData = payload.payload || payload;
    if (isRolling) {
        pendingStateSync = stateData;
        return;
    }
    applyGameState(stateData);
}

export function processMawariAction(data) {
    if (!data) return;
    const type = data.type;
    const payload = data.payload || data;

    if (type === "MAWARI_ACTION_ROLL") {
        if (checkIsHost()) {
            handleRoll();
        }
    } else if (type === "MAWARI_ROLL_RESULT") {
        if (!checkIsHost()) {
            executeRollSequenceForGuest(payload);
        }
    } else if (type === "MAWARI_STATE_SYNC") {
        if (!checkIsHost()) {
            updateMawariGameState(payload);
        }
    }
}

function applyGameState(payload) {
    if (!payload || !payload.players) return;
    players = payload.players;
    turnIndex = payload.turnIndex;
    gameOver = payload.gameOver;
    isRolling = payload.isRolling;

    const boardEl = document.getElementById('mawari-board');
    if (!boardEl || boardEl.querySelectorAll('.mawari-cell').length === 0) {
        buildBoardUI();
    }
    renderPieces();
    updateUI();
}

function buildBoardUI() {
    const boardEl = document.getElementById('mawari-board');
    if (!boardEl) return;
    boardEl.innerHTML = ''; // 盤面をクリアして再構築

    // 1. 盤面マス（32個）の構築
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

        const pieceCont = document.createElement('div');
        pieceCont.className = 'mawari-piece-container';
        cell.appendChild(pieceCont);

        boardEl.appendChild(cell);
    });

    // 2. 中央のサイコロエリア（金4枚）を動的生成（ホスト・ゲスト共通で確実に配置）
    let diceArea = boardEl.querySelector('.mawari-dice-area');
    if (!diceArea) {
        diceArea = document.createElement('div');
        diceArea.className = 'mawari-dice-area';
        diceArea.style.gridRow = '4 / 7';
        diceArea.style.gridColumn = '4 / 7';
        diceArea.style.display = 'flex';
        diceArea.style.justifyContent = 'center';
        diceArea.style.alignItems = 'center';
        diceArea.style.gap = '8px';
        diceArea.style.flexWrap = 'wrap';

        for (let i = 0; i < 4; i++) {
            const koma = document.createElement('div');
            koma.className = 'mawari-koma';
            koma.innerText = '金';
            diceArea.appendChild(koma);
        }
        boardEl.appendChild(diceArea);
    }

    renderPieces();
}

function renderPieces() {
    document.querySelectorAll('.mawari-piece-container').forEach(c => c.innerHTML = '');

    document.querySelectorAll('.mawari-cell').forEach(c => {
        c.classList.remove('goal-highlight');
        c.style.removeProperty('--goal-color');
        const badge = c.querySelector('.mawari-goal-badge');
        if (badge) badge.remove();
    });

    players.forEach(p => {
        if (p.rankIdx === RANKS.length - 1) {
            const goalCell = document.querySelector(`.mawari-cell[data-index="${p.startPos}"]`);
            if (goalCell) {
                goalCell.classList.add('goal-highlight');
                goalCell.style.setProperty('--goal-color', p.color);
                if (!goalCell.querySelector('.mawari-goal-badge')) {
                    const badge = document.createElement('div');
                    badge.className = 'mawari-goal-badge';
                    badge.style.backgroundColor = p.color;
                    badge.innerText = `GOAL(${p.name})`;
                    goalCell.appendChild(badge);
                }
            }
        }

        const cell = document.querySelector(`.mawari-cell[data-index="${p.pos}"] .mawari-piece-container`);
        if (cell) {
            const piece = document.createElement('div');
            piece.className = 'mawari-piece';
            piece.id = `mawari-piece-player-${p.id}`;
            piece.style.backgroundColor = p.color;
            piece.innerText = RANKS[p.rankIdx].name;
            cell.appendChild(piece);
        }
    });

    const listEl = document.getElementById('mawari-player-list');
    if (listEl) {
        listEl.innerHTML = '';
        players.forEach((p, idx) => {
            const card = document.createElement('div');
            card.className = 'mawari-player-card' + (idx === turnIndex ? ' active' : '');
            card.style.borderLeftColor = p.color;
            card.innerText = `${p.name}: ${RANKS[p.rankIdx].name}`;
            listEl.appendChild(card);
        });
    }
}

function onDiceClick() {
    rollMawariDice();
}

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
        score = 5; detailText = "✨ 【総裏】 5マス進む！（もう一度）"; extraTurn = true;
    } else if (counts.omote === 4) {
        score = 10; detailText = "✨ 【総表】 10マス進む！（もう一度）"; extraTurn = true;
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

async function handleRoll() {
    // ゲストからの直接実行を防止
    if (!checkIsHost()) {
        sendData({ type: "MAWARI_ACTION_ROLL" });
        return;
    }

    if (isRolling || gameOver) return;
    isRolling = true;

    const result = rollKomaLogic();
    const currentTurnIdx = turnIndex;

    // 全ゲストへ計算結果と演出実行コマンドを送信
    sendData({
        type: "MAWARI_ROLL_RESULT",
        payload: {
            turnIndex: currentTurnIdx,
            result: result
        }
    });

    // ホスト側の画面演出・一歩ずつの駒移動
    const hasWon = await playRollSequence(currentTurnIdx, result);

    if (hasWon) {
        gameOver = true;
        syncStateToAll();
        return;
    }

    isRolling = false;

    if (result.extraTurn && !gameOver) {
        const logText = document.getElementById('mawari-log-text');
        if (logText) logText.innerText += " ⭐もう一度！";
        syncStateToAll();
        updateUI();
        checkComTurn();
    } else {
        nextTurn();
    }
}

async function executeRollSequenceForGuest(payload) {
    if (isRolling) return;
    isRolling = true;

    if (payload && payload.turnIndex !== undefined) {
        turnIndex = payload.turnIndex;
    }
    updateUI();

    // ゲスト側画面でホストから受け取った結果に基づき演出再生
    await playRollSequence(turnIndex, payload.result);
    
    isRolling = false;

    // 演出終了後、保留されていた最新盤面同期を反映
    if (pendingStateSync) {
        applyGameState(pendingStateSync);
        pendingStateSync = null;
    } else {
        updateUI();
    }
}

async function playRollSequence(targetTurnIdx, result) {
    const p = players[targetTurnIdx];
    if (!p) return false;

    const btn = document.getElementById('btn-mawari-dice');
    if (btn) btn.disabled = true;

    // 1. サイコロ（金4枚）回転アニメーション
    const komaEls = document.querySelectorAll('.mawari-koma');
    komaEls.forEach(el => { el.className = 'mawari-koma rolling'; el.innerText = '金'; });

    await sleep(700);

    // 2. 出目の確定表示とログ表示
    if (result && result.results) {
        komaEls.forEach((el, idx) => {
            const type = result.results[idx] || 'omote';
            el.className = `mawari-koma ${type}`;
            el.innerText = type === 'ura' ? '' : '金';
        });
    }

    const logEl = document.getElementById('mawari-log-text');
    if (logEl && result && result.detailText) {
        logEl.innerText = result.detailText;
    }
    await sleep(400);

    // 3. 一歩ずつの駒移動演出
    const score = (result && typeof result.score === 'number') ? result.score : 0;
    const hasWon = await movePlayerStepByStep(p, score);

    if (hasWon) {
        gameOver = true;
        const badge = document.getElementById('mawari-turn-badge');
        if (badge) badge.innerText = `🏆 ${p.name} の勝利！`;
        const rematchBtn = document.getElementById('btn-rematch-mawari');
        if (rematchBtn && checkIsHost()) {
            rematchBtn.style.display = 'block';
        }
        await sleep(200); 
        alert(`🎉 おめでとうございます！${p.name} が上がり達成で勝利しました！`);
        return true;
    }

    // 4. 重なり（踏みつけ）チェック
    await checkOverlap(p);
    return false;
}

async function movePlayerStepByStep(player, steps) {
    if (steps === 0) return false;
    const isKing = (player.rankIdx === RANKS.length - 1);

    for (let i = 0; i < steps; i++) {
        const oldPos = player.pos;
        const newPos = (player.pos + 1) % 32;

        let passedStart = false;
        if (oldPos < player.startPos && newPos >= player.startPos) passedStart = true;
        else if (oldPos === 31 && newPos === 0 && player.startPos === 0) passedStart = true;

        player.pos = newPos;
        renderPieces();

        if (isKing && (newPos === player.startPos || passedStart)) {
            player.pos = player.startPos; 
            renderPieces();
            await sleep(400); 
            return true; 
        }

        if (passedStart && player.rankIdx < RANKS.length - 1) {
            const oldRank = RANKS[player.rankIdx].name;
            player.rankIdx++;
            const newRank = RANKS[player.rankIdx].name;
            renderPieces();
            await showShokakuEffect(oldRank, newRank, "1周達成！");
        } else {
            await sleep(200);
        }
    }

    if (!isKing && BOARD_CELLS[player.pos].corner && player.rankIdx < RANKS.length - 1) {
        const oldRank = RANKS[player.rankIdx].name;
        player.rankIdx++;
        const newRank = RANKS[player.rankIdx].name;
        renderPieces();
        await showShokakuEffect(oldRank, newRank, "角マス到達！");
    }
    return false;
}

async function showShokakuEffect(oldRank, newRank, reason = "昇級達成") {
    const overlay = document.getElementById('mawari-shokaku-overlay');
    const detail = document.getElementById('mawari-shokaku-detail');
    if (overlay && detail) {
        detail.innerText = `${reason} (${oldRank} ➔ ${newRank})`;
        overlay.style.display = 'block';
        await sleep(1200);
        overlay.style.display = 'none';
    }
}

async function checkOverlap(currentPlayer) {
    const targets = players.filter(p => p.id !== currentPlayer.id && p.pos === currentPlayer.pos);
    if (targets.length > 0) {
        for (const target of targets) {
            const pieceEl = document.getElementById(`mawari-piece-player-${target.id}`);
            if (pieceEl) pieceEl.classList.add('blown-away');
        }
        const logEl = document.getElementById('mawari-log-text');
        if (logEl) logEl.innerText += ` 💥 相手を踏んだ！ふりだしへ！`;
        await sleep(700);
        targets.forEach(target => target.pos = target.startPos);
        renderPieces();
    }
}

function nextTurn() {
    turnIndex = (turnIndex + 1) % players.length;
    if (checkIsHost()) syncStateToAll();
    updateUI();
    checkComTurn();
}

function updateUI() {
    if (players.length === 0) return;
    const p = players[turnIndex];
    const badge = document.getElementById('mawari-turn-badge');
    if (badge) {
        badge.innerText = `ターン: ${p.name} (${RANKS[p.rankIdx].name})`;
        badge.style.backgroundColor = p.color;
    }

    const isMyTurn = (p.connId === currentGameState.myConnId) || (p.type === 'host' && checkIsHost());
    const diceBtn = document.getElementById('btn-mawari-dice');
    if (diceBtn) {
        diceBtn.disabled = (!isMyTurn || isRolling || gameOver || p.type === 'com');
    }
    
    renderPieces();
}

function checkComTurn() {
    if (!checkIsHost()) return;
    const p = players[turnIndex];
    if (p && p.type === 'com' && !gameOver) {
        setTimeout(() => handleRoll(), 1200);
    }
}

export function stopMawariShogi() {
    gameOver = true; 
}

export function rollMawariDice() {
    if (checkIsHost()) {
        handleRoll();
    } else {
        sendData({ type: "MAWARI_ACTION_ROLL" });
    }
}