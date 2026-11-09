// デッキタワー(協力): 2人で挑む協力デッキ構築ローグライク。
// 通信: ホストだけがエンジンを実行し、結果の状態スナップショット(ステップ列)を両者に配る。
import { Game, FLOORS, SHOP_REMOVE } from "../spire/engine.js";
import { CARDS, CLASSES, ENEMIES, RELICS, POTIONS, EVENTS, statusNames, statusDesc, DEBUFFS, cardText, cardCost } from "../spire/data.js";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const NODE_IC = { M: "⚔️", E: "👹", R: "🔥", S: "🛒", T: "💎", Q: "❓", V: "📜", B: "👑" };
const PCOL = ["#ff7a6b", "#6bd0ff"];

function create({ root, role, send }) {
  const me = role;
  let destroyed = false;
  // ---- ロビー用 ----
  let myCls = null, myReady = false, theirCls = null, theirReady = false;
  // ---- ゲーム用 ----
  let game = null;         // ホストのみ
  let S = null;            // 現在表示中の状態
  let ov = null;
  const ui = { sel: null, modal: null, toast: "", played: null, mapFloor: null };
  let queue = [], playing = false, locked = false, timer = 0;
  const scrollMem = {};

  // ================= ロビー =================
  function renderLobby(note) {
    const classBtn = (id) => {
      const c = CLASSES[id];
      return `<button class="sp-cls${myCls === id ? " sel" : ""}" data-cls="${id}"${myReady ? " disabled" : ""}>
        <span class="sp-cls-ic">${c.ic}</span><b>${c.name}</b><small>HP ${c.hp}</small><small>${c.desc}</small></button>`;
    };
    const mate = theirCls ? `${CLASSES[theirCls].ic} ${CLASSES[theirCls].name}${theirReady ? "(準備OK)" : "(選択中)"}` : "選択中…";
    root.innerHTML = `
      <div class="sp-lobby">
        <p class="note">2人で塔を登る協力デッキ構築ローグライク。同じ戦闘を同時にプレイし、デッキ・HP・ゴールドは別々。マップは2人で投票、倒れても戦闘後にHP1で復活!</p>
        <div class="sp-cls-list">${["knight", "mage", "ranger"].map(classBtn).join("")}</div>
        <p class="status">相棒: ${mate}</p>
        <button class="primary sp-ready"${myCls ? "" : " disabled"}>${myReady ? "準備OKを取り消す" : "準備OK!"}</button>
        ${me === 0 ? `<button class="primary sp-start"${myReady && theirReady ? "" : " disabled"}>ゲーム開始</button>` : `<p class="status">${myReady && theirReady ? "ホストの開始を待っています…" : ""}</p>`}
        <details class="vs-help"><summary>遊び方</summary>
          <p>カードをタップで選び、敵やマスをタップして使う(ターゲット不要のカードは、もう一度タップ)。全員が「ターン終了」を押すと敵が動く。<br>
          敵の頭上のアイコンは次の行動(攻撃の数字は受けるダメージ)。<br>
          弱点・脱力などは敵に付くと<b>2人とも</b>恩恵を受けるので、先にかけよう。<br>
          【協力】カードで味方にブロック・回復・エナジーを渡せる。</p></details>
        <p class="status">${note || ""}</p>
      </div>`;
    root.querySelectorAll(".sp-cls").forEach((b) => (b.onclick = () => { myCls = b.dataset.cls; sendPick(); renderLobby(); }));
    root.querySelector(".sp-ready").onclick = () => { myReady = !myReady; sendPick(); renderLobby(); };
    const st = root.querySelector(".sp-start");
    if (st) st.onclick = () => startRun();
  }
  function sendPick() { send({ t: "pick", cls: myCls, ready: myReady }); }

  function startRun() {
    if (!(myReady && theirReady)) return;
    const classes = me === 0 ? [myCls, theirCls] : [theirCls, myCls];
    const same = classes[0] === classes[1];
    const names = classes.map((c, i) => `${CLASSES[c].name}${same ? (i === 0 ? "A" : "B") : ""}`);
    game = new Game({ seed: (Math.random() * 4294967296) >>> 0, classes, names });
    openOverlay();
    const first = [{ s: JSON.parse(JSON.stringify(game.s)), ev: [], d: 0 }];
    send({ t: "steps", steps: first });
    enqueue(first);
  }

  // ================= オーバーレイ =================
  function openOverlay() {
    if (ov) return;
    ov = document.createElement("div");
    ov.className = "sp-ov";
    document.body.appendChild(ov);
    document.body.classList.add("vs-playing");
    ov.addEventListener("click", onClick);
  }
  function closeOverlay() {
    if (!ov) return;
    ov.remove(); ov = null;
    document.body.classList.remove("vs-playing");
    clearTimeout(timer);
    queue = []; playing = false; locked = false; S = null; game = null;
    ui.sel = null; ui.modal = null;
  }

  // ---- 操作の送信 ----
  function dispatch(a) {
    if (locked) return;
    if (me === 0) {
      const steps = game.apply(a, 0);
      if (steps.length) { send({ t: "steps", steps }); enqueue(steps); }
      else toast("その操作はできません");
    } else send({ t: "act", a });
  }
  function toast(t) { ui.toast = t; const el = ov && ov.querySelector(".sp-toast"); if (el) { el.textContent = t; el.classList.add("on"); setTimeout(() => el && el.classList.remove("on"), 1200); } }

  // ---- ステップの再生 ----
  function enqueue(steps) { queue.push(...steps); if (!playing) pump(); }
  function pump() {
    if (destroyed || !ov) return;
    const st = queue.shift();
    if (!st) { playing = false; locked = false; return; }
    playing = true;
    S = st.s;
    if (!S.battle || S.phase !== "battle") ui.sel = null;
    locked = st.d > 0 || queue.some((x) => x.d > 0);
    render();
    animate(st.ev);
    timer = setTimeout(pump, st.d);
  }

  // ================= 描画 =================
  const mePl = () => S.players[me];
  const ally = () => S.players[1 - me];

  function hpBar(hp, max, cls = "") {
    const pct = Math.max(0, Math.min(100, Math.round((hp / max) * 100)));
    return `<div class="sp-hp ${cls}${pct <= 30 ? " low" : ""}"><i style="width:${pct}%"></i><b>${hp}/${max}</b></div>`;
  }
  function chips(st) {
    return Object.entries(st).filter(([, v]) => v).map(([k, v]) => {
      const flag = ["barricade", "link", "taunt", "sleep"].includes(k);
      return `<span class="sp-chip ${DEBUFFS.has(k) || v < 0 ? "bad" : "good"}">${statusNames[k] || k}${flag ? "" : v}</span>`;
    }).join("");
  }
  function cardHTML(card, o = {}) {
    const d = CARDS[card.c];
    const cost = cardCost(card.c, !!card.u);
    const cls = ["sp-card", "t-" + d.type, "r-" + d.rar];
    if (o.sel) cls.push("sel");
    if (o.dis) cls.push("dis");
    if (d.coop) cls.push("coop");
    const attrs = Object.entries(o.attrs || {}).map(([k, v]) => `data-${k}="${esc(v)}"`).join(" ");
    return `<div class="${cls.join(" ")}" ${attrs}>
      <div class="sp-cost">${cost}</div><div class="sp-cic">${d.ic}</div>
      <div class="sp-cname">${esc(d.name)}${card.u ? "+" : ""}</div>
      <div class="sp-ctext">${esc(cardText(card.c, !!card.u))}</div></div>`;
  }

  function render() {
    if (!ov || !S) return;
    ov.querySelectorAll("[data-sk]").forEach((el) => (scrollMem[el.dataset.sk] = el.scrollTop));
    const hscroll = ov.querySelector(".sp-hand");
    if (hscroll) scrollMem.hand = hscroll.scrollLeft;
    let body = "";
    switch (S.phase) {
      case "map": body = viewMap(); break;
      case "battle": body = viewBattle(); break;
      case "reward": body = viewReward(); break;
      case "rest": body = viewRest(); break;
      case "shop": body = viewShop(); break;
      case "treasure": body = viewTreasure(); break;
      case "event": body = viewEvent(); break;
      case "over": body = viewOver(); break;
      default: body = ""; break;
    }
    ov.innerHTML = `<div class="sp-wrap">${viewTop()}${body}</div>${viewModal()}<div class="sp-toast"></div>`;
    ov.querySelectorAll("[data-sk]").forEach((el) => { if (scrollMem[el.dataset.sk] !== undefined) el.scrollTop = scrollMem[el.dataset.sk]; });
    const h2 = ov.querySelector(".sp-hand");
    if (h2 && scrollMem.hand) h2.scrollLeft = scrollMem.hand;
    if (S.phase === "map") {
      const m = ov.querySelector(".sp-map");
      if (m && ui.mapFloor !== S.floor) {
        const y = (FLOORS + 1) * 74 + 70 - 50 - (S.floor + 1) * 74;
        m.scrollTop = Math.max(0, y - m.clientHeight * 0.6);
        ui.mapFloor = S.floor;
        scrollMem.map = m.scrollTop;
      }
    }
  }

  function viewTop() {
    const p = mePl();
    const node = S.cur !== null ? S.map.nodes[S.cur] : null;
    const label = S.phase === "over" ? "" : node ? (node.type === "B" ? "ボス" : `${S.floor + 1}F`) : "入口";
    const rel = p.relics.map((r) => `<span class="sp-rl" data-a="relic" data-r="${r}" title="${esc(RELICS[r].name)}">${RELICS[r].ic}</span>`).join("");
    return `<div class="sp-top"><span class="sp-floor">🏰 ${label}</span><span class="sp-gold">💰${p.gold}</span><span class="sp-rels">${rel}</span>
      <button class="sp-x" data-a="menu" aria-label="やめる">✕</button></div>`;
  }

  // ---------- マップ ----------
  function viewMap() {
    const nodes = S.map.nodes;
    const H = (FLOORS + 1) * 74 + 70, W = 300;
    const pos = (n) => ({ x: ((n.lane + 0.5) / 5) * W, y: H - 50 - n.f * 74 });
    const options = S.cur === null ? nodes.filter((n) => n.f === 0).map((n) => n.id) : nodes[S.cur].next;
    let lines = "";
    for (const n of nodes) for (const t of n.next) {
      const a = pos(n), b = pos(nodes[t]);
      const used = S.cur !== null && (n.id === S.cur || n.shown !== undefined) && nodes[t].shown !== undefined;
      lines += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" class="${used ? "used" : ""}"/>`;
    }
    const btns = nodes.map((n) => {
      const q = pos(n);
      const avail = options.includes(n.id);
      const visited = n.shown !== undefined;
      const ic = visited ? NODE_IC[n.shown] : NODE_IC[n.type];
      const votes = S.vote.map((v, i) => (v === n.id ? `<i class="sp-vote" style="background:${PCOL[i]}">${i === me ? "あ" : "相"}</i>` : "")).join("");
      return `<button class="sp-node${avail ? " avail" : ""}${visited ? " visited" : ""}${n.id === S.cur ? " cur" : ""}${S.vote[me] === n.id ? " mine" : ""}"
        style="left:${(q.x / W) * 100}%;top:${q.y}px" ${avail ? `data-a="vote" data-n="${n.id}"` : "disabled"}>${ic}${votes}</button>`;
    }).join("");
    const waiting = S.vote[me] !== null ? (S.vote[1 - me] === null ? "相棒の投票を待っています…" : "") : "行き先を選ぼう(割れたら抽選)";
    return `<div class="sp-map" data-sk="map"><div class="sp-mapin" style="height:${H}px"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" width="100%" height="${H}">${lines}</svg>${btns}</div></div>
      <div class="sp-hint">${waiting}</div>${viewDeckBar()}`;
  }
  function viewDeckBar() {
    return `<div class="sp-bar2"><button data-a="deck">📚 デッキ(${mePl().deck.length})</button><button data-a="mate">${CLASSES[ally().cls].ic} ${esc(ally().name)}を見る</button>${potionRow()}</div>`;
  }
  function potionRow() {
    return `<span class="sp-pots">${mePl().potions.map((id, i) => (id ? `<button class="sp-pot" data-a="potion" data-slot="${i}" title="${esc(POTIONS[id].name)}">${POTIONS[id].ic}</button>` : `<span class="sp-pot empty"></span>`)).join("")}</span>`;
  }

  // ---------- 戦闘 ----------
  function validTargets() {
    const sel = ui.sel;
    if (!sel) return { e: false, p: [] };
    if (sel.k === "card") {
      const c = mePl().hand.find((x) => x.id === sel.uid);
      if (!c) return { e: false, p: [] };
      const tg = CARDS[c.c].tg;
      if (tg === "enemy") return { e: true, p: [] };
      if (tg === "ally") return { e: false, p: ally().dead ? [] : [1 - me] };
    } else if (sel.k === "potion") {
      const id = mePl().potions[sel.slot];
      if (!id) return { e: false, p: [] };
      if (POTIONS[id].tg === "enemy") return { e: true, p: [] };
      return { e: false, p: S.players.filter((p) => !p.dead).map((p) => p.i) };
    }
    return { e: false, p: [] };
  }
  function intentHTML(e) {
    const it = e.intent;
    if (!it) return "";
    const ic = { atk: "⚔️", mix: "⚔️", def: "🛡️", buf: "💪", dbf: "💀", zzz: "💤" }[it.k] || "❔";
    let t = "";
    if (it.d !== null && it.d !== undefined) t = it.h > 1 ? `${it.d}×${it.h}` : `${it.d}`;
    else if (it.b) t = `+${it.b}`;
    const who = it.all ? "全員" : it.d !== null && it.tgt !== null && it.tgt !== undefined ? `→${esc(S.players[it.tgt].name)}` : "";
    const col = !it.all && it.tgt !== null && it.tgt !== undefined ? PCOL[it.tgt] : "#ffd36b";
    return `<div class="sp-intent" style="border-color:${col}"><span>${ic}</span><b>${t}</b><small>${who}</small></div>`;
  }
  function viewBattle() {
    const b = S.battle, p = mePl(), tg = validTargets();
    const enemies = b.enemies.map((e) => {
      const cls = ["sp-enemy"];
      if (e.dead) cls.push("dead");
      if (tg.e && !e.dead) cls.push("targetable");
      return `<div class="${cls.join(" ")}" data-ent="e${e.ix}" data-a="enemy" data-i="${e.ix}">
        ${e.dead ? "" : intentHTML(e)}
        <div class="sp-eic">${e.ic}</div>
        <div class="sp-ename">${esc(e.name)}${e.elite ? " ★" : ""}</div>
        ${hpBar(e.hp, e.maxHp, "e")}
        ${e.block ? `<span class="sp-blk">🛡️${e.block}</span>` : ""}
        <div class="sp-chips">${chips(e.st)}</div></div>`;
    }).join("");
    const party = S.players.map((q) => {
      const cls = ["sp-pl"];
      if (q.i === me) cls.push("me");
      if (q.dead) cls.push("dead");
      if (tg.p.includes(q.i)) cls.push("targetable");
      const state = q.dead ? "💀 戦闘不能" : b.phase === "enemy" ? "" : q.ended ? "✔ ターン終了" : "考え中…";
      return `<div class="${cls.join(" ")}" data-ent="p${q.i}" data-a="pl" data-i="${q.i}" style="--pc:${PCOL[q.i]}">
        <div class="sp-pn">${CLASSES[q.cls].ic} ${esc(q.name)}${q.i === me ? "(あなた)" : ""}</div>
        ${hpBar(q.hp, q.maxHp, "p")}
        <div class="sp-pstat"><span>${q.block ? `🛡️${q.block}` : ""}</span><span>⚡${q.energy}</span><span class="sp-st">${state}</span></div>
        <div class="sp-chips">${chips(q.st)}</div></div>`;
    }).join("");

    let selInfo = "";
    const hand = p.hand.map((c) => {
      const d = CARDS[c.c];
      const playable = !p.dead && !p.ended && b.phase === "players" && canPlay(p, c);
      const sel = ui.sel && ui.sel.k === "card" && ui.sel.uid === c.id;
      if (sel) selInfo = `<div class="sp-preview"><b>${esc(d.name)}${c.u ? "+" : ""}</b>(${cardCost(c.c, !!c.u)}) ${esc(cardText(c.c, !!c.u))}${d.tg === "enemy" ? " ▶敵を選ぶ" : d.tg === "ally" ? " ▶味方を選ぶ" : " ▶もう一度タップで使う"}</div>`;
      return cardHTML(c, { sel, dis: !playable, attrs: { a: "card", uid: c.id } });
    }).join("");
    if (ui.sel && ui.sel.k === "potion") {
      const id = p.potions[ui.sel.slot];
      if (id) selInfo = `<div class="sp-preview"><b>${POTIONS[id].ic} ${esc(POTIONS[id].name)}</b> ${esc(POTIONS[id].desc)} ▶${POTIONS[id].tg === "enemy" ? "敵" : "自分か味方"}を選ぶ</div>`;
    }
    const others = S.players.filter((q) => q.i !== me && !q.dead);
    const waitOther = p.ended && others.some((q) => !q.ended);
    const endLabel = b.phase === "enemy" ? "敵のターン…" : p.dead ? "戦闘不能" : p.ended ? (waitOther ? "待機中(タップで取消)" : "…") : "ターン終了";
    const log = S.log.length ? esc(S.log[S.log.length - 1]) : "";
    return `<div class="sp-battle">
      <div class="sp-enemies" data-sk="en">${enemies}</div>
      <div class="sp-log">${log}</div>
      <div class="sp-party">${party}</div>
      ${selInfo}
      <div class="sp-hand">${hand || `<div class="sp-empty">手札なし</div>`}</div>
      <div class="sp-bar">
        <button class="sp-pile" data-a="pile" data-w="draw">山札<br><b>${p.draw.length}</b></button>
        <button class="sp-pile" data-a="pile" data-w="disc">捨札<br><b>${p.disc.length}</b></button>
        ${potionRow()}
        <button class="sp-end${p.ended ? " ended" : ""}" data-a="end"${b.phase !== "players" || p.dead ? " disabled" : ""}>${endLabel}</button>
      </div></div>`;
  }
  function canPlay(p, c) {
    const d = CARDS[c.c];
    if ((d.fl || []).includes("unplayable")) return false;
    const cost = cardCost(c.c, !!c.u);
    if (cost !== "X" && p.energy < cost) return false;
    if (d.tg === "ally" && ally().dead) return false;
    return true;
  }

  // ---------- 報酬 ----------
  function viewReward() {
    const r = S.rew[me], p = mePl();
    const items = [`<div class="sp-ritem">💰 +${r.gold}G</div>`];
    if (r.potion) items.push(`<div class="sp-ritem">${POTIONS[r.potion].ic} ${esc(POTIONS[r.potion].name)}</div>`);
    if (r.relic) items.push(`<div class="sp-ritem">${RELICS[r.relic].ic} ${esc(RELICS[r.relic].name)}<small>${esc(RELICS[r.relic].desc)}</small></div>`);
    const mate = S.rew[1 - me];
    const cards = r.done
      ? `<p class="sp-hint">${r.took === "skip" ? "カードは取らなかった" : `「${esc(CARDS[r.took].name)}」をデッキに加えた`}。${mate.done ? "" : "相棒を待っています…"}</p>`
      : `<p class="sp-hint">カードを1枚選ぼう</p><div class="sp-choices">${r.cards.map((c, i) => cardHTML(c, { attrs: { a: "pickcard", i } })).join("")}</div>
         <button class="sp-skip" data-a="skipcard">取らない</button>`;
    return `<div class="sp-panel" data-sk="rew"><h2>🎉 勝利!</h2><div class="sp-ritems">${items.join("")}</div>${cards}</div>${viewDeckBar()}`;
  }

  // ---------- 休憩所 ----------
  function viewRest() {
    const r = S.rest[me], p = mePl(), o = ally();
    if (r.done) return `<div class="sp-panel"><h2>🔥 休憩所</h2><p class="sp-hint">${esc(r.msg)}。${S.rest[1 - me].done ? "" : "相棒を待っています…"}</p></div>${viewDeckBar()}`;
    const heal = Math.ceil(p.maxHp * 0.3), mend = Math.ceil(o.maxHp * 0.3);
    return `<div class="sp-panel"><h2>🔥 休憩所</h2>
      <button class="sp-big" data-a="rest" data-m="heal">🛌 休息 <small>HPを${heal}回復(現在${p.hp}/${p.maxHp})</small></button>
      <button class="sp-big" data-a="smithOpen">⚒️ 鍛冶 <small>カードを1枚強化する</small></button>
      <button class="sp-big" data-a="rest" data-m="mend">🤝 治療 <small>${esc(o.name)}のHPを${mend}回復(${o.hp}/${o.maxHp})</small></button></div>${viewDeckBar()}`;
  }

  // ---------- ショップ ----------
  function viewShop() {
    const sh = S.shop[me], p = mePl();
    if (sh.left) return `<div class="sp-panel"><h2>🛒 ショップ</h2><p class="sp-hint">店を出た。${S.shop[1 - me].left ? "" : "相棒を待っています…"}</p></div>${viewDeckBar()}`;
    const cards = sh.cards.map((it, i) => `<div class="sp-shopitem${it.sold ? " sold" : ""}">${cardHTML({ c: it.c, u: 0 })}<button class="sp-price${p.gold < it.price ? " no" : ""}" ${it.sold ? "disabled" : `data-a="buy" data-k="card" data-i="${i}"`}>${it.sold ? "売約済" : it.price + "G"}</button></div>`).join("");
    const relics = sh.relics.map((it, i) => `<div class="sp-shopitem${it.sold ? " sold" : ""}"><div class="sp-relic">${RELICS[it.r].ic}<b>${esc(RELICS[it.r].name)}</b><small>${esc(RELICS[it.r].desc)}</small></div><button class="sp-price${p.gold < it.price ? " no" : ""}" ${it.sold ? "disabled" : `data-a="buy" data-k="relic" data-i="${i}"`}>${it.sold ? "売約済" : it.price + "G"}</button></div>`).join("");
    const pots = sh.potions.map((it, i) => `<div class="sp-shopitem${it.sold ? " sold" : ""}"><div class="sp-relic">${POTIONS[it.p].ic}<b>${esc(POTIONS[it.p].name)}</b><small>${esc(POTIONS[it.p].desc)}</small></div><button class="sp-price${p.gold < it.price ? " no" : ""}" ${it.sold ? "disabled" : `data-a="buy" data-k="potion" data-i="${i}"`}>${it.sold ? "売約済" : it.price + "G"}</button></div>`).join("");
    return `<div class="sp-panel" data-sk="shop"><h2>🛒 ショップ <small>あなた専用の品揃え</small></h2>
      <div class="sp-shoprow">${cards}</div><div class="sp-shoprow">${relics}${pots}</div>
      <button class="sp-big" data-a="removeOpen"${p.gold < sh.removeCost ? " disabled" : ""}>🗑️ カード削除 <small>${sh.removeCost}G</small></button>
      <button class="primary sp-big" data-a="leave">店を出る</button></div>${viewDeckBar()}`;
  }

  // ---------- 宝箱 ----------
  function viewTreasure() {
    const t = S.treasure;
    const mine = t.pick[me];
    const tiles = t.relics.map((r, i) => {
      const marks = t.pick.map((x, pi) => (x === i ? `<i class="sp-vote" style="background:${PCOL[pi]}">${pi === me ? "あ" : "相"}</i>` : "")).join("");
      return `<button class="sp-treasure${mine === i ? " mine" : ""}" ${mine === null ? `data-a="treasure" data-i="${i}"` : "disabled"}>${marks}<span class="sp-ric">${RELICS[r].ic}</span><b>${esc(RELICS[r].name)}</b><small>${esc(RELICS[r].desc)}</small></button>`;
    }).join("");
    return `<div class="sp-panel"><h2>💎 宝箱</h2><p class="sp-hint">${mine === null ? "レリックを1つ選ぼう(被ったらじゃんけんで決着)" : "相棒の選択を待っています…"}</p><div class="sp-treasures">${tiles}</div></div>${viewDeckBar()}`;
  }

  // ---------- イベント ----------
  function viewEvent() {
    const ev = S.event, def = EVENTS[ev.id], p = mePl();
    const done = ev.pick[me] !== null;
    const ch = def.choices.map((c, i) => `<button class="sp-big" ${done || (c.req && !c.req(p)) ? "disabled" : `data-a="event" data-i="${i}"`}>${esc(c.label)}</button>`).join("");
    return `<div class="sp-panel"><h2>${def.ic} ${esc(def.name)}</h2><p class="sp-text">${esc(def.text)}</p>${done ? `<p class="sp-hint">選択した:${esc(def.choices[ev.pick[me]].label)}。${ev.pick[1 - me] === null ? "相棒を待っています…" : ""}</p>` : ch}</div>${viewDeckBar()}`;
  }

  // ---------- 終了 ----------
  function viewOver() {
    const win = S.result === "win";
    return `<div class="sp-panel sp-over"><h1>${win ? "🏆 塔を制覇した!" : "💀 力尽きた…"}</h1>
      <p class="sp-text">${win ? "2人の力でボスを倒した。見事な連携だった!" : `${S.floor + 1}階で全滅した。`}</p>
      <div class="sp-summ">${S.players.map((p) => `<div>${CLASSES[p.cls].ic} ${esc(p.name)}<br>HP ${p.hp}/${p.maxHp}・デッキ${p.deck.length}枚・レリック${p.relics.length}個</div>`).join("")}</div>
      <button class="primary sp-big" data-a="again">もう一度(クラス選択へ)</button>
      <button class="sp-big" data-a="menu">ゲーム選択へ</button></div>`;
  }

  // ---------- モーダル ----------
  function viewModal() {
    const m = ui.modal;
    if (!m || !S) return "";
    let inner = "";
    const p = mePl();
    if (m.t === "deck" || m.t === "mate") {
      const q = m.t === "deck" ? p : ally();
      const cards = [...q.deck].sort((a, b) => CARDS[a.c].type.localeCompare(CARDS[b.c].type) || CARDS[a.c].name.localeCompare(CARDS[b.c].name));
      inner = `<h3>${CLASSES[q.cls].ic} ${esc(q.name)}のデッキ(${q.deck.length}枚)</h3>
        <div class="sp-mrel">${q.relics.map((r) => `<span class="sp-rl" title="${esc(RELICS[r].name)}">${RELICS[r].ic} <small>${esc(RELICS[r].name)}:${esc(RELICS[r].desc)}</small></span>`).join("")}</div>
        <div class="sp-grid">${cards.map((c) => cardHTML(c)).join("")}</div>`;
    } else if (m.t === "pile") {
      const arr = p[m.w];
      const title = { draw: "山札(中身はランダム順)", disc: "捨札", exh: "除外" }[m.w];
      const sorted = [...arr].sort((a, b) => CARDS[a.c].name.localeCompare(CARDS[b.c].name));
      inner = `<h3>${title}(${arr.length}枚)</h3><div class="sp-grid">${sorted.map((c) => cardHTML(c)).join("") || "<p>なし</p>"}</div>`;
    } else if (m.t === "pick") {
      const list = m.purpose === "smith" ? p.deck.filter((c) => !c.u && CARDS[c.c].type !== "status") : p.deck;
      inner = `<h3>${m.purpose === "smith" ? "強化するカードを選ぶ" : `削除するカードを選ぶ(${S.shop ? S.shop[me].removeCost : SHOP_REMOVE}G)`}</h3>
        <div class="sp-grid">${list.map((c) => cardHTML(c, { attrs: { a: "pickdeck", uid: c.id, purpose: m.purpose } })).join("") || "<p>対象なし</p>"}</div>`;
    } else if (m.t === "info") {
      inner = m.html;
    }
    return `<div class="sp-modal" data-a="closeModal"><div class="sp-mbox" data-sk="modal">${inner}<button class="sp-mclose" data-a="closeModal">閉じる</button></div></div>`;
  }
  function infoHTML(kind, i) {
    if (kind === "e") {
      const e = S.battle.enemies[i], def = ENEMIES[e.id];
      const sts = Object.entries(e.st).filter(([, v]) => v).map(([k, v]) => `<li><b>${statusNames[k] || k}${["barricade", "link", "taunt", "sleep"].includes(k) ? "" : " " + v}</b>:${esc((statusDesc[k] || "").replace(/n/g, Math.abs(v)))}</li>`).join("");
      return `<h3>${e.ic} ${esc(e.name)}</h3><p>HP ${e.hp}/${e.maxHp}${e.block ? `・ブロック${e.block}` : ""}</p>${def.note ? `<p class="note">${esc(def.note)}</p>` : ""}<ul>${sts || "<li>状態異常なし</li>"}</ul>`;
    }
    const q = S.players[i];
    const sts = Object.entries(q.st).filter(([, v]) => v).map(([k, v]) => `<li><b>${statusNames[k] || k}${["barricade", "link", "taunt", "sleep"].includes(k) ? "" : " " + v}</b>:${esc((statusDesc[k] || "").replace(/n/g, Math.abs(v)))}</li>`).join("");
    return `<h3>${CLASSES[q.cls].ic} ${esc(q.name)}</h3><p>HP ${q.hp}/${q.maxHp}・エナジー${q.energy}</p><ul>${sts || "<li>状態異常なし</li>"}</ul>
      <button data-a="mate2" data-i="${i}">デッキとレリックを見る</button>`;
  }

  // ================= 入力 =================
  function onClick(ev) {
    const el = ev.target.closest("[data-a]");
    if (!el || !S) {
      if (ui.sel && !el) { ui.sel = null; render(); }
      return;
    }
    const a = el.dataset.a;
    const d = el.dataset;
    if (a === "closeModal") { if (ev.target === el || el.classList.contains("sp-mclose")) { ui.modal = null; render(); } return; }
    if (ui.modal && a !== "pickdeck" && a !== "mate2") return;
    switch (a) {
      case "menu": if (confirm("冒険をやめてゲーム選択にもどりますか?")) document.getElementById("btn-to-lobby").click(); break;
      case "deck": ui.modal = { t: "deck" }; render(); break;
      case "mate": ui.modal = { t: "mate" }; render(); break;
      case "mate2": ui.modal = { t: "mate" }; render(); break;
      case "pile": ui.modal = { t: "pile", w: d.w }; render(); break;
      case "relic": ui.modal = { t: "info", html: `<h3>${RELICS[d.r].ic} ${esc(RELICS[d.r].name)}</h3><p>${esc(RELICS[d.r].desc)}</p>` }; render(); break;
      case "card": {
        if (locked || S.phase !== "battle") break;
        const p = mePl(), c = p.hand.find((x) => x.id === +d.uid);
        if (!c) break;
        if (ui.sel && ui.sel.k === "card" && ui.sel.uid === c.id) {
          const tg = CARDS[c.c].tg;
          if (tg === "enemy" || tg === "ally") { ui.sel = null; render(); break; }
          ui.sel = null; dispatch({ type: "play", uid: c.id, target: null });
          break;
        }
        if (!canPlay(p, c) || p.ended) { toast(p.ended ? "ターン終了済み" : "使えません(エナジー不足など)"); break; }
        ui.sel = { k: "card", uid: c.id }; render();
        break;
      }
      case "enemy": {
        if (locked) break;
        const i = +d.i, e = S.battle.enemies[i];
        const sel = ui.sel;
        if (sel && !e.dead) {
          if (sel.k === "card") { const uid = sel.uid; ui.sel = null; dispatch({ type: "play", uid, target: { k: "e", i } }); break; }
          if (sel.k === "potion") { const slot = sel.slot; ui.sel = null; dispatch({ type: "potion", slot, tk: "e", ti: i }); break; }
        }
        ui.modal = { t: "info", html: infoHTML("e", i) }; render();
        break;
      }
      case "pl": {
        const i = +d.i, sel = ui.sel;
        if (sel && !locked && !S.players[i].dead) {
          if (sel.k === "card" && i !== me) { const uid = sel.uid; ui.sel = null; dispatch({ type: "play", uid, target: { k: "p", i } }); break; }
          if (sel.k === "potion") { const slot = sel.slot; ui.sel = null; dispatch({ type: "potion", slot, tk: "p", ti: i }); break; }
        }
        ui.modal = { t: "info", html: infoHTML("p", i) }; render();
        break;
      }
      case "potion": {
        if (S.phase !== "battle") { const id = mePl().potions[+d.slot]; ui.modal = { t: "info", html: `<h3>${POTIONS[id].ic} ${esc(POTIONS[id].name)}</h3><p>${esc(POTIONS[id].desc)}(戦闘中に使えます)</p>` }; render(); break; }
        if (locked) break;
        if (ui.sel && ui.sel.k === "potion" && ui.sel.slot === +d.slot) ui.sel = null; else ui.sel = { k: "potion", slot: +d.slot };
        render(); break;
      }
      case "end": ui.sel = null; dispatch({ type: "end" }); break;
      case "vote": dispatch({ type: "vote", node: +d.n }); break;
      case "pickcard": dispatch({ type: "pickCard", idx: +d.i }); break;
      case "skipcard": dispatch({ type: "skipCard" }); break;
      case "rest": dispatch({ type: "rest", mode: d.m }); break;
      case "smithOpen": ui.modal = { t: "pick", purpose: "smith" }; render(); break;
      case "removeOpen": ui.modal = { t: "pick", purpose: "remove" }; render(); break;
      case "pickdeck": {
        const purpose = d.purpose, uid = +d.uid;
        ui.modal = null;
        if (purpose === "smith") dispatch({ type: "rest", mode: "smith", uid }); else dispatch({ type: "remove", uid });
        break;
      }
      case "buy": dispatch({ type: "buy", kind: d.k, idx: +d.i }); break;
      case "leave": dispatch({ type: "leave" }); break;
      case "treasure": dispatch({ type: "treasure", idx: +d.i }); break;
      case "event": dispatch({ type: "event", idx: +d.i }); break;
      case "again": send({ t: "again" }); toLobby(); break;
      default: break;
    }
  }
  function toLobby() { closeOverlay(); myReady = false; theirReady = false; renderLobby(); }

  // ================= 演出 =================
  function entEl(k, i) { return ov ? ov.querySelector(`[data-ent="${k}${i}"]`) : null; }
  function floatText(el, text, cls) {
    if (!el || !ov) return;
    const r = el.getBoundingClientRect(), o = ov.getBoundingClientRect();
    const f = document.createElement("div");
    f.className = "sp-float " + cls;
    f.textContent = text;
    f.style.left = r.left - o.left + r.width / 2 + (Math.random() * 20 - 10) + "px";
    f.style.top = r.top - o.top + r.height * 0.3 + "px";
    ov.appendChild(f);
    setTimeout(() => f.remove(), 1000);
  }
  function animate(evs) {
    if (!ov || !evs) return;
    for (const e of evs) {
      const el = e.k ? entEl(e.k, e.i) : null;
      switch (e.t) {
        case "dmg": if (el) { el.classList.add("hit"); setTimeout(() => el.classList.remove("hit"), 350); } floatText(el, `-${e.n}`, "dmg"); break;
        case "blocked": floatText(el, `🛡️${e.n}`, "blk"); break;
        case "heal": floatText(el, `+${e.n}`, "heal"); break;
        case "block": floatText(el, `🛡️+${e.n}`, "blk"); break;
        case "energy": floatText(el, `⚡+${e.n}`, "eng"); break;
        case "status": floatText(el, `${statusNames[e.key] || e.key}${e.n > 0 ? "+" : ""}${e.n}`, e.n < 0 || DEBUFFS.has(e.key) ? "bad" : "good"); break;
        case "note": floatText(el, e.text, "note"); break;
        case "lunge": if (el) { el.classList.add("lunge"); setTimeout(() => el.classList.remove("lunge"), 450); } break;
        case "play": if (e.i !== me) showPlayed(e); break;
        case "potion": if (e.i !== me) showPlayedText(`${S.players[e.i].name}が${POTIONS[e.potion].name}を使った`); break;
        default: break;
      }
    }
  }
  function showPlayed(e) {
    showPlayedText(`${S.players[e.i].name}: ${CARDS[e.card].ic} ${CARDS[e.card].name}${e.up ? "+" : ""}`);
  }
  function showPlayedText(t) {
    if (!ov) return;
    const d = document.createElement("div");
    d.className = "sp-played"; d.textContent = t;
    ov.appendChild(d);
    setTimeout(() => d.remove(), 1400);
  }

  renderLobby();
  return {
    onMessage(m) {
      if (m.t === "pick") { theirCls = m.cls; theirReady = !!m.ready && !!m.cls; if (!ov) renderLobby(); }
      else if (m.t === "act" && me === 0 && game) {
        const steps = game.apply(m.a, 1);
        if (steps.length) { send({ t: "steps", steps }); enqueue(steps); }
      } else if (m.t === "steps" && me === 1) {
        if (!ov) openOverlay();
        enqueue(m.steps);
      } else if (m.t === "again") { toLobby(); }
    },
    // テスト用: ホストのエンジンを直接操作して任意の場面を作る
    debug: {
      get game() { return game; },
      push() { const steps = [{ s: JSON.parse(JSON.stringify(game.s)), ev: [], d: 0 }]; send({ t: "steps", steps }); enqueue(steps); },
    },
    destroy() { destroyed = true; closeOverlay(); },
  };
}

export default {
  id: "spire",
  name: "デッキタワー(協力)",
  desc: "2人で塔を登る協力デッキ構築ローグライク。同時にカードを出して敵を倒し、デッキを育てよう",
  create,
};
