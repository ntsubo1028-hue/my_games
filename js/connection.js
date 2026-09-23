import { playSound } from './sounds.js'; // ★ 効果音モジュールを追加インポート

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

// SDPからデータ通信に関係ない不要な行を削除しデータ量を半減させる関数
function filterSdp(sdp) {
  if (!sdp) return '';
  return sdp
    .split('\r\n')
    .filter(line => {
      return !line.startsWith('a=extmap:') &&
             !line.startsWith('a=rtcp-fb:') &&
             !line.startsWith('a=fmtp:') &&
             !line.startsWith('a=rtcp:') &&
             !line.startsWith('a=ssrc:') &&
             !line.startsWith('a=msid:') &&
             !line.startsWith('a=mid:');
    })
    .join('\r\n');
}

// 3枚のQRコードを同時生成する（軽量化適用）
export function generateMultiPartQR(statusId, sdpObj, gameType = 'othello') {
  const cleanedSdp = filterSdp(sdpObj.sdp);
  const compactData = { t: sdpObj.type, s: cleanedSdp, g: gameType };
  const jsonString = JSON.stringify(compactData);
  const fullStr = LZString.compressToBase64(jsonString);
  
  const len = Math.ceil(fullStr.length / 3);
  const parts = [
    "1:" + fullStr.slice(0, len),
    "2:" + fullStr.slice(len, len * 2),
    "3:" + fullStr.slice(len * 2)
  ];
  
  const statusEl = document.getElementById(statusId);
  statusEl.className = 'loading-text';
  statusEl.innerText = "相手に3つのQRコードを順に読ませてください";

  for (let i = 1; i <= 3; i++) {
    const imgEl = document.getElementById(`conn-qr-${i}`);
    const data = parts[i - 1];
    imgEl.src = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&ecc=L&data=${encodeURIComponent(data)}`;
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
  
  document.getElementById('indicator-1').innerText = "⬜ 🔴赤";
  document.getElementById('indicator-2').innerText = "⬜ 🔵青";
  document.getElementById('indicator-3').innerText = "⬜ 🟡黄";

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
    if (text.startsWith("1:") || text.startsWith("2:") || text.startsWith("3:")) {
      const partNum = text[0];
      const payload = text.slice(2);
      
      // まだ読んでいない色なら登録してUI・音・バイブを更新
      if (!scannedParts[partNum]) {
        scannedParts[partNum] = payload;
        
        // ★ 1枚成功時のアクション（音＋バイブ）
        playSound('put'); // オセロ等で使っている石を置く音などを流用
        if (navigator.vibrate) navigator.vibrate(100);

        const indicator = document.getElementById(`indicator-${partNum}`);
        if (partNum === '1') indicator.innerText = "✅ 🔴赤";
        if (partNum === '2') indicator.innerText = "✅ 🔵青";
        if (partNum === '3') indicator.innerText = "✅ 🟡黄";

        // 3つ全て揃った場合の処理
        if (scannedParts['1'] && scannedParts['2'] && scannedParts['3']) {
          isScanComplete = true; // 多重発火を防止

          // ★ 全枚数成功時のアクション（音＋バイブ）
          setTimeout(() => playSound('win'), 200); // 少し遅らせて勝利音(完了音)を鳴らす
          if (navigator.vibrate) navigator.vibrate([100, 50, 150]);

          html5QrCode.stop().then(() => {
            html5QrCode.clear();
            html5QrCode = null;
            
            const fullStr = scannedParts['1'] + scannedParts['2'] + scannedParts['3'];
            const decompressed = LZString.decompressFromBase64(fullStr);
            const parsed = JSON.parse(decompressed);
            
            currentScanCallback({ type: parsed.t, sdp: parsed.s, gameType: parsed.g || 'othello' });
            onScanDone();
          });
        }
      }
    }
  } catch(e) {
    // 読み取りミス時は無視してスキャン継続
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