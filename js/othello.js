import { sendData } from './connection.js';

let isHost = false;
let gameState = {
  turnCount: 1, currentTurn: "host", board: new Array(64).fill(0), message: ""
};

export function initGame(hostFlag) {
  isHost = hostFlag;
  gameState = {
    turnCount: 1, currentTurn: "host", board: new Array(64).fill(0), message: ""
  };
  gameState.board[27] = 2; gameState.board[28] = 1;
  gameState.board[35] = 1; gameState.board[36] = 2;
  createBoardDOM();
  renderUI();
}

function createBoardDOM() {
  const boardEl = document.getElementById("board");
  boardEl.innerHTML = "";
  for (let i = 0; i < 64; i++) {
    const cell = document.createElement("div");
    cell.className = "cell";
    cell.innerHTML = `
      <div class="disc empty" id="disc-${i}">
        <div class="face face-black"></div>
        <div class="face face-white"></div>
      </div>
    `;
    cell.onclick = () => handleCellClick(i);
    boardEl.appendChild(cell);
  }
}

function getFlippableDiscs(board, index, playerNum) {
  if (board[index] !== 0) return [];
  const opponent = playerNum === 1 ? 2 : 1;
  const flippableIndices = [];
  const x = index % 8, y = Math.floor(index / 8);
  const directions = [[-1,-1], [0,-1], [1,-1], [-1,0], [1,0], [-1,1], [0,1], [1,1]];

  for (const [dx, dy] of directions) {
    let cx = x + dx, cy = y + dy, temp = [];
    while (cx >= 0 && cx < 8 && cy >= 0 && cy < 8) {
      let cIndex = cy * 8 + cx;
      if (board[cIndex] === 0) break;
      if (board[cIndex] === opponent) temp.push(cIndex);
      if (board[cIndex] === playerNum) {
        if (temp.length > 0) flippableIndices.push(...temp);
        break;
      }
      cx += dx; cy += dy;
    }
  }
  return flippableIndices;
}

function hasValidMoves(board, playerNum) {
  for (let i = 0; i < 64; i++) {
    if (board[i] === 0 && getFlippableDiscs(board, i, playerNum).length > 0) return true;
  }
  return false;
}

function handleCellClick(index) {
  const actionData = { type: "ACTION_PUT_STONE", payload: { index, player: isHost ? "host" : "guest" } };
  if (isHost) {
    processAction(actionData);
  } else {
    sendData(actionData);
  }
}

export function syncStateToGuest() {
  sendData({ type: "STATE_SYNC", payload: gameState });
}

export function processAction(action) {
  const { index, player } = action.payload;
  if (gameState.currentTurn !== player) return;
  
  const playerNum = player === "host" ? 1 : 2;
  const flippables = getFlippableDiscs(gameState.board, index, playerNum);
  if (flippables.length === 0) return;

  gameState.board[index] = playerNum;
  flippables.forEach(i => gameState.board[i] = playerNum);

  let nextPlayer = player === "host" ? "guest" : "host";
  let nextPlayerNum = nextPlayer === "host" ? 1 : 2;
  gameState.message = "";

  if (!hasValidMoves(gameState.board, nextPlayerNum)) {
    if (!hasValidMoves(gameState.board, playerNum)) {
      gameState.currentTurn = "game_over";
      gameState.message = "ゲーム終了！";
    } else {
      nextPlayer = player;
      gameState.message = "パスされました！";
    }
  }

  if (gameState.currentTurn !== "game_over") {
    gameState.currentTurn = nextPlayer;
    gameState.turnCount += 1;
  }

  if (isHost) {
    syncStateToGuest();
  }
  renderUI();
}

export function updateGameState(newPayload) {
  gameState = newPayload;
  renderUI();
}

function renderUI() {
  const turnText = document.getElementById("turn-text");
  if (gameState.currentTurn === "game_over") {
    turnText.innerText = gameState.message; turnText.style.color = "#1976d2";
  } else if (gameState.message) {
    turnText.innerText = gameState.message; turnText.style.color = "#f57c00";
  } else {
    const isMyTurn = gameState.currentTurn === (isHost ? "host" : "guest");
    turnText.innerText = isMyTurn ? `あなたの番です` : `相手の番です`;
    turnText.style.color = isMyTurn ? "#d32f2f" : "#757575";
  }

  let blackCount = 0, whiteCount = 0;
  gameState.board.forEach((val, i) => {
    if (val === 1) blackCount++; else if (val === 2) whiteCount++;
    const disc = document.getElementById(`disc-${i}`);
    if (!disc) return;
    disc.classList.remove("empty", "black", "white");
    if (val === 0) disc.classList.add("empty");
    else if (val === 1) disc.classList.add("black");
    else if (val === 2) disc.classList.add("white");
  });

  document.getElementById("score-black").innerText = `黒: ${blackCount}`;
  document.getElementById("score-white").innerText = `白: ${whiteCount}`;
}