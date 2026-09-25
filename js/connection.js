let pc = null;
let dataChannel = null;
let onMessageCallback = null;
let html5QrCodeScanner = null;

// パートごとの定義色（1:赤, 2:青, 3:黄）
const PART_COLORS = [
  { name: '赤', color: '#e53935', bg: '#ffebee' },
  { name: '青', color: '#1e88e5', bg: '#e3f2fd' },
  { name: '黄', color: '#fbc02d', bg: '#fffde7' }
];

/**
 * ICE Candidate（通信経路候補）の収集を最大2秒間だけ待つ
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
   3分割QRコード（赤・青・黄）生成・スキャン機能
   ========================================================================== */

/**
 * 接続情報を 赤・青・黄 の3つのQRコードに分割して表示
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
  const totalParts = 3;
  const chunkSize = Math.ceil(compressedStr.length / totalParts);

  for (let i = 0; i < totalParts; i++) {
    const chunk = compressedStr.slice(i * chunkSize, (i + 1) * chunkSize);
    const partData = `PART:${i + 1}/${totalParts}:${chunk}`;
    const theme = PART_COLORS[i] || { name: `${i + 1}`, color: '#333', bg: '#f0f0f0' };

    const partWrapper = document.createElement('div');
    partWrapper.style.margin = "6px 0";
    partWrapper.style.padding = "8px";
    partWrapper.style.textAlign = "center";
    partWrapper.style.border = `3px solid ${theme.color}`;
    partWrapper.style.borderRadius = "8px";
    partWrapper.style.backgroundColor = theme.bg;
    partWrapper.style.width = "100%";
    partWrapper.style.boxSizing = "border-box";

    const title = document.createElement('p');
    title.style.margin = "0 0 6px 0";
    title.style.fontSize = "14px";
    title.style.fontWeight = "bold";
    title.style.color = theme.color;
    title.innerText = `【${i + 1}/3】${theme.name}色のQRコード`;

    const qrDiv = document.createElement('div');
    qrDiv.id = `qrcode-part-${i + 1}`;
    qrDiv.style.display = "inline-block";

    partWrapper.appendChild(title);
    partWrapper.appendChild(qrDiv);
    qrcodeElem.appendChild(partWrapper);

    if (typeof QRCode !== 'undefined') {
      new QRCode(qrDiv, {
        text: partData,
        width: 160,
        height: 160,
        correctLevel: QRCode.CorrectLevel.L
      });
    } else {
      console.warn("QRCodeライブラリが読み込まれていません。");
    }
  }
}

/**
 * カメラを使った 赤・青・黄 QRコードの読み取り
 */
export function startMultiPartScan(onSuccess, onCameraStart, onScanCancel) {
  if (typeof Html5Qrcode === 'undefined') {
    alert("QRコードスキャナライブラリが読み込まれていません。");
    return;
  }

  if (onCameraStart) onCameraStart();

  setTimeout(() => {
    const qrRegion = document.getElementById("qr-reader");
    if (!qrRegion) {
      alert("カメラ表示用要素が見つかりませんでした。");
      if (onScanCancel) onScanCancel();
      return;
    }

    const badgeContainer = document.getElementById("scan-badge-container");
    const scanGuide = document.getElementById("scan-guide-text");

    const collectedParts = {};
    let isProcessing = false;

    const updateStatusUI = () => {
      if (badgeContainer) {
        badgeContainer.innerHTML = '';
        PART_COLORS.forEach((theme, idx) => {
          const partNum = idx + 1;
          const isDone = !!collectedParts[partNum];
          const badge = document.createElement('span');
          badge.style.display = "inline-block";
          badge.style.padding = "4px 8px";
          badge.style.margin = "0 3px";
          badge.style.borderRadius = "12px";
          badge.style.fontSize = "12px";
          badge.style.fontWeight = "bold";
          badge.style.color = isDone ? "#fff" : theme.color;
          badge.style.backgroundColor = isDone ? theme.color : theme.bg;
          badge.style.border = `2px solid ${theme.color}`;
          badge.innerText = `${theme.name} ${isDone ? '✓' : ''}`;
          badgeContainer.appendChild(badge);
        });
      }

      const count = Object.keys(collectedParts).length;
      if (scanGuide) {
        if (count === 0) {
          scanGuide.innerText = "赤・青・黄のQRコードをかざしてください";
        } else if (count < 3) {
          scanGuide.innerText = `【${count}/3】読み取り成功！残りのQRコードをかざしてください`;
        } else {
          scanGuide.innerText = "全コード完了！接続しています...";
        }
      }
    };

    updateStatusUI();

    html5QrCodeScanner = new Html5Qrcode("qr-reader");

    html5QrCodeScanner.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 220, height: 220 } },
      (decodedText) => {
        if (isProcessing) return;

        if (decodedText.startsWith("PART:")) {
          const match = decodedText.match(/^PART:(\d+)\/(\d+):(.+)$/s);
          if (match) {
            const partIdx = parseInt(match[1], 10);
            const totalParts = parseInt(match[2], 10);
            const chunk = match[3];

            if (!collectedParts[partIdx]) {
              collectedParts[partIdx] = chunk;
              updateStatusUI();

              if (Object.keys(collectedParts).length === totalParts) {
                isProcessing = true;

                let fullCompressed = "";
                for (let i = 1; i <= totalParts; i++) {
                  fullCompressed += collectedParts[i];
                }

                try {
                  const decompressed = LZString.decompressFromBase64(fullCompressed);
                  const parsed = JSON.parse(decompressed);

                  cancelScan(() => {
                    if (onSuccess) onSuccess(parsed);
                  });
                } catch (e) {
                  console.error("データ復元エラー:", e);
                  alert("QRコードの復元に失敗しました。最初からやり直してください。");
                  cancelScan(() => {
                    if (onScanCancel) onScanCancel();
                  });
                }
              }
            }
          }
        } else {
          // 単一QRコード互換
          try {
            const decompressed = LZString.decompressFromBase64(decodedText);
            const parsed = JSON.parse(decompressed);
            isProcessing = true;
            cancelScan(() => {
              if (onSuccess) onSuccess(parsed);
            });
          } catch (e) {}
        }
      },
      () => {}
    ).catch((err) => {
      console.error("カメラ起動エラー:", err);
      alert("カメラの起動に失敗しました。");
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
      console.error("スキャナ停止エラー:", err);
      html5QrCodeScanner = null;
      if (callback) callback();
    });
  } else {
    if (callback) callback();
  }
}