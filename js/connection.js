import { playSound } from './sounds.js';

// ★ QRコードの分割数。3連に戻したい場合は、ここを 3 に変更するだけでOKです
const QR_PARTS_COUNT = 4;

const config = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

let pc = null;
let dataChannel = null;
let html5QrCode = null;

let scannedParts = {};
let currentScanCallback = null;
let isScanComplete = false;

export function initConnection() {
  if (pc) { pc.close(); pc = null; }
  if (dataChannel) { dataChannel.close(); dataChannel = null; }
  scannedParts = {};
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

// SDPを超圧縮（不要行の削除と、改行コードの統一）
function filterSdp(sdp) {
  if (!sdp) return '';
  return sdp
    .split('\r\n')
    .filter(line => {
      return !line.startsWith('a=extmap') &&
             !line.startsWith('a=rtcp-fb') &&
             !line.startsWith('a=fmtp') &&
             !line.startsWith('a=rtcp') &&
             !line.startsWith('a=ssrc') &&
             !line.startsWith('a=msid') &&
             !line.startsWith('a=mid');
    })
    .join('\n'); 
}

export function generateMultiPartQR(statusId, sdpObj, gameType = 'othello') {
  const cleanedSdp = filterSdp(sdpObj.sdp);
  const compactData = { t: sdpObj.type, s: cleanedSdp, g: gameType };
  const jsonString = JSON.stringify(compactData);
  const fullStr = LZString.compressToBase64(jsonString);
  
  const len = Math.ceil(fullStr.length / QR_PARTS_COUNT);
  const parts = [];
  for (let i = 0; i < QR_PARTS_COUNT; i++) {
    parts.push(`${i+1}:` + fullStr.slice(len * i, len * (i + 1)));
  }
  
  const statusEl = document.getElementById(statusId);
  statusEl.className = 'loading-text';
  statusEl.innerText = `相手に${QR_PARTS_COUNT}つのQRコードを順に読ませてください`;

  // UI上の表示個数も自動調整
  for (let i = 1; i <= 4; i++) {
    const boxEl = document.getElementById(`qr-box-${i}`);
    if (boxEl) {
      boxEl.style.display = (i <= QR_PARTS_COUNT) ? 'block' : 'none';
      if (i <= QR_PARTS_COUNT) {
        const imgEl = document.getElementById(`conn-qr-${i}`);
        const data = parts[i - 1];
        imgEl.src = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&ecc=L&data=${encodeURIComponent(data)}`;
      }
    }
  }
}

export function startMultiPartScan(callback, onCameraStart, onScanDone) {
  scannedParts = {};
  currentScanCallback = callback;
  runScanner(onCameraStart, onScanDone);
}

function runScanner(onCameraStart, onScanDone) {
  onCameraStart();
  isScanComplete = false;
  
  for (let i = 1; i <= 4; i++) {
    const indicator = document.getElementById(`indicator-${i}`);
    if (indicator) {
      indicator.style.display = (i <= QR_PARTS_COUNT) ? 'inline' : 'none';
      if (i === 1) indicator.innerText = "⬜ 🔴赤";
      if (i === 2) indicator.innerText = "⬜ 🔵青";
      if (i === 3) indicator.innerText = "⬜ 🟡黄";
      if (i === 4) indicator.innerText = "⬜ 🟢緑";
    }
  }

  if (!html5QrCode) {
    html5QrCode = new Html5Qrcode("reader");
  }

  html5QrCode.start(
    { facingMode: "environment" },
    { fps: 10, qrbox: { width: 250, height: 250 } },
    (decodedText) => {
      if (!isScanComplete) {
        processScannedData(decodedText, onScanDone);
      }
    },
    (errorMessage) => {}
  ).catch(err => {
    alert("カメラの起動に失敗しました。カメラの権限やブラウザ設定をご確認ください。");
    onScanDone();
  });
}

function processScannedData(text, onScanDone) {
  try {
    const partMatch = text.match(/^(\d):/);
    if (partMatch) {
      const partNum = parseInt(partMatch[1], 10);
      if (partNum >= 1 && partNum <= QR_PARTS_COUNT) {
        const payload = text.slice(2);
        
        if (!scannedParts[partNum]) {
          scannedParts[partNum] = payload;
          
          playSound('put');
          if (navigator.vibrate) navigator.vibrate(100);

          const indicator = document.getElementById(`indicator-${partNum}`);
          if (partNum === 1) indicator.innerText = "✅ 🔴赤";
          if (partNum === 2) indicator.innerText = "✅ 🔵青";
          if (partNum === 3) indicator.innerText = "✅ 🟡黄";
          if (partNum === 4) indicator.innerText = "✅ 🟢緑";

          let allScanned = true;
          for (let i = 1; i <= QR_PARTS_COUNT; i++) {
            if (!scannedParts[i]) allScanned = false;
          }

          if (allScanned && !isScanComplete) {
            isScanComplete = true;

            setTimeout(() => playSound('win'), 200);
            if (navigator.vibrate) navigator.vibrate([100, 50, 150]);

            html5QrCode.stop().then(() => {
              html5QrCode.clear();
              html5QrCode = null;
              
              let fullStr = "";
              for (let i = 1; i <= QR_PARTS_COUNT; i++) {
                fullStr += scannedParts[i];
              }
              const decompressed = LZString.decompressFromBase64(fullStr);
              const parsed = JSON.parse(decompressed);
              
              currentScanCallback({ type: parsed.t, sdp: parsed.s, gameType: parsed.g || 'othello' });
              onScanDone();
            });
          }
        }
      }
    }
  } catch(e) {
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