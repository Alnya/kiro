// 反射神経バトル。画面が緑になった瞬間にタップ。先に3本取った方の勝ち。
// 各端末が自分の反応時間をローカルで計測して交換するので、通信遅延は勝敗に影響しない。
const WIN_SCORE = 3;
const TIMEOUT_MS = 3000;   // 緑になってからこの時間タップしなければ時間切れ
const NEXT_ROUND_MS = 2500;

// ラウンド結果の判定。ms: 数値=反応時間, null=お手つき。 返り値 1=自分の勝ち, -1=相手, 0=引き分け
export function judge(mine, theirs) {
  const a = mine === null ? Infinity : mine;
  const b = theirs === null ? Infinity : theirs;
  return a === b ? 0 : a < b ? 1 : -1;
}

function create({ root, role, send, names = { opp: "相手" } }) {
  const isHost = role === 0;
  let scores, round, phase, mine, theirs, greenAt, waitTimer, limitTimer, nextTimer, over;
  let destroyed = false;

  root.innerHTML = `
    <div class="scorebar">
      <div class="score">あなた <b class="sc-me">0</b></div>
      <div class="turn-label">先に${WIN_SCORE}本取った方の勝ち</div>
      <div class="score"><span class="nm-opp"></span> <b class="sc-opp">0</b></div>
    </div>
    <div class="react-pad" role="button" tabindex="0">
      <div class="react-main">準備中…</div>
      <div class="react-sub"></div>
    </div>
    <div class="row"><button class="restart">もう一度</button></div>`;
  const $ = (s) => root.querySelector(s);
  const showNames = () => { $(".nm-opp").textContent = names.opp; };
  showNames();
  const pad = $(".react-pad");

  function setPad(cls, main, sub = "") {
    pad.className = "react-pad " + cls;
    $(".react-main").textContent = main;
    $(".react-sub").textContent = sub;
    $(".sc-me").textContent = scores[0];
    $(".sc-opp").textContent = scores[1];
  }

  function clearTimers() {
    clearTimeout(waitTimer); clearTimeout(limitTimer); clearTimeout(nextTimer);
  }

  function reset() {
    clearTimers();
    scores = [0, 0]; round = 0; phase = "idle"; mine = undefined; theirs = undefined; over = false;
    setPad("idle", "準備はいい?", "まもなく開始します");
    if (isHost) nextTimer = setTimeout(startRound, 1500);
  }

  // ホストがラウンドを開始し、待ち時間をランダムに決める
  function startRound() {
    if (destroyed || over) return;
    const r = round + 1;
    const delay = 2000 + Math.floor(Math.random() * 3500);
    send({ t: "ready", round: r, delay });
    beginRound(r, delay);
  }

  function beginRound(r, delay) {
    clearTimers();
    round = r; mine = undefined; theirs = undefined; phase = "wait";
    setPad("wait", "待て…", `第${r}ラウンド 緑になったらタップ!`);
    waitTimer = setTimeout(() => {
      phase = "go";
      greenAt = performance.now();
      setPad("go", "今だ!タップ!", "");
      limitTimer = setTimeout(() => finish(TIMEOUT_MS), TIMEOUT_MS);
    }, delay);
  }

  // 自分の結果を確定して相手に送る(null=お手つき)
  function finish(ms) {
    if (phase !== "wait" && phase !== "go") return;
    clearTimeout(waitTimer); clearTimeout(limitTimer);
    phase = "done";
    mine = ms;
    send({ t: "result", round, ms });
    setPad("done", ms === null ? "お手つき!" : `${Math.round(ms)} ms`, "相手を待っています…");
    resolve();
  }

  function resolve() {
    if (mine === undefined || theirs === undefined || phase === "resolved") return;
    phase = "resolved";
    const j = judge(mine, theirs);
    if (j === 1) scores[0]++; else if (j === -1) scores[1]++;
    const fmt = (v) => (v === null ? "お手つき" : `${Math.round(v)} ms`);
    const head = j === 1 ? "このラウンドは勝ち!" : j === -1 ? "このラウンドは負け…" : "引き分け";
    const detail = `あなた ${fmt(mine)} / 相手 ${fmt(theirs)}`;
    if (scores[0] >= WIN_SCORE || scores[1] >= WIN_SCORE) {
      over = true;
      setPad("end", scores[0] > scores[1] ? "あなたの勝ち!" : "あなたの負け", detail);
    } else {
      setPad(j === 1 ? "won" : "lost", head, detail);
      if (isHost) nextTimer = setTimeout(startRound, NEXT_ROUND_MS);
    }
  }

  const tap = (e) => { e.preventDefault(); if (phase === "wait") finish(null); else if (phase === "go") finish(performance.now() - greenAt); };
  pad.addEventListener("pointerdown", tap);

  $(".restart").onclick = () => {
    if (isHost) { send({ t: "reset" }); reset(); } else send({ t: "reqRestart" });
  };

  reset();
  return {
    onMessage(m) {
      if (m.t === "ready" && !isHost && Number.isInteger(m.round) && Number.isFinite(m.delay)) {
        beginRound(m.round, Math.min(Math.max(m.delay, 0), 10000));
      } else if (m.t === "result" && m.round === round) {
        theirs = m.ms === null ? null : Number(m.ms);
        resolve();
      } else if (m.t === "reset" && !isHost) {
        reset();
      } else if (m.t === "reqRestart" && isHost) {
        send({ t: "reset" }); reset();
      }
    },
    onNames: showNames,
    destroy() { destroyed = true; clearTimers(); },
  };
}

export default { id: "reaction", name: "反射神経バトル", desc: "緑になった瞬間にタップ!3本先取。お手つきは負け", create };
