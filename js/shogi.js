import { sendData } from './connection.js';
import { playSound } from './sounds.js';

let isHostPlayer = false;
let isMyTurn = false;
let board = new Array(81).fill(null);
let capturedHost = []; // 先手の持ち駒
let capturedGuest = []; // 後手の持ち駒
let selectedIndex = null;
let selectedCapturedPiece = null; // 現在選択している持ち駒の種類
let validMoves = [];
let gameOver = false;
let myRole = 'sente'; // ホスト＝先手(sente)、ゲスト＝後手(gote)
let currentTurn = 'sente';
let checkStatusText = ""; // 王手表示用テキスト

const boardEl = document.getElementById('shogi-board');
const turnText = document.getElementById('shogi-turn-text');
const topCapturedEl = document.getElementById('shogi-captured-top');   // 上側（相手の持ち駒）
const bottomCapturedEl = document.getElementById('shogi-captured-bottom'); // 下側（自分の持ち駒）
const btnRematch = document.getElementById('btn-rematch-shogi');

const PIECES = {
  FU: { name: '歩', val: '歩', promote: 'と' },
  KYO: { name: '香', val: '香', promote: '成香' },
  KEI: { name: '桂', val: '桂', promote: '成桂' },
  GIN: { name: '銀', val: '銀', promote: '成銀' },
  KIN: { name: '金', val: '金', promote: '金' },
  KAKU: { name: '角', val: '角', promote: '馬' },
  HISHA: { name: '飛', val: '飛', promote: '竜' },
  GYOKU: { name: '王', val: '王', promote: '王' }
};

const PIECE_ORDER = ['FU', 'KYO', 'KEI', 'GIN', 'KIN', 'KAKU', 'HISHA'];

export function initGame(isHost) {
  isHostPlayer = isHost;
  myRole = isHost ? 'sente' : 'gote';
  board = new Array(81).fill(null);
  capturedHost = [];
  capturedGuest = [];
  selectedIndex = null;
  selectedCapturedPiece = null;
  validMoves = [];
  currentTurn = 'sente';
  isMyTurn = isHost;
  gameOver = false;
  checkStatusText = "";
  btnRematch.style.display = 'none';

  setupInitialBoard();
  updateBoard();
  updateUI();
}

export function initShogiGame(isHost) {
  initGame(isHost);
}

function setupInitialBoard() {
  const goteInitial = [
    [0, 'KYO'], [1, 'KEI'], [2, 'GIN'], [3, 'KIN'], [4, 'GYOKU'], [5, 'KIN'], [6, 'GIN'], [7, 'KEI'], [8, 'KYO'],
    [10, 'HISHA'], [16, 'KAKU'],
    [18, 'FU'], [19, 'FU'], [20, 'FU'], [21, 'FU'], [22, 'FU'], [23, 'FU'], [24, 'FU'], [25, 'FU'], [26, 'FU']
  ];
  goteInitial.forEach(([pos, type]) => { board[pos] = { type, player: 'gote', promoted: false }; });

  const senteInitial = [
    [54, 'FU'], [55, 'FU'], [56, 'FU'], [57, 'FU'], [58, 'FU'], [59, 'FU'], [60, 'FU'], [61, 'FU'], [62, 'FU'],
    [64, 'KAKU'], [70, 'HISHA'],
    [72, 'KYO'], [73, 'KEI'], [74, 'GIN'], [75, 'KIN'], [76, 'GYOKU'], [77, 'KIN'], [78, 'GIN'], [79, 'KEI'], [80, 'KYO']
  ];
  senteInitial.forEach(([pos, type]) => { board[pos] = { type, player: 'sente', promoted: false }; });
}

