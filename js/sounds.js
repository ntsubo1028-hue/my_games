// js/sound.js
const sounds = {
  put: new Audio('sounds/put.mp3'),
  flip: new Audio('sounds/flip.mp3'),
  line: new Audio('sounds/line.mp3'),
  box: new Audio('sounds/box.mp3'),
  win: new Audio('sounds/win.mp3')
};

export function playSound(name) {
  if (sounds[name]) {
    // 連続して鳴っても音が途切れないようにクローンして再生
    const clone = sounds[name].cloneNode(true);
    clone.volume = 0.5; // うるさすぎないように音量を50%に
    clone.play().catch(e => console.log("ブラウザの自動再生ブロック、またはファイル未検出", e));
  }
}