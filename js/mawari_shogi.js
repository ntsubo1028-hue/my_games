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

// 演出中に受信した同期データの一時保持用
let pendingStateSync = null;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function checkIsHost() {
    return typeof currentGameState !== 'undefined' && currentGameState.isHost === true;
}

// --------------------------------------------------
// 初期化 & UI構築
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
        diceBtn.style.position = 'relative';
        diceBtn.style.zIndex = '100';
    }

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
                slotId: slot.slotId !== undefined ? slot.slotId : idx,
                name: `${idx + 1}P (${slot.name})`,
                type: slot.type,
                connId: slot.connId,
                pos: START_POSITIONS[idx],
                startPos: START_POSITIONS[idx],
                rankIdx: 0,
                color: PLAYER_COLORS[idx]
            });
        }
    });

    turnIndex = 0;
    gameOver = false;
    isRolling = false;
    pendingStateSync = null;

    buildBoardUI();
    syncStateToAll();
    updateUI();
    checkComTurn();
}

function buildBoardUI() {
    const boardEl = document.getElementById('mawari-board');
    if (!boardEl) return;

    // 1. 既存セルおよび金駒ダイスエリアを完全に消去（重複生成の根絶）
    boardEl.querySelectorAll('.mawari-cell').forEach(c => c.remove());
    boardEl.querySelectorAll('.mawari-dice-area').forEach(d => d.remove());

    // 2. 盤面マス（32マス）の生成
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

    // 3. 中央の金駒エリア（4枚固定）を正しく配置
    const diceArea = document.createElement('div');
    diceArea.className = 'mawari-dice-area';
    diceArea.style.gridRow = '4 / 7';
    diceArea.style.gridColumn = '4 / 7';
    diceArea.style.display = 'flex';
    diceArea.style.justifyContent = 'center';
    diceArea.style.alignItems = 'center';
    diceArea.style.gap = '6px';
    diceArea.style.flexWrap = 'nowrap';
    diceArea.style.whiteSpace = 'nowrap';

    for (let i = 0; i < 4; i++) {
        const koma = document.createElement('div');
        koma.className = 'mawari-koma';
        koma.innerText = '金';
        diceArea.appendChild(koma);
    }
    boardEl.appendChild(diceArea);

    renderPieces();
}

// --------------------------------------------------
// 通信・メッセージ処理
// --------------------------------------------------
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

export function updateMawariGameState(data) {
    processMawariAction(data);
}

export function processMawariAction(data) {
    if (!data) return;
    
    // データ構造の揺らぎ（直接渡しか payload ラップか）を吸収
    const msgType = data.type || (data.payload && data.payload.type);
    const payload = data.payload !== undefined ? data.payload : data;

    if (msgType === "MAWARI_ACTION_ROLL") {
        if (checkIsHost()) {
            handleRoll();
        }
    } else if (msgType === "MAWARI_ROLL_RESULT") {
        // ホストからのサイコロ結果・移動命令を受信
        const rollData = payload.payload || payload;
        executeRollSequence(rollData);
    } else if (msgType === "MAWARI_STATE_SYNC") {
        if (!checkIsHost()) {
            const stateData = payload.payload || payload;
            if (isRolling) {
                // アニメーション中は状態上書き（ワープ）を防ぐため保留
                pendingStateSync = stateData;
            } else {
                applyGameState(stateData);
            }
        }
    }
}

function applyGameState(stateData) {
    if (!stateData || !stateData.players) return;
    players = stateData.players;
    turnIndex = stateData.turnIndex;
    gameOver = stateData.gameOver;
    
    const boardEl = document.getElementById('mawari-board');
    if (!boardEl || boardEl.querySelectorAll('.mawari-cell').length === 0) {
        buildBoardUI();
    }
    
    renderPieces();
    updateUI();
}

// --------------------------------------------------
// サイコロ処理
// --------------------------------------------------
function onDiceClick() {
    rollMawariDice();
}

