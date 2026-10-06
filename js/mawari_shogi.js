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
// 統一カラー: 1P赤, 2P青, 3P緑, 4P黄
const PLAYER_COLORS = ['#e53935', '#1e88e5', '#43a047', '#fbc02d'];

let players = [];
let turnIndex = 0;
let isRolling = false;
let gameOver = false;
let isEventsRegistered = false;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export function initMawariShogi() {
    if (!isEventsRegistered) {
        document.getElementById('btn-mawari-dice').addEventListener('click', onDiceClick);
        isEventsRegistered = true;
    }

    const configPanel = document.getElementById('mawari-config-panel');
    if (configPanel) configPanel.style.display = 'none';

    document.getElementById('mawari-game-container').style.display = 'flex';
    document.getElementById('btn-rematch-mawari').style.display = 'none';
    
    const boardEl = document.getElementById('mawari-board');
    boardEl.querySelectorAll('.mawari-cell').forEach(c => c.remove());
    document.getElementById('mawari-player-list').innerHTML = '';

    if (currentGameState.isHost) {
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

    syncStateToAll();
    updateUI();
    checkComTurn();
}

export function syncStateToAll() {
    if (!currentGameState.isHost) return;
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

export function updateMawariGameState(payload) {
    players = payload.players;
    turnIndex = payload.turnIndex;
    gameOver = payload.gameOver;
    isRolling = payload.isRolling;

    const boardEl = document.getElementById('mawari-board');
    if (boardEl.querySelectorAll('.mawari-cell').length === 0) {
        buildBoardUI();
    }
    renderPieces();
    updateUI();
}

function buildBoardUI() {
    const boardEl = document.getElementById('mawari-board');
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
    listEl.innerHTML = '';
    players.forEach((p, idx) => {
        const card = document.createElement('div');
        card.className = 'mawari-player-card' + (idx === turnIndex ? ' active' : '');
        card.style.borderLeftColor = p.color;
        card.innerText = `${p.name}: ${RANKS[p.rankIdx].name}`;
        listEl.appendChild(card);
    });
}

function onDiceClick() {
    if (currentGameState.isHost) {
        handleRoll();
    } else {
        sendData({ type: "MAWARI_ACTION_ROLL" });
    }
}

export function processMawariAction(data) {
    if (data.type === "MAWARI_ACTION_ROLL" && currentGameState.isHost) {
        handleRoll();
    }
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
    if (isRolling || gameOver) return;
    const p = players[turnIndex];
    isRolling = true;
    if (currentGameState.isHost) syncStateToAll();

    document.getElementById('btn-mawari-dice').disabled = true;

    const komaEls = document.querySelectorAll('.mawari-koma');
    komaEls.forEach(el => { el.className = 'mawari-koma rolling'; el.innerText = '金'; });

    await sleep(700);
    const result = rollKomaLogic();

    komaEls.forEach((el, idx) => {
        const type = result.results[idx];
        el.className = `mawari-koma ${type}`;
        el.innerText = type === 'ura' ? '' : '金';
    });

    document.getElementById('mawari-log-text').innerText = result.detailText;
    await sleep(400);

    const hasWon = await movePlayerStepByStep(p, result.score);

    if (hasWon) {
        gameOver = true;
        document.getElementById('mawari-turn-badge').innerText = `🏆 ${p.name} の勝利！`;
        const rematchBtn = document.getElementById('btn-rematch-mawari');
        if (rematchBtn && currentGameState.isHost) {
            rematchBtn.style.display = 'block';
        }        
        if (currentGameState.isHost) syncStateToAll();
        await sleep(200); 
        alert(`🎉 おめでとうございます！${p.name} が上がり達成で勝利しました！`);
        return;
    }

    await checkOverlap(p);
    isRolling = false;

    if (result.extraTurn && !gameOver) {
        document.getElementById('mawari-log-text').innerText += " ⭐もう一度！";
        if (currentGameState.isHost) syncStateToAll();
        updateUI();
        checkComTurn();
    } else {
        nextTurn();
    }
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
        document.getElementById('mawari-log-text').innerText += ` 💥 相手を踏んだ！ふりだしへ！`;
        await sleep(700);
        targets.forEach(target => target.pos = target.startPos);
        renderPieces();
    }
}

function nextTurn() {
    turnIndex = (turnIndex + 1) % players.length;
    if (currentGameState.isHost) syncStateToAll();
    updateUI();
    checkComTurn();
}

function updateUI() {
    if (players.length === 0) return;
    const p = players[turnIndex];
    const badge = document.getElementById('mawari-turn-badge');
    badge.innerText = `ターン: ${p.name} (${RANKS[p.rankIdx].name})`;
    badge.style.backgroundColor = p.color;

    const isMyTurn = (p.connId === currentGameState.myConnId) || (p.type === 'host' && currentGameState.isHost);
    document.getElementById('btn-mawari-dice').disabled = (!isMyTurn || isRolling || gameOver || p.type === 'com');
    
    renderPieces();
}

function checkComTurn() {
    if (!currentGameState.isHost) return;
    const p = players[turnIndex];
    if (p && p.type === 'com' && !gameOver) {
        setTimeout(() => handleRoll(), 1200);
    }
}

export function stopMawariShogi() {
    gameOver = true; 
}

export const rollMawariDice = handleRoll;