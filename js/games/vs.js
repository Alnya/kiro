// 兄弟ダッシュ!ビッグスターバトル(マリオVSルイージ方式の2人対戦アクション)
// 通信はロックステップ: 毎フレームの入力だけを交換し、両端末が同じ決定論シミュレーションを回す。
import { Sim } from "../vs/sim.js";
import { STAGE_IDS } from "../vs/stages.js";
import { Renderer, VIEW_H, HERO } from "../vs/render.js";
import { Controls } from "../vs/input.js";

const STEP = 1000 / 60;
const DELAY = 5;            // 入力遅延(フレーム)。LAN のWi-Fiなら十分
const OVER_FRAMES = 170;    // ラウンド終了後の余韻
const HASH_EVERY = 120;
const STAGE_NAMES = { random: "ランダム", grass: "くさはら", bricks: "ちかのレンガ", ice: "こおりのだいち" };
const DEFAULT_CFG = { stars: 5, wins: 2, lives: 5, stage: "random" };

// ---- 効果音(WebAudio の簡易ビープ) ----
class Sfx {
  constructor() { this.ctx = null; this.on = true; }
  unlock() {
    if (this.ctx) { if (this.ctx.state === "suspended") this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) { try { this.ctx = new AC(); } catch { this.ctx = null; } }
  }
  beep(f0, f1, dur, type = "square", vol = 0.05, delay = 0) {
    if (!this.on || !this.ctx) return;
    const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.linearRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + dur + 0.02);
  }
  play(k) {
    switch (k) {
      case "jump": this.beep(380, 760, 0.12); break;
      case "coin": this.beep(988, 988, 0.06); this.beep(1319, 1319, 0.14, "square", 0.05, 0.06); break;
      case "star": [523, 659, 784, 1047].forEach((f, i) => this.beep(f, f, 0.1, "square", 0.06, i * 0.07)); break;
      case "starspawn": this.beep(660, 1320, 0.3, "triangle", 0.06); break;
      case "stomp": this.beep(300, 120, 0.1); break;
      case "pound": this.beep(160, 50, 0.25, "sawtooth", 0.08); break;
      case "hurt": this.beep(260, 90, 0.25, "sawtooth", 0.07); break;
      case "die": this.beep(500, 80, 0.6, "square", 0.07); break;
      case "starlost": this.beep(700, 300, 0.2, "triangle", 0.06); break;
      case "brick": this.beep(200, 60, 0.12, "sawtooth", 0.05); break;
      case "block": case "bump": this.beep(180, 140, 0.07, "square", 0.04); break;
      case "item": case "bonus": this.beep(500, 1000, 0.2, "triangle", 0.06); break;
      case "fire": this.beep(900, 400, 0.1, "sawtooth", 0.04); break;
      case "kick": this.beep(250, 450, 0.1); break;
      default: break;
    }
  }
}

