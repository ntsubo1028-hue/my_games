/**
 * Ranking System Module
 * - ランキング登録モーダル（名前の変更・コメント入力対応）
 * - スライド式ゲーム別ランキング閲覧モーダル（キャッシュ対応・通信節約版）
 * - 登録中の操作ブロック（ローディングオーバーレイ）対応
 */
import { getBlockDropScore } from './block_drop.js';
import { getSoloMinesweeperStats } from './minesweeper.js';
import { GAS_URL } from './gas_connection.js';

const RANKING_API_URL = GAS_URL;

const RANKING_GAMES = [
  { key: 'block_drop', name: '🧱 ブロックドロップ', unit: '点', type: 'score' },
  { key: 'minesweeper', name: '💣 マインスイーパー', unit: '秒', type: 'time' },
  { key: 'memory_lv1', name: '🧠 記憶力 (Lv.1)', unit: '秒', type: 'time' },
  { key: 'memory_lv2', name: '🧠 記憶力 (Lv.2)', unit: '秒', type: 'time' },
  { key: 'memory_lv3', name: '🧠 記憶力 (Lv.3)', unit: '秒', type: 'time' },
  { key: 'memory_lv4', name: '🧠 記憶力 (Lv.4)', unit: '秒', type: 'time' }
];

let currentSlideIndex = 0;
let rankingCache = {}; // ランキングデータの一時保存用キャッシュ

