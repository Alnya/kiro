// 実行: node tests/spire-bot.test.mjs [ゲーム数]
// ボット2体でランを最後まで遊ばせ、クラッシュ・不変条件違反・無限ループがないか、おおまかな難易度を確認する。
import { Game, MAX_HAND } from "../js/spire/engine.js";
import { CARDS, ENEMIES, RELICS, POTIONS, cardCost } from "../js/spire/data.js";

const N = +(process.argv[2] || 60); const ONLY = process.argv[3] ? +process.argv[3] : null;
let fails = 0;
const bad = (m) => { fails++; if (fails < 15) console.log("  NG:", m); };

function check(g) {
  const s = g.s;
  for (const p of s.players) {
    if (!(p.hp >= 0 && p.hp <= p.maxHp)) bad(`hp範囲外 ${p.hp}/${p.maxHp}`);
    if (p.hand.length > MAX_HAND) bad("手札上限超過");
    if (p.energy < 0) bad("エナジー負");
    if (p.block < 0) bad("ブロック負");
    for (const c of [...p.deck, ...p.hand, ...p.draw, ...p.disc, ...p.exh]) if (!CARDS[c.c]) bad("不明カード " + c.c);
    for (const r of p.relics) if (!RELICS[r]) bad("不明レリック " + r);
    for (const x of p.potions) if (x && !POTIONS[x]) bad("不明ポーション " + x);
    for (const k of Object.keys(p.st)) if (Number.isNaN(p.st[k])) bad("状態NaN " + k);
  }
  if (s.battle) for (const e of s.battle.enemies) {
    if (!ENEMIES[e.id]) bad("不明敵");
    if (!(e.hp >= 0 && e.hp <= e.maxHp)) bad(`敵hp範囲外 ${e.id} ${e.hp}/${e.maxHp}`);
    if (!e.dead && s.phase === "battle" && !ENEMIES[e.id].moves[e.move]) bad(`敵の行動が不明 ${e.id} ${e.move}`);
  }
}

// ---- 簡易ボット ----
function botPlay(g, pi) {
  const s = g.s, p = g.P(pi);
  if (p.dead || p.ended) return false;
  const live = g.enemies();
  const incoming = live.reduce((a, e) => a + (e.intent && e.intent.d ? e.intent.d * e.intent.h * (e.intent.all || e.intent.tgt === pi ? 1 : 0) : 0), 0);
  let best = null, bestScore = -1;
  for (const c of p.hand) {
    if (!g.canPlay(p, c)) continue;
    const d = CARDS[c.c];
    const cost = cardCost(c.c, c.u);
    if (cost !== "X" && cost > p.energy) continue;
    let score = 1 + Math.random();
    if (d.type === "power") score = 50;
    else if (d.type === "attack") score = 20 + (d.v.d || 0);
    else if (d.type === "skill") {
      const needBlock = incoming > p.block;
      if (d.v.b && needBlock) score = 30; else if (d.v.b) score = 4;
      else score = 15;
    }
    if (d.coop) score += 6;
    if (cost === 0) score += 3;
    if (score > bestScore) { bestScore = score; best = c; }
  }
  if (!best) return false;
  const d = CARDS[best.c];
  let target = null;
  if (d.tg === "enemy") {
    const e = [...live].sort((a, b) => a.hp - b.hp)[0];
    target = { k: "e", i: e.ix };
  } else if (d.tg === "ally") {
    const o = g.other(p);
    if (!o) return false;
    target = { k: "p", i: o.i };
  }
  const steps = g.apply({ type: "play", uid: best.id, target }, pi);
  return steps.length > 0;
}