function create({ root, role, send }) {
  const me = role, opp = 1 - role;
  let cfg = { ...DEFAULT_CFG };
  let destroyed = false;
  let run = null; // プレイ中の状態

  // ================= 設定画面 =================
  function selectHTML(id, label, opts, val) {
    return `<label class="vs-opt">${label}<select data-k="${id}"${me === 0 ? "" : " disabled"}>` +
      opts.map(([v, t]) => `<option value="${v}"${String(v) === String(val) ? " selected" : ""}>${t}</option>`).join("") +
      `</select></label>`;
  }
  function renderSettings(note) {
    root.innerHTML = `
      <div class="vs-set">
        <p class="note">ステージのどこかに現れる<b>ビッグスター</b>を先に集めよう!相手を踏んだり、ファイアボールやヒップドロップで当てると、相手のスターを奪って落とせる。コインを8枚集めると上からアイテムが降ってくるよ。(横向きの画面がおすすめ)</p>
        ${selectHTML("stars", "ビッグスター(勝利に必要な数)", [[3, "3こ"], [5, "5こ"], [10, "10こ"]], cfg.stars)}
        ${selectHTML("wins", "先取ラウンド数", [[1, "1ラウンド"], [2, "2ラウンド先取"], [3, "3ラウンド先取"]], cfg.wins)}
        ${selectHTML("lives", "ライフ(0になると負け)", [[3, "3"], [5, "5"], [-1, "∞(エンドレス)"]], cfg.lives)}
        ${selectHTML("stage", "ステージ", Object.entries(STAGE_NAMES), cfg.stage)}
        <details class="vs-help"><summary>あそびかた</summary>
          <p>◀▶:移動 / ジャンプ:長押しで高く / ダッシュ:押しながら走る・ファイアボール<br>
          空中で▼:ヒップドロップ(スターを3つ落とす・レンガを壊す)<br>
          壁にくっついてジャンプ:壁キック<br>
          キー操作: ←→ / Space(ジャンプ) / Shift(ダッシュ) / ↓</p>
        </details>
        ${me === 0 ? `<button class="primary vs-start">スタート!</button>` : `<p class="status">ホストがスタートするのを待っています…</p>`}
        <p class="status">${note || ""}</p>
      </div>`;
    if (me === 0) {
      root.querySelectorAll(".vs-opt select").forEach((el) => (el.onchange = () => {
        cfg[el.dataset.k] = el.dataset.k === "stage" ? el.value : +el.value;
        send({ t: "cfg", cfg });
      }));
      root.querySelector(".vs-start").onclick = () => {
        const seed = (Math.random() * 4294967296) >>> 0;
        send({ t: "start", cfg, seed });
        begin(cfg, seed);
      };
    }
  }

  // ================= 対戦開始 =================
  function begin(c, seed) {
    if (run) endRun();
    cfg = { ...c };
    const overlay = document.createElement("div");
    overlay.className = "vs-overlay";
    overlay.innerHTML = `
      <canvas class="vs-canvas"></canvas>
      <div class="vs-hud">
        <div class="vs-card" data-p="0"></div><div class="vs-center"></div><div class="vs-card" data-p="1"></div>
      </div>
      <div class="vs-banner"></div>
      <button class="vs-quit" aria-label="ゲームをやめる">✕</button>
      <button class="vs-mute" aria-label="サウンド">🔊</button>
      <div class="vs-end hidden"></div>`;
    document.body.appendChild(overlay);
    document.body.classList.add("vs-playing");
    const canvas = overlay.querySelector("canvas");
    const renderer = new Renderer(canvas);
    const controls = new Controls(overlay);
    const sfx = new Sfx(); sfx.unlock();
    overlay.addEventListener("pointerdown", () => sfx.unlock());

    run = {
      overlay, canvas, renderer, controls, sfx, seed, round: 0, wins: [0, 0],
      f: 0, nextLocal: DELAY, acc: 0, last: performance.now(), raf: 0,
      inp: [new Map(), new Map()], hashes: new Map(), remoteHashes: new Map(),
      sim: null, overAt: -1, roundCounted: false, ended: false, desync: false,
      stalledMs: 0, seenSfx: -1, hudCache: ["", "", ""], bannerCache: "",
    };
    for (let i = 0; i < DELAY; i++) { run.inp[0].set(i, 0); run.inp[1].set(i, 0); }
    startRound();

    const fit = () => {
      const aspect = innerWidth / Math.max(1, innerHeight);
      let vw = Math.round((VIEW_H * aspect) / 16) * 16;
      vw = Math.max(256, Math.min(448, vw));
      const sw = run.sim.W;
      if (!run.sim.wrap && sw < vw) vw = sw;
      renderer.resize(vw);
    };
    run.fit = fit;
    window.addEventListener("resize", fit);
    window.addEventListener("orientationchange", fit);
    fit();

    overlay.querySelector(".vs-quit").onclick = () => {
      if (confirm("対戦をやめてゲーム選択にもどりますか?")) document.getElementById("btn-to-lobby").click();
    };
    overlay.querySelector(".vs-mute").onclick = (e) => {
      sfx.on = !sfx.on; e.currentTarget.textContent = sfx.on ? "🔊" : "🔇"; sfx.unlock();
    };
    run.raf = requestAnimationFrame(loop);
  }

  function stageForRound() {
    if (cfg.stage !== "random") return cfg.stage;
    // シードとラウンドから決定論的に選ぶ(直前と同じステージは避ける)
    const n = STAGE_IDS.length;
    const hashIdx = (r) => (Math.imul((run.seed + r * 40503) >>> 0, 2654435761) >>> 20) % n;
    let idx = hashIdx(run.round);
    if (run.round > 0 && idx === hashIdx(run.round - 1)) idx = (idx + 1) % n;
    return STAGE_IDS[idx];
  }
  function startRound() {
    const id = stageForRound();
    run.sim = new Sim(id, { stars: cfg.stars, lives: cfg.lives, seed: (run.seed + run.round * 1013) >>> 0 });
    run.overAt = -1; run.roundCounted = false; run.seenSfx = -1;
    run.renderer.reset();
    if (run.fit) run.fit();
  }

  // ================= ロックステップ =================
  function pumpLocalInputs() {
    while (run.nextLocal <= run.f + DELAY) {
      const b = run.controls.bits;
      run.inp[me].set(run.nextLocal, b);
      send({ t: "in", f: run.nextLocal, b });
      run.nextLocal++;
    }
  }

  function stepOnce() {
    const f = run.f;
    const sim = run.sim;
    sim.step([run.inp[0].get(f), run.inp[1].get(f)]);
    run.inp[0].delete(f - 2); run.inp[1].delete(f - 2);
    run.f++;
    if (run.f % HASH_EVERY === 0) {
      const h = sim.hash();
      run.hashes.set(run.f, h);
      send({ t: "h", f: run.f, h });
      compareHash(run.f);
    }
    if (sim.over && !run.roundCounted) {
      run.roundCounted = true; run.overAt = run.f;
      if (sim.over.winner >= 0) run.wins[sim.over.winner]++;
    }
    if (sim.over && run.f - run.overAt >= OVER_FRAMES) {
      if (run.wins[0] >= cfg.wins || run.wins[1] >= cfg.wins) { run.ended = true; showEnd(); }
      else { run.round++; startRound(); }
    }
  }
  function compareHash(f) {
    const a = run.hashes.get(f), b = run.remoteHashes.get(f);
    if (a === undefined || b === undefined) return;
    if (a !== b) run.desync = true;
    run.hashes.delete(f); run.remoteHashes.delete(f);
  }

  function loop(now) {
    if (destroyed || !run) return;
    const r = run;
    const dt = Math.min(100, now - r.last);
    r.last = now;
    r.acc += dt;
    pumpLocalInputs();
    let steps = 0, stalled = false;
    while (r.acc >= STEP && !r.ended && steps < 6) {
      if (!r.inp[0].has(r.f) || !r.inp[1].has(r.f)) { stalled = true; break; }
      stepOnce();
      pumpLocalInputs();
      r.acc -= STEP; steps++;
    }
    if (r.acc > STEP * 4) r.acc = STEP * 4; // 遅れを取り戻しすぎない
    r.stalledMs = stalled ? r.stalledMs + dt : 0;
    playSfx();
    r.renderer.draw(r.sim, me);
    updateHud();
    r.raf = requestAnimationFrame(loop);
  }

  function playSfx() {
    const r = run, sim = r.sim;
    let n = 0;
    for (const e of sim.fx) {
      if (e.id <= r.seenSfx) continue;
      r.seenSfx = e.id;
      const mine = e.who === undefined || e.who === me;
      const global = ["star", "starspawn", "die", "starlost", "pound", "hurt"].includes(e.k);
      if ((mine || global) && n++ < 4) r.sfx.play(e.k);
    }
  }

  // ================= HUD =================
  function updateHud() {
    const r = run, sim = r.sim;
    const cards = r.overlay.querySelectorAll(".vs-card");
    for (let i = 0; i < 2; i++) {
      const p = sim.players[i];
      const tags = [];
      if (p.mega > 0) tags.push("巨大"); else if (p.mini > 0) tags.push("ミニ");
      if (p.star > 0) tags.push("無敵");
      if (p.shell) tags.push("コウラ");
      if (p.form === "fire") tags.push("ファイア"); else if (p.form === "big") tags.push("おおきい");
      const near = !sim.over && p.stars === cfg.stars - 1;
      const html =
        `<div class="vs-name" style="color:${HERO[i].main}">${HERO[i].name}${i === me ? "(あなた)" : ""} <small>${r.wins[i]}勝</small></div>` +
        `<div class="vs-stars${near ? " pulse" : ""}">★ <b>${p.stars}</b>/${cfg.stars}</div>` +
        `<div class="vs-sub">♥${p.lives < 0 ? "∞" : p.lives}　🪙${p.coins}/8</div>` +
        `<div class="vs-tags">${tags.join("・")}</div>`;
      if (r.hudCache[i] !== html) { cards[i].innerHTML = html; r.hudCache[i] = html; }
    }
    const center = !sim.fieldStar && sim.starTimer > 0 && !sim.over
      ? `次のスターまで ${Math.ceil(sim.starTimer / 60)}秒` : "";
    const cHtml = `<div>ラウンド${r.round + 1}</div><div class="vs-sub">${sim.stage.name}</div><div class="vs-sub">${center}</div>`;
    if (r.hudCache[2] !== cHtml) { r.overlay.querySelector(".vs-center").innerHTML = cHtml; r.hudCache[2] = cHtml; }

    let banner = "";
    if (sim.over) {
      const w = sim.over.winner;
      banner = w < 0 ? "引き分け!" : w === me ? "あなたの勝ち!" : "あなたの負け…";
    } else if (r.desync) banner = "⚠ 同期ずれを検出(通信状態を確認)";
    else if (r.stalledMs > 800) banner = "相手の入力を待っています…";
    else if (sim.t < 100) banner = sim.t < 60 ? `ラウンド${r.round + 1}` : "GO!";
    if (banner !== r.bannerCache) {
      const el = r.overlay.querySelector(".vs-banner");
      el.textContent = banner; el.classList.toggle("warn", r.desync || r.stalledMs > 800);
      r.bannerCache = banner;
    }
  }

  function showEnd() {
    const r = run;
    const w0 = r.wins[0], w1 = r.wins[1];
    const msg = w0 === w1 ? "引き分け!" : (w0 > w1 ? 0 : 1) === me ? "あなたのしょうり!" : "あなたのまけ…";
    const el = r.overlay.querySelector(".vs-end");
    el.classList.remove("hidden");
    el.innerHTML = `<div class="vs-endbox"><h2>${msg}</h2><p>${HERO[0].name} ${w0} - ${w1} ${HERO[1].name}</p>
      <button class="primary vs-again">もう一度あそぶ(設定へ)</button>
      <button class="vs-lobby">ゲーム選択へ</button></div>`;
    el.querySelector(".vs-again").onclick = () => { send({ t: "again" }); endRun(); renderSettings(); };
    el.querySelector(".vs-lobby").onclick = () => document.getElementById("btn-to-lobby").click();
  }

  function endRun() {
    if (!run) return;
    cancelAnimationFrame(run.raf);
    window.removeEventListener("resize", run.fit);
    window.removeEventListener("orientationchange", run.fit);
    run.controls.destroy();
    run.overlay.remove();
    document.body.classList.remove("vs-playing");
    if (run.sfx.ctx) { try { run.sfx.ctx.close(); } catch { /* noop */ } }
    run = null;
  }

  renderSettings();
  return {
    onMessage(m) {
      if (m.t === "cfg" && me === 1 && !run) {
        cfg = { ...DEFAULT_CFG, ...m.cfg }; renderSettings();
      } else if (m.t === "start" && me === 1) {
        cfg = { ...DEFAULT_CFG, ...m.cfg };
        begin(cfg, m.seed >>> 0);
      } else if (m.t === "in" && run && Number.isInteger(m.f) && Number.isInteger(m.b)) {
        run.inp[opp].set(m.f, m.b & 31);
      } else if (m.t === "h" && run) {
        run.remoteHashes.set(m.f, m.h);
        compareHash(m.f);
      } else if (m.t === "again" && run) {
        endRun(); renderSettings();
      }
    },
    destroy() {
      destroyed = true;
      endRun();
    },
  };
}

export default {
  id: "vs",
  name: "ビッグスターバトル",
  desc: "横スクロール2Dアクション対戦!ステージのビッグスターを先に集めよう。踏んで奪い合い!",
  create,
};