function updateBoard() {
  boardEl.innerHTML = '';
  
  for (let displayI = 0; displayI < 81; displayI++) {
    const actualI = isHostPlayer ? displayI : (80 - displayI);
    
    const cell = document.createElement('div');
    cell.className = 'shogi-cell';
    if (actualI === selectedIndex) cell.classList.add('selected');
    if (validMoves.includes(actualI)) cell.classList.add('valid-move');

    const piece = board[actualI];
    if (piece) {
      const pieceEl = document.createElement('div');
      const isOpponent = (piece.player !== myRole);
      
      let classStr = 'shogi-piece';
      if (isOpponent) classStr += ' opponent';
      if (piece.promoted) classStr += ' promoted';
      pieceEl.className = classStr;
      
      const baseInfo = PIECES[piece.type];
      pieceEl.innerText = piece.promoted ? baseInfo.promote : baseInfo.val;
      cell.appendChild(pieceEl);
    }

    cell.onclick = () => handleCellClick(actualI);
    boardEl.appendChild(cell);
  }
}

function formatCapturedPieces(piecesArray) {
  const counts = {};
  piecesArray.forEach(p => { counts[p] = (counts[p] || 0) + 1; });
  const formatted = [];
  PIECE_ORDER.forEach(type => {
    if (counts[type]) {
      const name = PIECES[type].val;
      const count = counts[type];
      formatted.push(count > 1 ? `${name}${count}` : name);
    }
  });
  return formatted.join(' ') || 'なし';
}

function updateUI() {
  const topCaptured = isHostPlayer ? capturedGuest : capturedHost;
  const bottomCaptured = isHostPlayer ? capturedHost : capturedGuest;
  const topName = isHostPlayer ? "後手（相手）" : "先手（相手）";
  const bottomName = isHostPlayer ? "先手（自分）" : "後手（自分）";

  topCapturedEl.innerText = `${topName} 持ち駒: ${formatCapturedPieces(topCaptured)}`;

  bottomCapturedEl.innerHTML = `${bottomName} 持ち駒: `;
  if (bottomCaptured.length === 0) {
    bottomCapturedEl.append("なし");
  } else {
    const counts = {};
    bottomCaptured.forEach(p => counts[p] = (counts[p] || 0) + 1);

    PIECE_ORDER.forEach(type => {
      if (counts[type]) {
        const span = document.createElement('span');
        span.style.cssText = "display: inline-block; padding: 2px 6px; margin: 0 2px; background: #e0c090; border: 1px solid #8b5a2b; border-radius: 3px; cursor: pointer;";
        const countStr = counts[type] > 1 ? `${counts[type]}` : '';
        span.innerText = `${PIECES[type].val}${countStr}`;
        if (selectedCapturedPiece === type) {
          span.style.backgroundColor = '#ffd700';
        }
        span.onclick = () => {
          if (!isMyTurn || gameOver) return;
          if (selectedCapturedPiece === type) {
            selectedCapturedPiece = null;
            validMoves = [];
          } else {
            selectedCapturedPiece = type;
            selectedIndex = null;
            validMoves = getDropMoves(type);
          }
          updateBoard();
          updateUI();
        };
        bottomCapturedEl.appendChild(span);
      }
    });
  }

  if (gameOver) {
    btnRematch.style.display = 'inline-block';
    turnText.innerText = "🏆 ゲーム終了";
  } else {
    const turnStr = isMyTurn ? "🟢 あなたのターン" : "🔴 相手のターン";
    turnText.innerText = turnStr + checkStatusText;
  }
}

function handleCellClick(index) {
  if (!isMyTurn || gameOver) return;

  const piece = board[index];

  if (selectedCapturedPiece !== null) {
    if (validMoves.includes(index)) {
      executeDrop(selectedCapturedPiece, index);
    } else {
      selectedCapturedPiece = null;
      validMoves = [];
      updateBoard();
      updateUI();
    }
    return;
  }

  if (selectedIndex === null) {
    if (piece && piece.player === myRole) {
      selectedIndex = index;
      validMoves = getValidMoves(index, piece);
      updateBoard();
    }
  } else {
    if (selectedIndex === index) {
      selectedIndex = null;
      validMoves = [];
      updateBoard();
      return;
    }

    if (validMoves.includes(index)) {
      executeMove(selectedIndex, index);
    } else if (piece && piece.player === myRole) {
      selectedIndex = index;
      validMoves = getValidMoves(index, piece);
      updateBoard();
    }
  }
}

