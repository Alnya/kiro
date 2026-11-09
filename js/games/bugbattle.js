// むしカードバトル。5枚の手札から毎ラウンド1枚を同時に出し、3ラウンドで勝負。
// 3すくみ: パワー > わざ > スピード > パワー。同じタイプなら強さの数値が大きい方が勝ち。
export const TYPES = {
  power: { label: "パワー", beats: "tech" },
  tech: { label: "わざ", beats: "speed" },
  speed: { label: "スピード", beats: "power" },
};

export const CARDS = [
  { id: "hercules", name: "ヘラクレスオオカブト", icon: "🪲", type: "power", str: 10 },
  { id: "caucasus", name: "コーカサスオオカブト", icon: "🪲", type: "power", str: 9 },
  { id: "hirata", name: "ヒラタクワガタ", icon: "🪲", type: "power", str: 8 },
  { id: "kabuto", name: "カブトムシ", icon: "🪲", type: "power", str: 7 },
  { id: "nokogiri", name: "ノコギリクワガタ", icon: "🪲", type: "power", str: 6 },
  { id: "ookuwa", name: "オオクワガタ", icon: "🪲", type: "tech", str: 9 },
  { id: "miyama", name: "ミヤマクワガタ", icon: "🪲", type: "tech", str: 7 },
  { id: "kamikiri", name: "カミキリムシ", icon: "🪲", type: "tech", str: 6 },
  { id: "kirigirisu", name: "キリギリス", icon: "🦗", type: "tech", str: 5 },
  { id: "tentou", name: "ナナホシテントウ", icon: "🐞", type: "tech", str: 3 },
  { id: "suzume", name: "スズメバチ", icon: "🐝", type: "speed", str: 8 },
  { id: "batta", name: "バッタ", icon: "🦗", type: "speed", str: 7 },
  { id: "ageha", name: "アゲハチョウ", icon: "🦋", type: "speed", str: 6 },
  { id: "mitsubachi", name: "ミツバチ", icon: "🐝", type: "speed", str: 4 },
  { id: "hae", name: "ハエ", icon: "🪰", type: "speed", str: 2 },
];
const BY_ID = Object.fromEntries(CARDS.map((c) => [c.id, c]));

// 1=aの勝ち, -1=bの勝ち, 0=引き分け
export function battle(a, b) {
  if (a.type !== b.type) return TYPES[a.type].beats === b.type ? 1 : -1;
  return Math.sign(a.str - b.str);
}

export function deal(n = 5, rnd = Math.random) {
  const pool = CARDS.slice();
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, n).map((c) => c.id);
}

const ROUNDS = 3;
const REVEAL_MS = 3500;

