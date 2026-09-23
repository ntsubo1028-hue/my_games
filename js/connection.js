const config = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

let pc = null;
let dataChannel = null;
let html5QrCode = null;

let activeQRParts = [];
let currentQRIndex = 0;
let scannedParts = {};
let currentScanCallback = null;

export function initConnection() {
  if (pc) { pc.close(); pc = null; }
  if (dataChannel) { dataChannel.close(); dataChannel = null; }
  scannedParts = {};
  activeQRParts = [];
}

function waitForIceGathering(peerConnection) {
  return new Promise((resolve) => {
    if (peerConnection.iceGatheringState === 'complete') {
      resolve();
    } else {
      let isResolved = false;
      const done = () => {
        if (!isResolved) { isResolved = true; resolve(); }
      };
      peerConnection.onicecandidate = (event) => {
        if (event.candidate === null) done();
      };
      setTimeout(done, 1000);
    }
  });
}

// gameType を含めてQRコードを生成する
export function generateMultiPartQR(imgId, statusId, sdpObj, gameType = 'othello') {
  const compactData = { t: sdpObj.type, s: sdpObj.sdp, g: gameType };
  const jsonString = JSON.stringify(compactData);
  const fullStr = LZString.compressToBase64(jsonString);
  
  const len = Math.ceil(fullStr.length / 3);
  activeQRParts = [
    "1:" + fullStr.slice(0, len),
    "2:" + fullStr.slice(len, len * 2),
    "3:" + fullStr.slice(len * 2)
  ];
  currentQRIndex = 0;
  renderCurrentQR(imgId, statusId);
}

export function renderCurrentQR(imgId, statusId) {
  const statusEl = document.getElementById(statusId);
  const imgEl = document.getElementById(imgId);
  if (!activeQRParts.length) return;
  
  const data = activeQRParts[currentQRIndex];
  const partNum = currentQRIndex + 1;

  statusEl.className = 'loading-text';
  statusEl.innerText = `QRコード生成中 (${partNum}/3)...`;
  
  const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&ecc=L&data=${encodeURIComponent(data)}`;
  
  imgEl.onload = () => {
    statusEl.innerText = `相手に読ませてください 【 Part ${partNum} / 3 】\n※ボタンで切り替えて全3枚を見せてください`;
    imgEl.style.display = 'block';
  };
  imgEl.onerror = () => {
    statusEl.className = 'error-text';
    statusEl.innerText = "QRコードの画像読み込みに失敗しました。";
  };
  imgEl.src = qrApiUrl;
}

export function toggleQR(imgId, statusId) {
  if (activeQRParts.length === 3) {
    currentQRIndex = (currentQRIndex + 1) % 3;
    renderCurrentQR(imgId, statusId);
  }
}

export function startMultiPartScan(callback, onCameraStart, onScanDone) {
  scannedParts = {};
  currentScanCallback = callback;
  runScanner(onCameraStart, onScanDone);
}

function runScanner(onCameraStart, onScanDone) {
  onCameraStart();
  const missing = !scannedParts['1'] ? '1' : (!scannedParts['2'] ? '2' : '3');
  document.getElementById('scan-guide-text').innerText = `【 Part ${missing} / 3 】のQRコードを枠内に入れてください`;

  if (!html5QrCode) {
    html5QrCode = new Html5Qrcode("reader");
  }

  html5QrCode.start(
    { facingMode: "environment" },
    { fps: 10, qrbox: { width: 260, height: 260 } },
    (decodedText) => {
      html5QrCode.stop().then(() => {
        html5QrCode.clear();
        html5QrCode = null;
        processScannedData(decodedText, onScanDone, () => runScanner(onCameraStart, onScanDone));
      }).catch(() => {
        onScanDone();
      });
    },
    (errorMessage) => {}
  ).catch(err => {
    alert("カメラの起動に失敗しました。カメラの権限やブラウザ設定をご確認ください。");
    onScanDone();
  });
}

function processScannedData(text, onScanDone, retryScanner) {
  try {
    if (text.startsWith("1:") || text.startsWith("2:") || text.startsWith("3:")) {
      const partNum = text[0];
      const payload = text.slice(2);
      
      if (!scannedParts[partNum]) {
        scannedParts[partNum] = payload;
      }

      if (scannedParts['1'] && scannedParts['2'] && scannedParts['3']) {
        onScanDone();
        const fullStr = scannedParts['1'] + scannedParts['2'] + scannedParts['3'];
        const decompressed = LZString.decompressFromBase64(fullStr);
        const parsed = JSON.parse(decompressed);
        // gameType も一緒にコールバックへ返す
        currentScanCallback({ type: parsed.t, sdp: parsed.s, gameType: parsed.g || 'othello' });
      } else {
        const nextMissing = !scannedParts['1'] ? '1' : (!scannedParts['2'] ? '2' : '3');
        alert(`Part ${partNum}/3 の読み取り成功！\n続いて「Part ${nextMissing}/3」のQRコードを読み取ってください。`);
        setTimeout(() => { retryScanner(); }, 300);
      }
    } else {
      alert("このアプリのQRコードではありません。正しいQRコードを読み取ってください。");
      setTimeout(() => { retryScanner(); }, 300);
    }
  } catch(e) {
    alert("QRコードの解析に失敗しました。もう一度お試しください。");
    setTimeout(() => { retryScanner(); }, 300);
  }
}

export function cancelScan(onScanDone) {
  if (html5QrCode) {
    html5QrCode.stop().then(() => {
      html5QrCode.clear();
      html5QrCode = null;
      onScanDone();
    }).catch(() => {
      html5QrCode = null;
      onScanDone();
    });
  } else {
    onScanDone();
  }
}

export async function setupHostConnection(onDataChannelOpen) {
  initConnection();
  pc = new RTCPeerConnection(config);
  
  const channel = pc.createDataChannel('gameChannel');
  setupDataChannelHandlers(channel, onDataChannelOpen);
  
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await waitForIceGathering(pc);
  return pc.localDescription;
}

export async function setupGuestConnection(offerObj, onDataChannelOpen) {
  initConnection();
  pc = new RTCPeerConnection(config);
  
  pc.ondatachannel = (event) => {
    setupDataChannelHandlers(event.channel, onDataChannelOpen);
  };
  
  await pc.setRemoteDescription(new RTCSessionDescription(offerObj));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  await waitForIceGathering(pc);
  return pc.localDescription;
}

export async function handleGuestAnswer(answerObj) {
  if (!pc || pc.signalingState !== "have-local-offer") {
    alert("通信セッションの状態が正しくありません。最初からやり直してください。");
    return;
  }
  await pc.setRemoteDescription(new RTCSessionDescription(answerObj));
}

let onMessageCallback = null;
export function setOnMessage(callback) { onMessageCallback = callback; }
export function sendData(data) {
  if (dataChannel && dataChannel.readyState === 'open') {
    dataChannel.send(JSON.stringify(data));
  }
}

// 接続がすでに確立しているかチェックする関数
export function isConnectionEstablished() {
  return window.dataChannel && window.dataChannel.readyState === 'open';
}

function setupDataChannelHandlers(channel, onOpen) {
  dataChannel = channel;
  dataChannel.onopen = () => { onOpen(); };
  dataChannel.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (onMessageCallback) onMessageCallback(data);
  };
}