// ==========================================
// 1. 局面判定（王手・詰み判定）
// ==========================================
function checkGameState() {
  if (gameOver) return;

  const inCheck = isKingInCheck(currentTurn, board);
  const canMove = hasAnyLegalMove(currentTurn, board);

  if (inCheck) {
    if (!canMove) {
      gameOver = true;
      checkStatusText = " 【詰み！】";
      const winnerRole = currentTurn === 'sente' ? 'gote' : 'sente';
      const winnerName = winnerRole === 'sente' ? '先手' : '後手';
      const loserName = currentTurn === 'sente' ? '先手' : '後手';
      setTimeout(() => alert(`【詰み】${loserName}の玉が詰みました。${winnerName}の勝ちです！`), 100);
    } else {
      checkStatusText = " ⚠️【王手！】";
    }
  } else {
    if (!canMove) {
      gameOver = true;
      checkStatusText = " 【詰み！】";
      const winnerRole = currentTurn === 'sente' ? 'gote' : 'sente';
      const winnerName = winnerRole === 'sente' ? '先手' : '後手';
      const loserName = currentTurn === 'sente' ? '先手' : '後手';
      setTimeout(() => alert(`${loserName}は指せる手がありません。${winnerName}の勝ちです！`), 100);
    } else {
      checkStatusText = "";
    }
  }
}

// ==========================================
// 2. 禁じ手判定関数（打ち歩詰め対応）
// ==========================================
function isKinjite(piece, from, to, player, currentBoard, checkUchifu = true) {
  const toR = Math.floor(to / 9);
  const toC = to % 9;
  const isDrop = (from === null);

  // ① 行きどころのない駒
  if (isDrop) {
    if (piece.type === 'FU' || piece.type === 'KYO') {
      if (player === 'sente' && toR === 0) return true;
      if (player === 'gote' && toR === 8) return true;
    }
    if (piece.type === 'KEI') {
      if (player === 'sente' && toR <= 1) return true;
      if (player === 'gote' && toR >= 7) return true;
    }
  }

  // ② 二歩
  if (isDrop && piece.type === 'FU') {
    for (let r = 0; r < 9; r++) {
      const checkIdx = r * 9 + toC;
      const p = currentBoard[checkIdx];
      if (p && p.player === player && p.type === 'FU' && !p.promoted) {
        return true;
      }
    }
  }

  // 仮想盤面の作成
  const tempBoard = [...currentBoard]; 
  if (!isDrop) tempBoard[from] = null;
  tempBoard[to] = piece;

  // ③ 王手放置・自殺手
  if (isKingInCheck(player, tempBoard)) {
    return true;
  }

  // ④ 打ち歩詰め
  if (checkUchifu && isDrop && piece.type === 'FU') {
    const opponent = player === 'sente' ? 'gote' : 'sente';
    if (isKingInCheck(opponent, tempBoard)) {
      if (!hasAnyLegalMove(opponent, tempBoard, false)) {
        return true; // 打ち歩詰めのため反則
      }
    }
  }

  return false;
}

// ==========================================
// 3. 合法手存在判定関数
// ==========================================
function hasAnyLegalMove(player, currentBoard, checkUchifu = true) {
  // 盤上の駒の移動
  for (let i = 0; i < 81; i++) {
    const p = currentBoard[i];
    if (p && p.player === player) {
      const rawMoves = calculateRawMoves(i, p, currentBoard);
      for (const to of rawMoves) {
        if (!isKinjite(p, i, to, player, currentBoard, checkUchifu)) {
          return true;
        }
      }
    }
  }

  // 持ち駒を打つ移動
  const hand = player === 'sente' ? capturedHost : capturedGuest;
  const uniqueTypes = [...new Set(hand)];
  for (const type of uniqueTypes) {
    const tempPiece = { type: type, player: player, promoted: false };
    for (let to = 0; to < 81; to++) {
      if (currentBoard[to] === null) {
        if (!isKinjite(tempPiece, null, to, player, currentBoard, checkUchifu)) {
          return true;
        }
      }
    }
  }

  return false;
}

