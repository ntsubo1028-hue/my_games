// gas_connection.js
import { initConnection, setupHostConnection, setupGuestConnection, handleGuestAnswer } from './connection.js';

const GAS_URL = 'https://script.google.com/macros/s/AKfycbxyPlpWlVOkLLFwYZG2fjlPo-2pZrm8O0UjqmLg4bA5RJ58H4jASboz4MxwQUU-jq1I/exec'; // ←ご自身のURL

/**
 * 【ホスト側】解放されているスロット分だけ接続情報を生成（または更新）して接続コードを発行する
 */
export async function createOrUpdateDynamicGasRoom(currentCode, selectedGame, targetSlots, onGuestConnected, onStatusChange) {
  if (!targetSlots || targetSlots.length === 0) {
    throw new Error("追加する空き枠がありません。");
  }

  onStatusChange(`接続情報を作成中 (${targetSlots.join(', ')})...`);
  const offers = {};
  const processedAnswers = new Set();
  
  try {
    for (const guestId of targetSlots) {
      onStatusChange(`${guestId} の準備中...`);
      const localDesc = await setupHostConnection(guestId, (connectedId) => {
        onGuestConnected(connectedId);
      });
      
      const plainDesc = typeof localDesc.toJSON === 'function' ? localDesc.toJSON() : localDesc;
      
      const sdpData = {
        type: String(plainDesc.type || 'offer'),
        sdp: String(plainDesc.sdp || ''),
        gameType: selectedGame
      };
      
      offers[guestId] = LZString.compressToBase64(JSON.stringify(sdpData));
    }

    onStatusChange("GASサーバーに接続コードを登録中...");
    const res = await fetch(GAS_URL, {
      method: 'POST',
      body: JSON.stringify({ 
        action: 'upsertRoom',
        roomCode: currentCode || null,
        gameType: selectedGame,
        offers: offers
      })
    });
    const result = await res.json();
    if (result.status !== 'success') throw new Error(result.message || '接続コードの登録に失敗しました');
    
    const roomCode = result.roomCode;
    onStatusChange(`接続コード: ${roomCode}\nゲストの参加を待っています...`);

    // 定期チェック
    const syncInterval = setInterval(async () => {
      try {
        const checkRes = await fetch(GAS_URL, {
          method: 'POST',
          body: JSON.stringify({ action: 'checkRoom', roomCode: roomCode })
        });
        const checkResult = await checkRes.json();
        
        if (checkResult.status === 'success' && checkResult.guestAnswers) {
          for (const guestId in checkResult.guestAnswers) {
            const answerPayload = checkResult.guestAnswers[guestId];
            if (answerPayload && !processedAnswers.has(guestId)) {
              processedAnswers.add(guestId);
              
              const decompressed = LZString.decompressFromBase64(answerPayload);
              const answerObj = JSON.parse(decompressed);
              
              onStatusChange(`${guestId} から返信を受信。接続中...`);
              await handleGuestAnswer(guestId, answerObj);
            }
          }
        }
      } catch (e) {
        console.error("同期ループエラー:", e);
      }
    }, 3000);

    return roomCode;

  } catch (e) {
    onStatusChange("エラー: " + e.message);
    throw e;
  }
}

/**
 * 【ゲスト側】4桁の接続コードを入力して参加する
 */
export async function joinDynamicGasRoom(roomCode, onOpen, onStatusChange) {
  initConnection();
  onStatusChange("接続コードを検索しています...");
  
  try {
    const res = await fetch(GAS_URL, {
      method: 'POST',
      body: JSON.stringify({ action: 'getRoomInfo', roomCode: roomCode })
    });
    const result = await res.json();
    if (result.status !== 'success' || !result.hostSdp) {
      throw new Error(result.message || '満員か、接続準備ができていません');
    }

    const assignedGuestId = result.assignedGuestId; // 例: guest-1, guest-2 など
    onStatusChange(`空き枠 (${assignedGuestId}) を取得しました。接続中...`);
    
    const decompressed = LZString.decompressFromBase64(result.hostSdp);
    const offerObj = JSON.parse(decompressed);
    
    // ★ 接続成功時に、割り当てられた assignedGuestId をコールバックに渡すように修正
    const localDesc = await setupGuestConnection(offerObj, () => {
      onOpen(assignedGuestId);
    });
    
    const plainDesc = typeof localDesc.toJSON === 'function' ? localDesc.toJSON() : localDesc;
    const answerData = {
      type: String(plainDesc.type || 'answer'),
      sdp: String(plainDesc.sdp || '')
    };
    const answerPayload = LZString.compressToBase64(JSON.stringify(answerData));

    onStatusChange("ホストに接続情報を送信中...");

    const answerRes = await fetch(GAS_URL, {
      method: 'POST',
      body: JSON.stringify({
        action: 'answerRoom',
        roomCode: roomCode,
        guestId: assignedGuestId,
        guestSdp: answerPayload
      })
    });
    const answerResult = await answerRes.json();
    if (answerResult.status !== 'success') {
      throw new Error('返信の送信に失敗しました');
    }

    onStatusChange("接続が完了しました！");
    return offerObj.gameType || 'reversi';

  } catch (e) {
    onStatusChange("エラー: " + e.message);
    throw e;
  }
}