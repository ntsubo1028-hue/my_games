// connection_3.js

// WebRTCの設定（Googleの公開STUNサーバーを利用）
const peerConfiguration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
    ]
};

let peerConnection = null;
let dataChannel = null;

/**
 * ICE Gathering（経路情報の収集）の完了を待つ関数（フリーズ防止のため3秒でタイムアウト）
 */
function waitForIceGathering(pc, timeoutMs = 3000) {
    return new Promise((resolve) => {
        if (pc.iceGatheringState === 'complete') {
            resolve();
            return;
        }

        const timer = setTimeout(() => {
            console.warn('ICE gathering timed out, proceeding with collected candidates.');
            pc.removeEventListener('icegatheringstatechange', checkState);
            resolve();
        }, timeoutMs);

        function checkState() {
            if (pc.iceGatheringState === 'complete') {
                clearTimeout(timer);
                pc.removeEventListener('icegatheringstatechange', checkState);
                resolve();
            }
        }

        pc.addEventListener('icegatheringstatechange', checkState);
    });
}

/**
 * ホスト（親機）側の接続情報（Offer）を作成し、圧縮して返す関数
 */
async function createHostOffer(onMessageCallback, onStatusChange) {
    if (peerConnection) peerConnection.close();
    
    peerConnection = new RTCPeerConnection(peerConfiguration);
    
    // データチャネルの作成 (Host側で作成必須)
    dataChannel = peerConnection.createDataChannel("gameDataChannel", {
        ordered: true
    });
    
    setupDataChannelEvents(dataChannel, onMessageCallback, onStatusChange);

    // Offer作成と適用
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    // 全ての経路情報が集まるまで待機
    await waitForIceGathering(peerConnection);

    // 完成したSDPを圧縮して出力
    const completeSdp = JSON.stringify(peerConnection.localDescription);
    return compressData(completeSdp);
}

/**
 * ゲスト（子機）側の接続情報（Answer）を作成し、圧縮して返す関数
 */
async function createGuestAnswer(hostCompressedSdp, onMessageCallback, onStatusChange) {
    if (peerConnection) peerConnection.close();

    peerConnection = new RTCPeerConnection(peerConfiguration);

    // DataChannel受信イベントの設定
    peerConnection.ondatachannel = (event) => {
        dataChannel = event.channel;
        setupDataChannelEvents(dataChannel, onMessageCallback, onStatusChange);
    };

    // ホストのOfferを解凍して設定
    try {
        const hostSdpRaw = decompressData(hostCompressedSdp);
        const hostOffer = JSON.parse(hostSdpRaw);
        await peerConnection.setRemoteDescription(new RTCSessionDescription(hostOffer));

        // Answer作成と適用
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);

        // 全ての経路情報が集まるまで待機
        await waitForIceGathering(peerConnection);

        // 完成したSDPを圧縮して出力
        const completeSdp = JSON.stringify(peerConnection.localDescription);
        return compressData(completeSdp);
    } catch (error) {
        console.error("Failed to create guest answer:", error);
        throw new Error("ホストのQRコードデータが無効か破損しています。");
    }
}

/**
 * ホスト側がゲストのAnswerを受け取り、接続を完了させる関数
 */
async function handleGuestAnswer(guestCompressedSdp) {
    if (!peerConnection) throw new Error("PeerConnectionが初期化されていません。");
    
    try {
        const guestSdpRaw = decompressData(guestCompressedSdp);
        const guestAnswer = JSON.parse(guestSdpRaw);
        await peerConnection.setRemoteDescription(new RTCSessionDescription(guestAnswer));
    } catch (error) {
        console.error("Failed to handle guest answer:", error);
        throw new Error("ゲストのQRコードデータが無効か破損しています。");
    }
}

/**
 * DataChannel（データ通信）のイベントハンドラを設定する関数
 */
function setupDataChannelEvents(channel, onMessage, onStatusChange) {
    channel.onopen = () => {
        console.log("DataChannel Connected!");
        if (onStatusChange) onStatusChange('connected');
    };

    channel.onclose = () => {
        console.log("DataChannel Closed");
        if (onStatusChange) onStatusChange('disconnected');
    };

    channel.onerror = (error) => {
        console.error("DataChannel Error:", error);
    };

    channel.onmessage = (event) => {
        if (onMessage) {
            try {
                const data = JSON.parse(event.data);
                onMessage(data);
            } catch (e) {
                // JSONでなければそのまま文字列として処理
                onMessage(event.data);
            }
        }
    };
}

/**
 * P2Pでメッセージを送信する関数（ゲームの通信用）
 */
function sendP2PMessage(data) {
    if (dataChannel && dataChannel.readyState === 'open') {
        const message = typeof data === 'string' ? data : JSON.stringify(data);
        dataChannel.send(message);
    } else {
        console.warn("DataChannelがオープンしていないため送信できませんでした。");
    }
}

/**
 * LZStringライブラリを使用した文字列の圧縮関数
 */
function compressData(stringData) {
    if (typeof LZString === 'undefined') {
        console.error("LZString library is not loaded.");
        return stringData;
    }
    return LZString.compressToEncodedURIComponent(stringData);
}

/**
 * LZStringライブラリを使用した文字列の解凍関数
 */
function decompressData(compressedData) {
    if (typeof LZString === 'undefined') {
        console.error("LZString library is not loaded.");
        return compressedData;
    }
    return LZString.decompressFromEncodedURIComponent(compressedData);
}