// connection.js
import { playSound } from './sounds.js';

const QR_PARTS_COUNT = 4;
const config = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

export const connections = {}; 

let html5QrCode = null;
let scannedParts = {};
let currentScanCallback = null;
let isScanComplete = false;
let onMessageCallback = null;
let onDisconnectCallback = null;

export function initConnection() {
  Object.keys(connections).forEach(id => {
    if (connections[id].pc) connections[id].pc.close();
    if (connections[id].dataChannel) connections[id].dataChannel.close();
  });
  for (const key in connections) delete connections[key];
  scannedParts = {};
}

// 複数人接続や外部ネットワークでの候補不足を防ぐため、タイムアウトを3秒に延長
function waitForIceGathering(peerConnection) {
  return new Promise((resolve) => {
    if (peerConnection.iceGatheringState === 'complete') {
      resolve();
    } else {
      let isResolved = false;
      const done = () => { if (!isResolved) { isResolved = true; resolve(); } };
      peerConnection.onicecandidate = (event) => { if (event.candidate === null) done(); };
      setTimeout(done, 3000);
    }
  });
}

function filterSdp(sdp) {
  if (!sdp) return '';
  return sdp.split('\r\n').filter(line => {
    return !line.startsWith('a=extmap') && !line.startsWith('a=rtcp-fb') &&
           !line.startsWith('a=fmtp') && !line.startsWith('a=rtcp') &&
           !line.startsWith('a=ssrc') && !line.startsWith('a=msid') && !line.startsWith('a=mid');
  }).join('\n'); 
}

export function generateMultiPartQR(statusId, sdpObj, gameType, targetId = '') {
  const cleanedSdp = filterSdp(sdpObj.sdp);
  const compactData = { t: sdpObj.type, s: cleanedSdp, g: gameType, id: targetId };
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

  if (!html5QrCode) html5QrCode = new Html5Qrcode("reader");

  html5QrCode.start(
    { facingMode: "environment" },
    { fps: 10, qrbox: { width: 250, height: 250 } },
    (decodedText) => { if (!isScanComplete) processScannedData(decodedText, onScanDone); },
    (errorMessage) => {}
  ).catch(err => {
    alert("カメラの起動に失敗しました。");
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
          for (let i = 1; i <= QR_PARTS_COUNT; i++) if (!scannedParts[i]) allScanned = false;

          if (allScanned && !isScanComplete) {
            isScanComplete = true;
            setTimeout(() => playSound('win'), 200);
            if (navigator.vibrate) navigator.vibrate([100, 50, 150]);
            html5QrCode.stop().then(() => {
              html5QrCode.clear();
              html5QrCode = null;
              let fullStr = "";
              for (let i = 1; i <= QR_PARTS_COUNT; i++) fullStr += scannedParts[i];
              const decompressed = LZString.decompressFromBase64(fullStr);
              const parsed = JSON.parse(decompressed);
              
              currentScanCallback({ type: parsed.t, sdp: parsed.s, gameType: parsed.g, targetId: parsed.id });
              onScanDone();
            });
          }
        }
      }
    }
  } catch(e) {}
}

export function cancelScan(onScanDone) {
  if (html5QrCode) {
    html5QrCode.stop().then(() => { html5QrCode.clear(); html5QrCode = null; onScanDone(); }).catch(() => { html5QrCode = null; onScanDone(); });
  } else { onScanDone(); }
}

export async function setupHostConnection(guestId, onDataChannelOpen) {
  const pc = new RTCPeerConnection(config);
  const channel = pc.createDataChannel('gameChannel');
  
  connections[guestId] = { pc: pc, dataChannel: channel };
  setupDataChannelHandlers(guestId, channel, onDataChannelOpen);
  
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await waitForIceGathering(pc);
  return pc.localDescription;
}

export async function setupGuestConnection(offerObj, onDataChannelOpen) {
  initConnection();
  const pc = new RTCPeerConnection(config);
  
  connections['host'] = { pc: pc, dataChannel: null };
  
  pc.ondatachannel = (event) => {
    connections['host'].dataChannel = event.channel;
    setupDataChannelHandlers('host', event.channel, onDataChannelOpen);
  };
  
  if (typeof offerObj === 'string') {
    try { offerObj = JSON.parse(offerObj); } catch(e) {}
  }

  const type = (offerObj && (offerObj.type || offerObj.t)) || 'offer';
  let offerSdp = (offerObj && (offerObj.sdp || offerObj.s)) || (typeof offerObj === 'string' ? offerObj : '');
  
  if (offerSdp) {
    offerSdp = String(offerSdp)
      .replace(/\\r\\n/g, '\r\n')
      .replace(/\\n/g, '\r\n');
  }

  await pc.setRemoteDescription(new RTCSessionDescription({
    type: type,
    sdp: offerSdp
  }));

  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  await waitForIceGathering(pc);
  return pc.localDescription;
}

export async function handleGuestAnswer(guestId, answerObj) {
  const conn = connections[guestId];
  if (!conn || !conn.pc) {
    alert("通信セッションの状態が正しくありません。");
    return;
  }

  if (typeof answerObj === 'string') {
    try { answerObj = JSON.parse(answerObj); } catch(e) {}
  }

  const type = (answerObj && (answerObj.type || answerObj.t)) || 'answer';
  let sdpText = (answerObj && (answerObj.sdp || answerObj.s)) || (typeof answerObj === 'string' ? answerObj : '');

  if (sdpText) {
    sdpText = String(sdpText)
      .replace(/\\r\\n/g, '\r\n')
      .replace(/\\n/g, '\r\n');
  }

  await conn.pc.setRemoteDescription(new RTCSessionDescription({
    type: type,
    sdp: sdpText
  }));
}

export function setOnMessage(callback) { onMessageCallback = callback; }
export function setOnDisconnect(callback) { onDisconnectCallback = callback; }

export function sendData(data, targetId = null) {
  const payloadStr = JSON.stringify(data);
  if (targetId) {
    const conn = connections[targetId];
    if (conn && conn.dataChannel && conn.dataChannel.readyState === 'open') {
      conn.dataChannel.send(payloadStr);
    }
  } else {
    Object.values(connections).forEach(conn => {
      if (conn.dataChannel && conn.dataChannel.readyState === 'open') {
        conn.dataChannel.send(payloadStr);
      }
    });
  }
}

export function isConnectionEstablished() {
  return Object.values(connections).some(conn => conn.dataChannel && conn.dataChannel.readyState === 'open');
}

function setupDataChannelHandlers(targetId, channel, onOpen) {
  channel.onopen = () => { onOpen(targetId); };
  channel.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (onMessageCallback) onMessageCallback(data, targetId);
  };
  channel.onclose = () => {
    if (onDisconnectCallback) onDisconnectCallback(targetId);
  };
}

// 特定のゲスト接続のみを破棄する関数
export function removeConnection(id) {
  if (connections[id]) {
    if (connections[id].pc) connections[id].pc.close();
    if (connections[id].dataChannel) connections[id].dataChannel.close();
    delete connections[id];
  }
}