// ==========================================
// 1. UIモーダルの初期化・挿入
// ==========================================
export function initRankingSystem() {
  if (document.getElementById('ranking-system-container')) return;

  const containerHTML = `
    <div id="ranking-system-container">
      <!-- 🏆 ランキング登録モーダル -->
      <div id="ranking-register-modal" class="stamp-modal" style="display: none;">
        <div class="stamp-modal-content" style="max-width: 340px; text-align: left;">
          <h3 id="reg-modal-title" style="text-align: center; margin-top: 0; color: #2c3e50;">スコア登録</h3>
          <p id="reg-modal-score-display" style="text-align: center; font-weight: bold; font-size: 16px; color: #e65100; margin: 5px 0 15px 0;"></p>
          
          <div style="margin-bottom: 10px;">
            <label style="font-size: 12px; font-weight: bold; color: #555;">お名前 (修正可能):</label>
            <input type="text" id="reg-input-name" maxlength="10" style="width: 100%; padding: 8px; border-radius: 6px; border: 1px solid #ccc; font-size: 14px; box-sizing: border-box; margin-top: 4px;">
          </div>

          <div style="margin-bottom: 15px;">
            <label style="font-size: 12px; font-weight: bold; color: #555;">コメント (任意):</label>
            <input type="text" id="reg-input-comment" maxlength="20" placeholder="一言どうぞ！" style="width: 100%; padding: 8px; border-radius: 6px; border: 1px solid #ccc; font-size: 14px; box-sizing: border-box; margin-top: 4px;">
          </div>

          <div class="stamp-modal-actions" style="display: flex; gap: 10px;">
            <button id="btn-submit-ranking" class="btn-action" style="background-color: #4caf50; flex: 1;">登録する</button>
            <button id="btn-cancel-ranking" class="btn-action secondary-btn" style="flex: 1;">閉じる</button>
          </div>
        </div>
      </div>

      <!-- 📊 ランキング閲覧モーダル（スライド式） -->
      <div id="ranking-view-modal" class="modal-overlay" style="display: none;">
        <div class="modal-content" style="background: #fff; width: 90%; max-width: 400px; border-radius: 12px; padding: 20px; box-sizing: border-box; display: flex; flex-direction: column; max-height: 85vh;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
            <h3 style="margin: 0; color: #2c3e50;">🏆 オンラインランキング</h3>
            <button type="button" id="btn-close-ranking-view" class="btn-action secondary-btn" style="width: auto; padding: 4px 12px; font-size: 13px; margin: 0;">✕ 閉じる</button>
          </div>

          <!-- スライド切り替えヘッダー -->
          <div style="display: flex; justify-content: space-between; align-items: center; background: #f0f4f8; padding: 8px 12px; border-radius: 8px; margin-bottom: 15px;">
            <button id="btn-rank-prev" class="btn-action" style="width: auto; padding: 4px 10px; font-size: 14px; background-color: #607d8b; margin: 0;">◀</button>
            <span id="rank-current-game-title" style="font-weight: bold; font-size: 15px; color: #333;">ゲーム名</span>
            <button id="btn-rank-next" class="btn-action" style="width: auto; padding: 4px 10px; font-size: 14px; background-color: #607d8b; margin: 0;">▶</button>
          </div>

          <!-- ランキングリスト表示エリア -->
          <div id="rankings-list-body" style="flex: 1; overflow-y: auto; min-height: 250px; border: 1px solid #e0e0e0; border-radius: 8px; padding: 10px; background: #fafafa;">
            <p style="text-align: center; color: #888; margin-top: 50px;">読み込み中...</p>
          </div>
        </div>
      </div>

      <!-- 🔄 通信中操作ブロック用オーバーレイ -->
      <div id="ranking-loading-overlay" style="display: none; position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.4); z-index: 10005; justify-content: center; align-items: center;">
        <div style="background: rgba(0,0,0,0.85); color: #fff; padding: 16px 28px; border-radius: 10px; font-weight: bold; font-size: 15px; box-shadow: 0 4px 20px rgba(0,0,0,0.5);">
          登録中... しばらくお待ちください
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', containerHTML);

  document.getElementById('btn-cancel-ranking').onclick = () => {
    document.getElementById('ranking-register-modal').style.display = 'none';
  };
  document.getElementById('btn-close-ranking-view').onclick = () => {
    document.getElementById('ranking-view-modal').style.display = 'none';
  };

  document.getElementById('btn-rank-prev').onclick = () => {
    currentSlideIndex = (currentSlideIndex - 1 + RANKING_GAMES.length) % RANKING_GAMES.length;
    renderRankingSlide();
  };
  document.getElementById('btn-rank-next').onclick = () => {
    currentSlideIndex = (currentSlideIndex + 1) % RANKING_GAMES.length;
    renderRankingSlide();
  };
}

// ==========================================
// 2. ランキング登録モーダルの制御
// ==========================================
let pendingExtraData = null;

export function openRankingRegisterModal(gameKey, value, extraData = null) {
  initRankingSystem();
  pendingExtraData = extraData;

  const gameConfig = RANKING_GAMES.find(g => g.key === gameKey);
  if (!gameConfig) return;

  const titleEl = document.getElementById('reg-modal-title');
  const scoreDisplayEl = document.getElementById('reg-modal-score-display');
  const nameInputEl = document.getElementById('reg-input-name');
  const commentInputEl = document.getElementById('reg-input-comment');

  titleEl.innerText = `${gameConfig.name} ランクイン！`;
  scoreDisplayEl.innerText = `記録: ${value} ${gameConfig.unit}`;

  const savedName = localStorage.getItem('player_name') || 'ホスト';
  nameInputEl.value = savedName;
  commentInputEl.value = '';

  document.getElementById('ranking-register-modal').style.display = 'flex';

  document.getElementById('btn-submit-ranking').onclick = async () => {
    const finalName = nameInputEl.value.trim() || 'ホスト';
    const comment = commentInputEl.value.trim();

    localStorage.setItem('player_name', finalName);
    document.getElementById('ranking-register-modal').style.display = 'none';
    
    await sendRankingData(gameKey, value, finalName, comment, pendingExtraData);
  };
}

// ==========================================
// 3. GASサーバーとの通信（操作ブロック用オーバーレイ対応）
// ==========================================
async function sendRankingData(gameKey, value, name, comment, extraData) {
  let finalComment = comment;
  if (gameKey === 'block_drop' && extraData !== null && extraData !== undefined) {
    const lineText = `ライン数: ${extraData}`;
    finalComment = finalComment ? `${finalComment} (${lineText})` : lineText;
  }

  // 日本時間（JST / UTC+9）に補正した日時文字列を作成
  const now = new Date();
  const jstDate = new Date(now.getTime() + (9 * 60 * 60 * 1000));
  const datetimeStr = jstDate.toISOString().replace('T', ' ').substring(0, 16);

  const payload = {
    action: "register",
    gameKey: gameKey,
    name: name,
    datetime: datetimeStr,
    value: value,
    comment: finalComment
  };

  // ★ 登録ボタンを押した瞬間から、結果が出るまで画面全体をロックするオーバーレイを表示
  const loadingOverlay = document.getElementById('ranking-loading-overlay');
  if (loadingOverlay) loadingOverlay.style.display = 'flex';

  try {
    const res = await fetch(RANKING_API_URL, {
      method: "POST",
      body: JSON.stringify(payload)
    });
    const result = await res.json();

    // ★ 通信が完了したらオーバーレイを非表示にする
    if (loadingOverlay) loadingOverlay.style.display = 'none';

    if (result.status === "success") {
      if (result.rankings) {
        rankingCache[gameKey] = result.rankings;
      }

      // サーバーから返された正確な順位 (result.rank) を表示する
      const rank = result.rank;
      if (rank <= 10) {
        alert(`🎉 おめでとうございます！第 ${rank} 位にランクインしました！`);
      } else {
        alert(`スコアを登録しました！あなたの順位は第 ${rank} 位でした！`);
      }
      
      openRankingViewModal(gameKey);
    } else {
      alert("登録に失敗しました: " + result.message);
    }
  } catch (e) {
    // エラー時も確実にオーバーレイを消す
    if (loadingOverlay) loadingOverlay.style.display = 'none';
    console.error("ランキング送信エラー:", e);
    alert("通信エラーが発生しました。");
  }
}

async function fetchRankings(gameKey) {
  if (rankingCache[gameKey]) {
    return rankingCache[gameKey];
  }

  try {
    const res = await fetch(RANKING_API_URL, {
      method: "POST",
      body: JSON.stringify({ action: "get", gameKey: gameKey })
    });
    const result = await res.json();
    if (result.status === "success") {
      rankingCache[gameKey] = result.rankings;
      return result.rankings;
    }
  } catch (e) {
    console.error("ランキング取得エラー:", e);
  }
  return [];
}

// ==========================================
// 4. スライド式ランキング閲覧モーダルの制御
// ==========================================
export async function openRankingViewModal(initialGameKey = 'block_drop', skipCache = false) {
  initRankingSystem();
  
  // ★ メニュー等から開いた場合（skipCache=true）はキャッシュをクリアして最新を一括取得する
  if (skipCache) {
    rankingCache = {};
  }

  const foundIdx = RANKING_GAMES.findIndex(g => g.key === initialGameKey);
  currentSlideIndex = foundIdx !== -1 ? foundIdx : 0;

  const modal = document.getElementById('ranking-view-modal');
  const listBody = document.getElementById('rankings-list-body');
  modal.style.display = 'flex';

  // まだキャッシュされていないゲームがあれば、すべてのゲームのランキングを一括で並列取得する
  const uncachedGames = RANKING_GAMES.filter(g => !rankingCache[g.key]);
  if (uncachedGames.length > 0) {
    listBody.innerHTML = '<p style="text-align: center; color: #888; margin-top: 50px;">すべてのランキングを読み込み中...</p>';
    
    // 全ゲーム分を並列フェッチで一括取得
    await Promise.all(RANKING_GAMES.map(async (g) => {
      if (!rankingCache[g.key]) {
        await fetchRankings(g.key);
      }
    }));
  }

  renderRankingSlide();
}

async function renderRankingSlide() {
  const gameConfig = RANKING_GAMES[currentSlideIndex];
  document.getElementById('rank-current-game-title').innerText = gameConfig.name;

  const listBody = id => document.getElementById('rankings-list-body');
  const listBodyEl = listBody();

  // すでに一括キャッシュされているため、ここでの非同期待ちやロード表示は不要になります
  const rankings = rankingCache[gameConfig.key] || [];

  if (!rankings || rankings.length === 0) {
    listBodyEl.innerHTML = '<p style="text-align: center; color: #888; margin-top: 50px;">まだランキングデータがありません。</p>';
    return;
  }

  let html = '<table style="width: 100%; border-collapse: collapse; font-size: 13px;">';
  html += '<tr style="border-bottom: 2px solid #ccc; text-align: left; color: #555;"><th style="padding: 6px; width: 35px;">順位</th><th style="padding: 6px;">名前 / コメント</th><th style="padding: 6px; text-align: right;">記録</th></tr>';

  rankings.forEach((item, index) => {
    const rank = index + 1;
    let rankBadge = `${rank}位`;
    if (rank === 1) rankBadge = '🥇 1位';
    else if (rank === 2) rankBadge = '🥈 2位';
    else if (rank === 3) rankBadge = '🥉 3位';

    html += `
      <tr style="border-bottom: 1px solid #eee;">
        <td style="padding: 8px 6px; font-weight: bold; color: #333; vertical-align: top;">${rankBadge}</td>
        <td style="padding: 8px 6px; vertical-align: top;">
          <div style="font-weight: bold; color: #2c3e50;">${escapeHTML(item.name)}</div>
          ${item.comment ? `<div style="font-size: 11px; color: #666; margin-top: 2px;">💬 ${escapeHTML(item.comment)}</div>` : ''}
          <div style="font-size: 10px; color: #999; margin-top: 1px;">${item.datetime}</div>
        </td>
        <td style="padding: 8px 6px; font-weight: bold; color: #e65100; text-align: right; vertical-align: middle; white-space: nowrap;">
          ${item.value} ${gameConfig.unit}
        </td>
      </tr>
    `;
  });
  html += '</table>';

  listBodyEl.innerHTML = html;
}

function escapeHTML(str) {
  return str.replace(/[&<>'"]/g, 
    tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
  );
}