function create({ root, send }) {
  let hand, used, selected, round, myPick, theirPicks, scores, phase, timer, resultText, lastMine, lastTheirs;
  let destroyed = false;

  root.innerHTML = `
    <div class="scorebar">
      <div class="score">あなた <b class="sc-me">0</b></div>
      <div class="turn-label"></div>
      <div class="score">相手 <b class="sc-opp">0</b></div>
    </div>
    <div class="bb-arena">
      <div class="bb-slot bb-opp"></div>
      <div class="bb-vs">VS</div>
      <div class="bb-slot bb-me"></div>
    </div>
    <p class="status bb-msg" aria-live="polite"></p>
    <div class="bb-hand"></div>
    <button class="primary bb-ok">この虫で勝負!</button>
    <p class="note">パワー ▶ わざ ▶ スピード ▶ パワー の3すくみ。同じタイプなら数字が大きい方が勝ち。</p>
    <div class="row"><button class="restart">もう一度</button></div>`;
  const $ = (s) => root.querySelector(s);

  const cardHTML = (c, cls = "") =>
    `<div class="bb-card t-${c.type} ${cls}"><div class="bb-ic">${c.icon}</div>` +
    `<div class="bb-name">${c.name}</div><div class="bb-meta">${TYPES[c.type].label} <b>${c.str}</b></div></div>`;
  const backHTML = (txt) => `<div class="bb-card bb-back"><div class="bb-ic">❔</div><div class="bb-name">${txt}</div></div>`;

  function reset() {
    clearTimeout(timer);
    hand = deal(); used = new Set(); selected = null; round = 0;
    myPick = null; theirPicks = {}; scores = [0, 0]; phase = "choose"; resultText = "";
    render();
  }

  function render() {
    $(".sc-me").textContent = scores[0];
    $(".sc-opp").textContent = scores[1];
    const over = phase === "over";
    $(".turn-label").textContent = over ? "勝負あり!" : `第${Math.min(round + 1, ROUNDS)}/${ROUNDS}ラウンド`;

    const opp = $(".bb-opp"), me = $(".bb-me");
    const theirs = theirPicks[round];
    if (phase === "reveal" || over) {
      opp.innerHTML = cardHTML(BY_ID[theirs]);
      me.innerHTML = cardHTML(BY_ID[myPick]);
    } else {
      opp.innerHTML = backHTML(theirs ? "出した!" : "選択中…");
      me.innerHTML = myPick ? cardHTML(BY_ID[myPick]) : backHTML("あなたの番");
    }

    $(".bb-msg").textContent = resultText ||
      (phase === "locked" ? "相手の選択を待っています…" : phase === "choose" ? "手札から1枚選んでください" : "");

    $(".bb-hand").innerHTML = hand
      .map((id) => cardHTML(BY_ID[id], (used.has(id) ? "used " : "") + (selected === id ? "sel" : "")))
      .join("");
    [...$(".bb-hand").children].forEach((el, i) => (el.dataset.id = hand[i]));

    const ok = $(".bb-ok");
    ok.disabled = !(phase === "choose" && selected);
    ok.style.display = phase === "choose" || phase === "locked" ? "" : "none";
  }

  $(".bb-hand").addEventListener("click", (e) => {
    const el = e.target.closest(".bb-card");
    if (!el || phase !== "choose" || used.has(el.dataset.id)) return;
    selected = el.dataset.id;
    render();
  });

  $(".bb-ok").onclick = () => {
    if (phase !== "choose" || !selected) return;
    myPick = selected; used.add(myPick); selected = null; phase = "locked";
    send({ t: "pick", round, id: myPick });
    maybeResolve();
    render();
  };

  function maybeResolve() {
    const theirs = theirPicks[round];
    if (phase !== "locked" || !theirs) return;
    const r = battle(BY_ID[myPick], BY_ID[theirs]);
    if (r === 1) scores[0]++; else if (r === -1) scores[1]++;
    resultText = r === 1 ? "このラウンドは勝ち!" : r === -1 ? "このラウンドは負け…" : "引き分け";
    phase = "reveal";
    lastMine = myPick; lastTheirs = theirs;
    timer = setTimeout(next, REVEAL_MS);
  }

  function next() {
    if (destroyed) return;
    round++;
    resultText = "";
    myPick = null;
    if (round >= ROUNDS) {
      phase = "over";
      round = ROUNDS - 1;
      const [a, b] = scores;
      resultText = a > b ? "あなたの勝ち!" : a < b ? "あなたの負け…" : "引き分け";
      // 最終ラウンドの札を表示し続ける
      myPick = lastMine; theirPicks[round] = lastTheirs;
    } else {
      phase = "choose";
    }
    render();
  }
  $(".restart").onclick = () => { send({ t: "restart" }); reset(); };

  reset();
  return {
    onMessage(m) {
      if (m.t === "pick" && Number.isInteger(m.round) && BY_ID[m.id] && m.round >= 0 && m.round < ROUNDS) {
        theirPicks[m.round] = m.id;
        maybeResolve();
        render();
      } else if (m.t === "restart") {
        reset();
        $(".bb-msg").textContent = "相手がゲームを再開しました。";
      }
    },
    destroy() { destroyed = true; clearTimeout(timer); },
  };
}

export default { id: "bugbattle", name: "むしカードバトル", desc: "虫カードで3すくみバトル!パワー・わざ・スピードを読み合え", create };
