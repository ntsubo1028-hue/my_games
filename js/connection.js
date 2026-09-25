let pc = null;
let dataChannel = null;
let onMessageCallback = null;
let html5QrCodeScanner = null;

/**
 * ICE Candidate（通信経路候補）の収集を最大2秒間だけ待つ（タイムアウト付き）
 */
function waitForIceGathering(peerConnection, timeoutMs = 2000) {
  return new Promise((resolve) => {
    if (peerConnection.iceGatheringState === 'complete') {
      resolve();
      return;
    }

    const timer = setTimeout(() => {
      peerConnection.removeEventListener('icegatheringstatechange', checkState);
      console.log("ICE Candidateの収集をタイムアウトで完了とします");
      resolve();
    }, timeoutMs);

    const checkState = () => {
      if (peerConnection.iceGatheringState === 'complete') {
        clearTimeout(timer);
        peerConnection.removeEventListener('icegatheringstatechange', checkState);
        resolve();
      }
    };
    peerConnection.addEventListener('icegatheringstatechange', checkState);
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

  // STUNサーバーの設定（インターネット越しのマッチング用）
  pc = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
  });

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

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  // タイムアウト付きの待機処理で高速化
  await waitForIceGathering(pc);

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

  await pc.setRemoteDescription(new RTCSessionDescription(offerObj));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  // タイムアウト付きの待機処理で高速化
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
  const qrcodeElem = document.getElementById('qrcode');
  if (!qrcodeElem) return;

  qrcodeElem.innerHTML = '';

  const payload = {
    type: localDesc.type,
    sdp: localDesc.sdp,
    gameType: gameType
  };

  const compressedStr = LZString.compressToBase64(JSON.stringify(payload));

  if (typeof QRCode !== 'undefined') {
    new QRCode(qrcodeElem, {
      text: compressedStr,
      width: 250,
      height: 250,
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

  // 1. まず画面を切り替えてDOM要素を可視化する
  if (onCameraStart) onCameraStart();

  // 2. 画面が描画されるのを少し待ってからカメラを起動する
  setTimeout(() => {
    const qrRegion = document.getElementById("qr-reader");
    if (!qrRegion) {
      console.error("HTML要素 #qr-reader が見つかりません。");
      alert("カメラ表示用要素が見つかりませんでした。");
      if (onScanCancel) onScanCancel();
      return;
    }

    html5QrCodeScanner = new Html5Qrcode("qr-reader");

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
        // 読み取り中の軽微なエラーログは無視する
      }
    ).catch((err) => {
      console.error("カメラの起動に失敗しました:", err);
      alert("カメラの起動に失敗しました。カメラ権限を確認してください。");
      if (onScanCancel) onScanCancel();
    });
  }, 100);
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