function botPhase(g, pi) {
  const s = g.s, p = g.P(pi);
  const apply = (a) => g.apply(a, pi).length > 0;
  switch (s.phase) {
    case "battle": {
      if (s.battle.phase !== "players" || p.dead) return false;
      if (p.ended) return false;
      // 低HPならポーション
      if (p.hp < p.maxHp * 0.4) {
        const slot = p.potions.findIndex((x) => x === "heal" || x === "block");
        if (slot >= 0) return apply({ type: "potion", slot, tk: "p", ti: pi });
      }
      for (let guard = 0; guard < 30; guard++) if (!botPlay(g, pi)) break;
      return apply({ type: "end" });
    }
    case "map": {
      if (s.vote[pi] !== null) return false;
      const o = g.options();
      return apply({ type: "vote", node: o[Math.floor(Math.random() * o.length)] });
    }
    case "reward": {
      if (s.rew[pi].done) return false;
      return Math.random() < 0.25 ? apply({ type: "skipCard" }) : apply({ type: "pickCard", idx: Math.floor(Math.random() * s.rew[pi].cards.length) });
    }
    case "rest": {
      if (s.rest[pi].done) return false;
      const o = g.P(1 - pi);
      if (o.hp < o.maxHp * 0.5 && p.hp > p.maxHp * 0.8) return apply({ type: "rest", mode: "mend" });
      if (p.hp < p.maxHp * 0.7) return apply({ type: "rest", mode: "heal" });
      const up = p.deck.filter((c) => g.upgradable(c));
      return up.length ? apply({ type: "rest", mode: "smith", uid: up[Math.floor(Math.random() * up.length)].id }) : apply({ type: "rest", mode: "heal" });
    }
    case "shop": {
      const sh = s.shop[pi];
      if (sh.left) return false;
      for (let i = 0; i < sh.cards.length; i++) if (!sh.cards[i].sold && p.gold >= sh.cards[i].price && Math.random() < 0.5) return apply({ type: "buy", kind: "card", idx: i });
      for (let i = 0; i < sh.relics.length; i++) if (!sh.relics[i].sold && p.gold >= sh.relics[i].price) return apply({ type: "buy", kind: "relic", idx: i });
      for (let i = 0; i < sh.potions.length; i++) if (!sh.potions[i].sold && p.gold >= sh.potions[i].price && p.potions.includes(null)) return apply({ type: "buy", kind: "potion", idx: i });
      if (p.gold >= sh.removeCost) { const bad = p.deck.find((c) => c.c === "strike" || c.c === "wound"); if (bad) return apply({ type: "remove", uid: bad.id }); }
      return apply({ type: "leave" });
    }
    case "treasure": return s.treasure && s.treasure.pick[pi] === null ? apply({ type: "treasure", idx: Math.floor(Math.random() * s.treasure.relics.length) }) : false;
    case "event": {
      const ev = s.event;
      if (!ev || ev.pick[pi] !== null) return false;
      for (let i = 0; i < 4; i++) if (apply({ type: "event", idx: i })) return true;
      return false;
    }
    default: return false;
  }
}

const stats = { win: 0, lose: 0, stuck: 0, floors: [], turns: [] };
const t0 = Date.now();
const classesAll = ["knight", "mage", "ranger"];
for (let n = ONLY ?? 0; n < (ONLY !== null ? ONLY + 1 : N); n++) {
  const g = new Game({ seed: 1000 + n, classes: [classesAll[n % 3], classesAll[(n + 1 + (n >> 2)) % 3]] });
  let guard = 0, idle = 0;
  while (g.s.phase !== "over" && guard++ < 6000) {
    let acted = false;
    for (const pi of [0, 1]) {
      if (botPhase(g, pi)) { acted = true; check(g); }
    }
    if (!acted) { if (++idle > 3) break; } else idle = 0;
  }
  if (g.s.phase === "over") { stats[g.s.result]++; stats.floors.push(g.s.floor); }
  else { stats.stuck++; console.log(`  stuck: seed ${1000 + n} phase=${g.s.phase} floor=${g.s.floor}`); fails++; if (ONLY !== null) console.log(JSON.stringify({ turn: g.s.battle.turn, ph: g.s.battle.phase, en: g.s.battle.enemies.map((e) => [e.id, e.hp, e.maxHp, e.move, e.dead, e.st, e.mode]), pl: g.s.players.map((p) => [p.hp, p.dead, p.ended, p.energy, p.hand.length]) })); }
}
const avg = (a) => (a.reduce((x, y) => x + y, 0) / Math.max(1, a.length)).toFixed(1);
console.log(`ラン ${N}回: 勝利 ${stats.win} / 敗北 ${stats.lose} / 停止 ${stats.stuck} / 到達階平均 ${avg(stats.floors)} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
console.log(fails ? `失敗 ${fails} 件` : "不変条件違反なし");
process.exit(fails ? 1 : 0);
