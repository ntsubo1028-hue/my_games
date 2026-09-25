let pc = null;
let dataChannel = null;
let onMessageCallback = null;
let html5QrCodeScanner = null;

/**
 * ICE Candidate（通信経路候補）の収集が完了するまで待つヘルパー関数
 */
function waitForIceGathering(peerConnection) {
  return new Promise((resolve) => {
    if (peerConnection.iceGatheringState === 'complete') {
      resolve();
    } else {
      const checkState = () => {
        if (peerConnection.iceGatheringState === 'complete') {
          peerConnection.removeEventListener('icegatheringstatechange', checkState);
          resolve();
        }
      };
      peerConnection.addEventListener('icegatheringstatechange', checkState);
    }
  });
}

/**
 * 接続状態のリセット
 */
export function initConnection() {
  if (dataChannel) {
    dataChannel.close();
    dataChannel = null;
  }
  if (pc) {
    pc.close();
    pc = null;
  }
}

/**
 * ホスト側の接続セットアップ
 */
export async function setupHostConnection(onOpenCallback) {
  initConnection();

  // STUNサーバーの設定（localhostおよび外部通信用）
  pc = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
  });

  // 1. ホスト側からDataChannelを作成
  dataChannel = pc.createDataChannel('gameChannel');

  dataChannel.onopen = () => {
    console.log("DataChannel Opened (Host)");
    if (onOpenCallback) onOpenCallback();
  };

  dataChannel.onmessage = (event) => {
    if (onMessageCallback) {
      try {
        const parsed = JSON.parse(event.data);
        onMessageCallback(parsed);
      } catch (e) {
        console.error("メッセージ解析エラー:", e);
      }
    }
  };

  pc.oniceconnectionstatechange = () => {
    console.log("Host ICE State:", pc.iceConnectionState);
  };

  // Offer作成と設定
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  // 【重要】全ICE Candidateの収集完了を待機
  await waitForIceGathering(pc);

  // Candidateが含まれた状態のlocalDescriptionを返す
  return pc.localDescription;
}

/**
 * ゲスト側の接続セットアップ
 */
export async function setupGuestConnection(offerObj, onOpenCallback) {
  initConnection();

  pc = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
  });

  // ゲスト側はホスト側から渡される DataChannel を受信用イベントで取得
  pc.ondatachannel = (event) => {
    dataChannel = event.channel;

    dataChannel.onopen = () => {
      console.log("DataChannel Opened (Guest)");
      if (onOpenCallback) onOpenCallback();
    };

    dataChannel.onmessage = (e) => {
      if (onMessageCallback) {
        try {
          const parsed = JSON.parse(e.data);
          onMessageCallback(parsed);
        } catch (err) {
          console.error("メッセージ解析エラー:", err);
        }
      }
    };
  };

  pc.oniceconnectionstatechange = () => {
    console.log("Guest ICE State:", pc.iceConnectionState);
  };

  // ホストのOfferを設定し、Answerを生成
  await pc.setRemoteDescription(new RTCSessionDescription(offerObj));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  // 【重要】全ICE Candidateの収集完了を待機
  await waitForIceGathering(pc);

  return pc.localDescription;
}

/**
 * ホスト側でゲストからのAnswerを設定する処理
 */
export async function handleGuestAnswer(answerObj) {
  if (!pc) throw new Error("RTCPeerConnectionが初期化されていません。");
  await pc.setRemoteDescription(new RTCSessionDescription(answerObj));
}

/**
 * データ送信関数
 */
export function sendData(data) {
  if (dataChannel && dataChannel.readyState === 'open') {
    dataChannel.send(JSON.stringify(data));
  } else {
    console.warn("DataChannelが開いていないため、データを送信できませんでした。", data);
  }
}

/**
 * 受信メッセージコールバックの登録
 */
export function setOnMessage(callback) {
  onMessageCallback = callback;
}

/* ==========================================================================
   QRコード生成・スキャン関連ユーティリティ
   ========================================================================== */

/**
 * 接続情報オブジェクトからQRコードを表示（LZStringで圧縮）
 */
export function generateMultiPartQR(containerId, localDesc, gameType) {
  const container = document.getElementById(containerId);
  const qrcodeElem = document.getElementById('qrcode');
  if (!qrcodeElem) return;

  qrcodeElem.innerHTML = '';

  const payload = {
    type: localDesc.type,
    sdp: localDesc.sdp,
    gameType: gameType
  };

  const compressedStr = LZString.compressToBase64(JSON.stringify(payload));

  // QRCode.js等での描画想定
  if (typeof QRCode !== 'undefined') {
    new QRCode(qrcodeElem, {
      text: compressedStr,
      width: 200,
      height: 200,
      correctLevel: QRCode.CorrectLevel.L
    });
  } else {
    console.warn("QRCodeライブラリが読み込まれていません。");
  }
}

/**
 * カメラを使ったQRコード読み取り開始
 */
export function startMultiPartScan(onSuccess, onCameraStart, onScanCancel) {
  if (typeof Html5Qrcode === 'undefined') {
    alert("QRコードスキャナライブラリが読み込まれていません。");
    return;
  }

  if (onCameraStart) onCameraStart();

  const qrRegionId = "qr-reader";
  html5QrCodeScanner = new Html5Qrcode(qrRegionId);

  html5QrCodeScanner.start(
    { facingMode: "environment" },
    { fps: 10, qrbox: { width: 250, height: 250 } },
    (decodedText) => {
      try {
        const decompressed = LZString.decompressFromBase64(decodedText);
        const parsed = JSON.parse(decompressed);
        
        cancelScan(() => {
          if (onSuccess) onSuccess(parsed);
        });
      } catch (e) {
        console.error("QRコードの解読に失敗しました:", e);
      }
    },
    (errorMessage) => {
      // 読み取り中のエラーログ（無視して継続）
    }
  ).catch((err) => {
    console.error("カメラの起動に失敗しました:", err);
    alert("カメラの起動に失敗しました。カメラ権限を確認してください。");
    if (onScanCancel) onScanCancel();
  });
}

/**
 * QRコードスキャナの停止
 */
export function cancelScan(callback) {
  if (html5QrCodeScanner) {
    html5QrCodeScanner.stop().then(() => {
      html5QrCodeScanner.clear();
      html5QrCodeScanner = null;
      if (callback) callback();
    }).catch((err) => {
      console.error("スキャナの停止処理エラー:", err);
      html5QrCodeScanner = null;
      if (callback) callback();
    });
  } else {
    if (callback) callback();
  }
}