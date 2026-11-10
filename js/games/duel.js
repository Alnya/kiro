// 鬼面の武将 一騎討ち(3D): Three.js の SEKIROライクなボス戦。
// 各自が自分の端末でボスと1対1で戦う(ボスは別々)。相棒の進み具合(ボスの残りHPなど)がHUDに表示される。
import { DuelGame, QUALITY } from "../duel/game.js";

const Q_NAMES = { high: "高画質(PC向け)", standard: "標準(スマホ向け)", low: "軽量(古い端末)" };

function webglOK() {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch { return false; }
}
function defaultQuality() {
  const saved = localStorage.getItem("duelQuality");
  if (saved && QUALITY[saved]) return saved;
  const touch = matchMedia("(pointer: coarse)").matches;
  const cores = navigator.hardwareConcurrency || 4;
  if (!touch && cores >= 8) return "high";
  if (touch && (navigator.deviceMemory || 4) <= 2) return "low";
  return "standard";
}
const fmt = (t) => `${Math.floor(t / 60)}分${Math.round(t % 60)}秒`;

function create({ root, send }) {
  let game = null, ov = null, quality = defaultQuality();
  let rival = null;
  let best = JSON.parse(localStorage.getItem("duelBest") || "null");

  function rivalText() {
    if (!rival) return "";
    if (rival.done) return `相棒: 討伐成功!(${fmt(rival.time)}・パリィ${rival.parries}回)`;
    if (rival.state === "lose") return "相棒: 倒れた…";
    return `相棒: ボス${rival.bars > 1 ? "第1形態" : "第2形態"} 残り${Math.round(rival.hp * 100)}%`;
  }

  function renderStart(note) {
    root.innerHTML = `
      <div class="dl-start">
        <p class="note">SEKIROライクな<b>ボスとの1対1の一騎討ち</b>(3D)。敵の刃に合わせて防御するとパリィで弾き、体幹を崩して致命の一撃を狙おう。<br>戦うのはそれぞれの端末で、相棒の進み具合が画面に表示されます。</p>
        <label class="vs-opt">画質<select class="dl-q">${Object.entries(Q_NAMES).map(([k, v]) => `<option value="${k}"${k === quality ? " selected" : ""}>${v}</option>`).join("")}</select></label>
        <button class="primary dl-go">挑戦する</button>
        <details class="vs-help" open><summary>操作方法</summary>
          <p><b>スマホ</b>: 左の円でスティック移動 / 右のボタン: 攻撃・防御・回避・回復(🍶)<br>
          <b>パリィ</b>: 敵の刃が当たる直前(約0.2秒)に「防御」をタップ。ずっと押しっぱなしだとただの防御で、体幹が溜まる。<br>
          <b>危</b>: 赤く光る攻撃は防御できない。「回避」で避ける。<br>
          <b>PC</b>: WASD移動 / 左クリックかJ=攻撃 / 右クリックかK=防御 / Space=回避 / E=回復 / Esc=停止</p></details>
        ${best ? `<p class="status">自己ベスト: ${fmt(best.time)}(パリィ${best.parries}回・死亡${best.deaths}回)</p>` : ""}
        <p class="status">${note || ""}</p>
      </div>`;
    root.querySelector(".dl-q").onchange = (e) => { quality = e.target.value; localStorage.setItem("duelQuality", quality); };
    root.querySelector(".dl-go").onclick = begin;
  }

  function begin() {
    if (!webglOK()) { renderStart("この端末はWebGLに対応していないため遊べません。"); return; }
    ov = document.createElement("div");
    ov.className = "dl-ov";
    document.body.appendChild(ov);
    document.body.classList.add("vs-playing");
    const loading = document.createElement("div");
    loading.className = "dl-loading"; loading.textContent = "読み込み中…";
    ov.appendChild(loading);
    // テクスチャ生成が重いので、ローディング表示を描画してから構築する
    setTimeout(() => {
      try {
        game = new DuelGame(ov, {
          quality, seed: (Math.random() * 1e9) | 0,
          onProgress: (s) => send({ t: "prog", ...s }),
          onFinish: (r) => {
            send({ t: "done", ...r });
            if (!best || r.time < best.time) { best = r; localStorage.setItem("duelBest", JSON.stringify(r)); }
          },
          onExit: () => stop(),
        });
        game.setRival(rivalText());
        game.start();
      } catch (e) {
        console.error(e);
        stop();
        renderStart("読み込みに失敗しました: " + (e && e.message ? e.message : e));
      }
    }, 60);
  }

  function stop() {
    if (game) { game.destroy(); game = null; }
    if (ov) { ov.remove(); ov = null; }
    document.body.classList.remove("vs-playing");
    renderStart();
  }

  renderStart();
  return {
    onMessage(m) {
      if (m.t === "prog") { rival = { ...(rival || {}), ...m, done: rival && rival.done }; }
      else if (m.t === "done") { rival = { ...(rival || {}), ...m, done: true }; }
      if (game) game.setRival(rivalText());
    },
    destroy() {
      if (game) { game.destroy(); game = null; }
      if (ov) { ov.remove(); ov = null; }
      document.body.classList.remove("vs-playing");
    },
  };
}

export default {
  id: "duel",
  name: "鬼面の武将 一騎討ち(3D)",
  desc: "Three.jsの3Dボス戦。刃に合わせて防御でパリィ→体幹崩し→致命の一撃!SEKIROライクな一騎討ち",
  create,
};