export function rollMawariDice() {
    if (isRolling || gameOver) return;

    if (checkIsHost()) {
        handleRoll();
    } else {
        sendData({ type: "MAWARI_ACTION_ROLL" });
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

    const result = rollKomaLogic();
    const currentTurnIdx = turnIndex;

    const rollPayload = {
        turnIndex: currentTurnIdx,
        result: result,
        playersState: JSON.parse(JSON.stringify(players)) // 演出開始時点の正確なプレイヤー状態
    };

    // 1. ゲスト全員に結果とアニメーション命令を発信
    sendData({
        type: "MAWARI_ROLL_RESULT",
        payload: rollPayload
    });

    // 2. ホスト側もアニメーションを実行
    await executeRollSequence(rollPayload);

    // 3. ターン進行処理（ホスト主導）
    if (checkIsHost()) {
        if (gameOver) {
            syncStateToAll();
            return;
        }

        if (result.extraTurn) {
            const logText = document.getElementById('mawari-log-text');
            if (logText) logText.innerText += " ⭐もう一度！";
            syncStateToAll();
            updateUI();
            checkComTurn();
        } else {
            nextTurn();
        }
    }
}

// --------------------------------------------------
// 演出 & 一歩移動シーケンス（ホスト・ゲスト完全共通）
// --------------------------------------------------
async function executeRollSequence(payload) {
    if (isRolling) return;
    isRolling = true;

    if (payload && payload.turnIndex !== undefined) {
        turnIndex = payload.turnIndex;
    }
    if (payload && payload.playersState) {
        players = payload.playersState;
    }

    updateUI();

    const result = payload.result;
    const p = players[turnIndex];

    if (!p) {
        isRolling = false;
        return;
    }

    const btn = document.getElementById('btn-mawari-dice');
    if (btn) btn.disabled = true;

    // A. 金駒回転アニメーション (700ms)
    const komaEls = document.querySelectorAll('.mawari-koma');
    komaEls.forEach(el => { el.className = 'mawari-koma rolling'; el.innerText = '金'; });

    await sleep(700);

    // B. 出目の結果表示とログ出力
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

    // C. 1マスずつの滑らかなステップ移動（ゲストもワープせず順番に進む）
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
        isRolling = false;
        return;
    }

    // D. 踏みつけ判定
    await checkOverlap(p);

    isRolling = false;

    // 演出中に届いていた最新同期データがあれば適用
    if (pendingStateSync) {
        applyGameState(pendingStateSync);
        pendingStateSync = null;
    } else {
        updateUI();
    }
}

// --------------------------------------------------
// 移動・昇級・踏みつけロジック
// --------------------------------------------------
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

        // 上がり（勝利）チェック
        if (isKing && (newPos === player.startPos || passedStart)) {
            player.pos = player.startPos;
            renderPieces();
            await sleep(400);
            return true;
        }

        // 周回による昇級
        if (passedStart && player.rankIdx < RANKS.length - 1) {
            const oldRank = RANKS[player.rankIdx].name;
            player.rankIdx++;
            const newRank = RANKS[player.rankIdx].name;
            renderPieces();
            await showShokakuEffect(oldRank, newRank, "1周達成！");
        } else {
            await sleep(200); // 1マスの移動スピード
        }
    }

    // 角マス到達による昇級
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

// --------------------------------------------------
// ターン管理 & UIレンダリング
// --------------------------------------------------
function nextTurn() {
    turnIndex = (turnIndex + 1) % players.length;
    if (checkIsHost()) syncStateToAll();
    updateUI();
    checkComTurn();
}

function updateUI() {
    if (players.length === 0) return;
    const p = players[turnIndex];

    // 1. ターンバッジの更新
    const badge = document.getElementById('mawari-turn-badge');
    if (badge) {
        badge.innerText = `ターン: ${p.name} (${RANKS[p.rankIdx].name})`;
        badge.style.backgroundColor = p.color;
    }

    // 2. ボタンの有効/無効の判定
    let isMyTurn = false;
    const myConnId = typeof currentGameState !== 'undefined' ? currentGameState.myConnId : undefined;
    const mySlotId = typeof currentGameState !== 'undefined' ? currentGameState.mySlotId : undefined;

    if (checkIsHost()) {
        isMyTurn = (p.type !== 'com') && (p.id === 0 || p.connId === myConnId || (mySlotId !== undefined && p.slotId === mySlotId) || p.type === 'host');
    } else {
        if (myConnId && p.connId === myConnId) {
            isMyTurn = true;
        } else if (mySlotId !== undefined && p.slotId === mySlotId) {
            isMyTurn = true;
        } else if (p.type === 'human') {
            isMyTurn = true;
        }
    }

    const diceBtn = document.getElementById('btn-mawari-dice');
    if (diceBtn) {
        diceBtn.disabled = (!isMyTurn || isRolling || gameOver);
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