// ==========================================
// 4. 王手判定の補助関数
// ==========================================
function isKingInCheck(targetPlayer, currentBoard) {
  let kingPos = -1;
  for (let i = 0; i < 81; i++) {
    const p = currentBoard[i];
    if (p && p.player === targetPlayer && p.type === 'GYOKU') {
      kingPos = i;
      break;
    }
  }
  if (kingPos === -1) return false;

  const opponent = targetPlayer === 'sente' ? 'gote' : 'sente';
  for (let i = 0; i < 81; i++) {
    const p = currentBoard[i];
    if (p && p.player === opponent) {
      const attackMoves = calculateRawMoves(i, p, currentBoard);
      if (attackMoves.includes(kingPos)) return true;
    }
  }
  return false;
}

// ==========================================
// 5. 駒の純粋な動き（ルール無視）を計算する関数
// ==========================================
function calculateRawMoves(index, piece, currentBoard) {
  let moves = [];
  const r = Math.floor(index / 9);
  const c = index % 9;
  const dir = piece.player === 'sente' ? -1 : 1;

  const addSteps = (offsets) => {
    offsets.forEach(([dr, dc]) => {
      const nr = r + dr * dir;
      const nc = c + dc;
      if (nr >= 0 && nr < 9 && nc >= 0 && nc < 9) {
        const target = currentBoard[nr * 9 + nc];
        if (!target || target.player !== piece.player) moves.push(nr * 9 + nc);
      }
    });
  };

  const addLines = (directions) => {
    directions.forEach(([dr, dc]) => {
      let step = 1;
      while (true) {
        const nr = r + dr * step;
        const nc = c + dc * step;
        if (nr < 0 || nr >= 9 || nc < 0 || nc >= 9) break;
        const targetIdx = nr * 9 + nc;
        const target = currentBoard[targetIdx];
        if (!target) {
          moves.push(targetIdx);
        } else {
          if (target.player !== piece.player) moves.push(targetIdx);
          break;
        }
        step++;
      }
    });
  };

  if (!piece.promoted) {
    switch (piece.type) {
      case 'FU': addSteps([[1, 0]]); break;
      case 'KYO': addLines([[dir, 0]]); break;
      case 'KEI': addSteps([[2, -1], [2, 1]]); break;
      case 'GIN': addSteps([[1, 0], [1, -1], [1, 1], [-1, -1], [-1, 1]]); break;
      case 'KIN': addSteps([[1, 0], [1, -1], [1, 1], [0, -1], [0, 1], [-1, 0]]); break;
      case 'KAKU': addLines([[-1, -1], [-1, 1], [1, -1], [1, 1]]); break;
      case 'HISHA': addLines([[-1, 0], [1, 0], [0, -1], [0, 1]]); break;
      case 'GYOKU': addSteps([[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]); break;
    }
  } else {
    if (piece.type === 'KAKU') {
      addLines([[-1, -1], [-1, 1], [1, -1], [1, 1]]);
      addSteps([[1,0],[-1,0],[0,1],[0,-1]]);
    } else if (piece.type === 'HISHA') {
      addLines([[-1, 0], [1, 0], [0, -1], [0, 1]]);
      addSteps([[-1,-1],[-1,1],[1,-1],[1,1]]);
    } else {
      addSteps([[1, 0], [1, -1], [1, 1], [0, -1], [0, 1], [-1, 0]]);
    }
  }
  return moves;
}

// ==========================================
// 6. 盤上の駒の合法手を返す
// ==========================================
function getValidMoves(index, piece) {
  const rawMoves = calculateRawMoves(index, piece, board);
  return rawMoves.filter(to => !isKinjite(piece, index, to, piece.player, board));
}

// ==========================================
// 7. 持ち駒を打てるマスを返す
// ==========================================
function getDropMoves(pieceType) {
  let moves = [];
  const tempPiece = { type: pieceType, player: myRole, promoted: false };
  for (let to = 0; to < 81; to++) {
    if (board[to] === null) {
      if (!isKinjite(tempPiece, null, to, myRole, board)) {
        moves.push(to);
      }
    }
  }
  return moves;
}

function canPromote(piece, from, to) {
  if (piece.promoted) return false;
  if (piece.type === 'KIN' || piece.type === 'GYOKU') return false;

  const fromR = Math.floor(from / 9);
  const toR = Math.floor(to / 9);

  if (piece.player === 'sente') {
    return fromR <= 2 || toR <= 2;
  } else {
    return fromR >= 6 || toR >= 6;
  }
}

function executeDrop(pieceType, to) {
  let myCaptured = isHostPlayer ? capturedHost : capturedGuest;
  const idx = myCaptured.indexOf(pieceType);
  if (idx !== -1) {
    myCaptured.splice(idx, 1);
  }

  board[to] = { type: pieceType, player: myRole, promoted: false };
  selectedCapturedPiece = null;
  selectedIndex = null;
  validMoves = [];

  const moveData = {
    type: "ACTION_SHOGI_MOVE",
    payload: { from: -1, to, board, capturedHost, capturedGuest, gameOver, nextTurn: currentTurn === 'sente' ? 'gote' : 'sente' }
  };

  playSound('put');
  if (isHostPlayer) {
    processAction(moveData);
  } else {
    sendData(moveData);
  }
}

function executeMove(from, to) {
  const piece = board[from];
  const target = board[to];

  let isPromoted = piece.promoted;

  if (canPromote(piece, from, to)) {
    const toR = Math.floor(to / 9);
    const mustPromote = 
      ((piece.type === 'FU' || piece.type === 'KYO') && (piece.player === 'sente' ? toR === 0 : toR === 8)) ||
      (piece.type === 'KEI' && (piece.player === 'sente' ? toR <= 1 : toR >= 7));

    if (mustPromote) {
      isPromoted = true;
    } else {
      isPromoted = confirm("駒を成りますか？");
    }
  }

  if (target) {
    let capturedType = target.type;
    if (target.promoted) {
      const demoteMap = { 'と': 'FU', '成香': 'KYO', '成桂': 'KEI', '成銀': 'GIN', '馬': 'KAKU', '竜': 'HISHA' };
      capturedType = demoteMap[target.promoted] || target.type;
    }

    if (target.player === 'sente') {
      capturedGuest.push(capturedType);
    } else {
      capturedHost.push(capturedType);
    }
    if (target.type === 'GYOKU') gameOver = true;
  }

  board[to] = { ...piece, promoted: isPromoted };
  board[from] = null;
  selectedIndex = null;
  validMoves = [];

  const moveData = {
    type: "ACTION_SHOGI_MOVE",
    payload: { from, to, board, capturedHost, capturedGuest, gameOver, nextTurn: currentTurn === 'sente' ? 'gote' : 'sente' }
  };

  playSound('put');
  if (isHostPlayer) {
    processAction(moveData);
  } else {
    sendData(moveData);
  }
}

export function processAction(data) {
  if (data.type === "ACTION_SHOGI_MOVE") {
    board = data.payload.board;
    capturedHost = data.payload.capturedHost;
    capturedGuest = data.payload.capturedGuest;
    if (data.payload.gameOver) gameOver = true;
    currentTurn = data.payload.nextTurn;
    isMyTurn = (currentTurn === myRole);

    checkGameState();
    updateBoard();
    updateUI();
    if (isHostPlayer) syncStateToGuest();
  }
}

export function syncStateToGuest() {
  if (isHostPlayer) {
    sendData({
      type: "STATE_SYNC_SHOGI",
      payload: { board, capturedHost, capturedGuest, currentTurn, gameOver }
    });
  }
}

export function updateGameState(payload) {
  if (!isHostPlayer) {
    board = payload.board;
    capturedHost = payload.capturedHost;
    capturedGuest = payload.capturedGuest;
    currentTurn = payload.currentTurn;
    if (payload.gameOver) gameOver = true;
    isMyTurn = (currentTurn === myRole);

    playSound('put');
    checkGameState();
    updateBoard();
    updateUI();
  }
}

export function requestRematch() {
  if (isHostPlayer) {
    initGame(true);
    syncStateToGuest();
  } else {
    sendData({ type: "ACTION_REMATCH_SHOGI" });
  }
}