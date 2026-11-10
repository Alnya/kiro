// 鬼面の武将 一騎討ち(3D): Three.js の SEKIROライクな剣戟アクション。
//  - ボス戦(ひとり): 各自が自分の端末でボスと戦う。相棒の進み具合(ボスの残りHPなど)がHUDに表示される。
//  - 対人戦(2人): 二人の剣士で斬り合う。ロックステップ通信(js/duel/pvpgame.js)で両端末の戦いを一致させる。
import { DuelGame, QUALITY } from "../duel/game.js";
import { PvpGame } from "../duel/pvpgame.js";

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
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmt = (t) => `${Math.floor(t / 60)}分${Math.round(t % 60)}秒`;

function create({ root, role, send, names = { me: "あなた", opp: "相手" } }) {
  const me = role === 1 ? 1 : 0;
  let game = null, ov = null, quality = defaultQuality();
  let rival = null;
  let best = JSON.parse(localStorage.getItem("duelBest") || "null");
  // 対人戦
  let pvpGame = null, ready = false, remoteReady = false, buffer = [];
  let record = JSON.parse(localStorage.getItem("duelPvpRecord") || '{"w":0,"l":0,"d":0}');

  function rivalText() {
    if (remoteReady && !pvpGame) return `${names.opp}が対人戦の準備をして待っています`;
    if (!rival) return "";
    if (rival.done) return `${names.opp}: 討伐成功!(${fmt(rival.time)}・パリィ${rival.parries}回)`;
    if (rival.state === "lose") return `${names.opp}: 倒れた…`;
    return `${names.opp}: ボス${rival.bars > 1 ? "第1形態" : "第2形態"} 残り${Math.round(rival.hp * 100)}%`;
  }

  function renderStart(note) {
    if (game || pvpGame) return;
    const pvpStatus = ready
      ? `<p class="status dl-ready">対人戦の準備OK。${remoteReady ? "まもなく開始…" : `${esc(names.opp)}が「対人戦」を押すのを待っています…`}</p>`
      : remoteReady ? `<p class="status dl-ready">${esc(names.opp)}が対人戦の準備をして待っています!</p>` : "";
    root.innerHTML = `
      <div class="dl-start">
        <p class="note">SEKIROライクな<b>3Dの一騎討ち</b>。相手の刃に合わせて防御するとパリィで弾き、体幹を崩して致命の一撃を狙おう。</p>
        <div class="dl-modes">
          ${ready ? '<button class="dl-cancel">対人戦の準備を取り消す</button>'
            : `<button class="primary dl-go">ボス戦(ひとり)</button><button class="primary dl-pvp">対人戦(2人で斬り合う)</button>`}
        </div>
        ${pvpStatus}
        <label class="vs-opt">画質<select class="dl-q">${Object.entries(Q_NAMES).map(([k, v]) => `<option value="${k}"${k === quality ? " selected" : ""}>${v}</option>`).join("")}</select></label>
        <details class="vs-help" open><summary>あそびかた</summary>
          <p><b>ボス戦</b>: それぞれの端末で同じボスと戦う。相棒の進み具合が画面に表示される。<br>
          <b>対人戦</b>: 二人とも「対人戦」を押すと始まる。三本勝負で、先に二本取った方の勝ち。体幹を崩して致命の一撃を入れるか、体力を0にすると一本。<br>
          <b>パリィ</b>: 刃が当たる直前(約0.2秒)に「防御」を押す。押しっぱなしだとただの防御で、体幹が溜まる。弾かれた側は体勢を崩すので、すかさず反撃。<br>
          <b>突き(危)</b>: 対人戦だけの技。防御もパリィもできない。相手の突きは「回避」でかわし、相手に向かって踏み込みながら回避すると「見切り」で相手の体幹を大きく崩せる。<br>
          <b>スマホ</b>: 左の円でスティック移動 / 右のボタン: 攻撃・防御・回避・回復(🍶)・突き<br>
          <b>PC</b>: WASD移動 / 左クリックかJ=攻撃 / 右クリックかK=防御 / Space=回避 / E=回復 / Q=突き / Esc=メニュー</p></details>
        ${best ? `<p class="status">ボス戦の自己ベスト: ${fmt(best.time)}(パリィ${best.parries}回・死亡${best.deaths}回)</p>` : ""}
        ${record.w + record.l + record.d ? `<p class="status">対人戦の戦績: ${record.w}勝 ${record.l}敗${record.d ? ` ${record.d}分` : ""}</p>` : ""}
        <p class="status">${note || ""}</p>
      </div>`;
    root.querySelector(".dl-q").onchange = (e) => { quality = e.target.value; localStorage.setItem("duelQuality", quality); };
    const go = root.querySelector(".dl-go"); if (go) go.onclick = begin;
    const pv = root.querySelector(".dl-pvp"); if (pv) pv.onclick = pvpReady;
    const cc = root.querySelector(".dl-cancel"); if (cc) cc.onclick = () => { ready = false; send({ t: "pvpCancel" }); renderStart(); };
  }

  function openOverlay() {
    ov = document.createElement("div");
    ov.className = "dl-ov";
    document.body.appendChild(ov);
    document.body.classList.add("vs-playing");
    const loading = document.createElement("div");
    loading.className = "dl-loading"; loading.textContent = "読み込み中…";
    ov.appendChild(loading);
  }
  function closeOverlay() {
    if (ov) { ov.remove(); ov = null; }
    document.body.classList.remove("vs-playing");
  }

  // ================= ボス戦 =================
  function begin() {
    if (!webglOK()) { renderStart("この端末はWebGLに対応していないため遊べません。"); return; }
    openOverlay();
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
    closeOverlay();
    renderStart();
  }

  // ================= 対人戦 =================
  function pvpReady() {
    if (!webglOK()) { renderStart("この端末はWebGLに対応していないため遊べません。"); return; }
    ready = true;
    send({ t: "pvpReady" });
    renderStart();
    maybeGo();
  }
  // 両者の準備がそろったら、作成側(role 0)が開始の合図を出す
  function maybeGo() {
    if (me === 0 && ready && remoteReady && !pvpGame) { send({ t: "pvpGo" }); beginPvp(); }
  }

  function beginPvp() {
    ready = false; remoteReady = false;
    if (game) { game.destroy(); game = null; closeOverlay(); }
    openOverlay();
    const host = ov;
    pvpGame = { building: true };  // 構築中(届いた入力は buffer に貯める)。PvpGame 自身の pending(入力)と混同しないよう別名
    setTimeout(() => {
      if (ov !== host) return;
      try {
        const g = new PvpGame(ov, {
          quality, me, names,
          sendNet: (m) => send(m),
          onExit: () => { send({ t: "pvpQuit" }); stopPvp(); },
          onEnd: (r) => {
            if (r.winner === me) record.w++; else if (r.winner < 0) record.d++; else record.l++;
            localStorage.setItem("duelPvpRecord", JSON.stringify(record));
          },
        });
        pvpGame = g;
        for (const m of buffer) netMessage(m);
        buffer = [];
        g.start();
      } catch (e) {
        console.error(e);
        send({ t: "pvpQuit" });
        stopPvp();
        renderStart("読み込みに失敗しました: " + (e && e.message ? e.message : e));
      }
    }, 60);
  }

  function stopPvp(note) {
    if (pvpGame && pvpGame.destroy) pvpGame.destroy();
    pvpGame = null; buffer = [];
    closeOverlay();
    renderStart(note);
  }

  function netMessage(m) {
    if (!pvpGame) return;
    if (pvpGame.building) { if (buffer.length < 5000) buffer.push(m); return; }
    if (m.t === "pi") pvpGame.remoteInput(m.f, m.b);
    else if (m.t === "ph") pvpGame.remoteHash(m.f, m.h);
    else if (m.t === "pvpQuit") pvpGame.opponentLeft();
  }

  renderStart();
  return {
    onMessage(m) {
      switch (m.t) {
        case "prog": rival = { ...(rival || {}), ...m, done: rival && rival.done }; break;
        case "done": rival = { ...(rival || {}), ...m, done: true }; break;
        case "pvpReady": remoteReady = true; renderStart(); maybeGo(); break;
        case "pvpCancel": remoteReady = false; renderStart(); break;
        case "pvpGo": if (me === 1 && !pvpGame) beginPvp(); break;
        case "pi": case "ph": netMessage(m); break;
        case "pvpQuit":
          remoteReady = false;
          if (pvpGame) netMessage(m); else renderStart();
          break;
        default: break;
      }
      if (game) game.setRival(rivalText());
    },
    onNames() {
      if (pvpGame && pvpGame.setNames) pvpGame.setNames();
      if (game) game.setRival(rivalText());
      renderStart();
    },
    destroy() {
      if (pvpGame && !pvpGame.building) send({ t: "pvpQuit" });
      if (pvpGame && pvpGame.destroy) pvpGame.destroy();
      pvpGame = null;
      if (game) { game.destroy(); game = null; }
      closeOverlay();
    },
  };
}

export default {
  id: "duel",
  name: "鬼面の武将 一騎討ち(3D)",
  desc: "Three.jsの3D剣戟アクション。ボス戦と、2人で斬り合う対人戦。刃に合わせて防御でパリィ→体幹崩し→致命の一撃!",
  create,
};
