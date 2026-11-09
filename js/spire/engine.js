// 協力デッキ構築ローグライクのエンジン(DOM非依存)。ホストだけが実行し、状態スナップショットを配る。
import { CARDS, CLASSES, ENEMIES, ENCOUNTERS, RELICS, POTIONS, EVENTS, cardFlags, cardVals, cardCost } from "./data.js";

export const HAND_SIZE = 5, MAX_HAND = 10, ENERGY = 3;
export const FLOORS = 10;       // 通常階 0..9、ボス階 10
const LANES = 5;
const ACT_MULT = 1.1;           // ACT1のHP補正(人数倍にさらに掛かる)
export const SHOP_REMOVE = 75;

const isPl = (e) => e && e.cls !== undefined;

export class Game {
  constructor({ seed, classes, names }) {
    this.steps = [];
    this.evs = [];
    this.s = {
      v: 1, rng: seed >>> 0, phase: "map", floor: -1, cur: null, vote: [null, null], uid: 1, log: [],
      players: [],
      map: null, battle: null, rew: null, rest: null, shop: null, treasure: null, event: null, result: null, boss: null,
    };
    this.s.players = classes.map((cls, i) => this.newPlayer(i, cls, names ? names[i] : CLASSES[cls].name));
    this.s.boss = ENCOUNTERS.boss[Math.floor(this.rnd() * ENCOUNTERS.boss.length)][0];
    this.s.map = this.genMap();
  }

  // ---------- 乱数 ----------
  rnd() {
    this.s.rng = (this.s.rng + 0x6d2b79f5) >>> 0;
    let t = this.s.rng;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  ri(n) { return Math.floor(this.rnd() * n); }
  pick(a) { return a[this.ri(a.length)]; }
  shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) { const j = this.ri(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  log(t) { this.s.log.push(t); if (this.s.log.length > 8) this.s.log.shift(); }
  uid() { return this.s.uid++; }

  // ---------- 生成 ----------
  newPlayer(i, cls, name) {
    const c = CLASSES[cls];
    const p = {
      i, cls, name, maxHp: c.hp, hp: c.hp, gold: 99, deck: [], relics: [c.relic], potions: [null, null],
      hand: [], draw: [], disc: [], exh: [], energy: 0, block: 0, st: {}, ended: false, dead: false, played: 0,
      firstDraw: 0, firstEnergy: 0,
    };
    for (const id of c.start) p.deck.push({ c: id, u: 0, id: this.uid() });
    return p;
  }
  P(i) { return this.s.players[i]; }
  livingPlayers() { return this.s.players.filter((p) => !p.dead); }
  other(p) { return this.s.players.find((q) => q !== p && !q.dead) || null; }
  enemies() { return this.s.battle ? this.s.battle.enemies.filter((e) => !e.dead) : []; }

  genMap() {
    const nodes = [];
    const at = {};
    const get = (f, lane) => {
      const k = f * 10 + lane;
      if (!at[k]) { at[k] = { id: nodes.length, f, lane, type: "M", next: [] }; nodes.push(at[k]); }
      return at[k];
    };
    const boss = get(FLOORS, 2);
    boss.type = "B";
    const lanes = this.shuffle([0, 1, 2, 3, 4]).slice(0, 3 + this.ri(2));
    for (const start of lanes) {
      let lane = start;
      for (let f = 0; f < FLOORS; f++) {
        const n = get(f, lane);
        const nl = Math.max(0, Math.min(LANES - 1, lane + this.ri(3) - 1));
        const t = f + 1 === FLOORS ? boss : get(f + 1, nl);
        if (!n.next.includes(t.id)) n.next.push(t.id);
        lane = nl;
      }
    }
    for (const n of nodes) {
      if (n.type === "B") continue;
      if (n.f === 0) n.type = "M";
      else if (n.f === 4) n.type = "T";
      else if (n.f === FLOORS - 1) n.type = "R";
      else {
        const w = [["M", 46], ["Q", 22], ["E", n.f >= 3 ? 10 : 0], ["R", 12], ["S", n.f >= 2 ? 10 : 0]];
        let r = this.rnd() * w.reduce((a, b) => a + b[1], 0);
        n.type = "M";
        for (const [t, x] of w) { r -= x; if (r <= 0) { n.type = t; break; } }
      }
    }
    return { nodes, floors: FLOORS + 1 };
  }

  // ---------- スナップショット ----------
  ev(t, ent, n = 0, extra) {
    const o = { t, n, ...extra };
    if (ent) { if (isPl(ent)) { o.k = "p"; o.i = ent.i; } else { o.k = "e"; o.i = ent.ix; } }
    this.evs.push(o);
  }
  snap(delay = 0) {
    this.refreshIntents();
    this.steps.push({ s: JSON.parse(JSON.stringify(this.s)), ev: this.evs.splice(0), d: delay });
  }

  // 外部APIの入口。戻り値: ステップ配列(空なら無効な操作)
  apply(a, who) {
    this.steps = []; this.evs = [];
    let ok = false;
    try { ok = this.handle(a, who); } catch (e) { console.error("apply error", a, e); ok = false; }
    if (!ok) return [];
    this.checkEnd();
    this.snap(0);
    return this.steps;
  }

  handle(a, who) {
    const s = this.s, p = this.P(who);
    if (!p) return false;
    switch (a.type) {
      case "play": return s.phase === "battle" && this.playCard(p, a.uid, a.target);
      case "end": return s.phase === "battle" && this.endTurn(p);
      case "potion": return s.phase === "battle" && this.usePotion(p, a.slot, a.tk, a.ti);
      case "vote": return s.phase === "map" && this.vote(p, a.node);
      case "pickCard": return s.phase === "reward" && this.pickCard(p, a.idx);
      case "skipCard": return s.phase === "reward" && this.skipCard(p);
      case "rest": return s.phase === "rest" && this.restAct(p, a);
      case "buy": return s.phase === "shop" && this.buy(p, a);
      case "remove": return s.phase === "shop" && this.shopRemove(p, a.uid);
      case "leave": return s.phase === "shop" && this.leaveShop(p);
      case "treasure": return s.phase === "treasure" && this.treasurePick(p, a.idx);
      case "event": return s.phase === "event" && this.eventPick(p, a.idx);
      default: return false;
    }
  }

  // ---------- ダメージ・ブロック・状態 ----------
  calcDamage(src, tgt, base) {
    let d = base + (src && src.st ? src.st.str || 0 : 0);
    if (src && isPl(src) && tgt.st.marked) d += tgt.st.marked;
    if (src && src.st && src.st.weak) d *= 0.75;
    if (tgt.st.vuln) d *= 1.5;
    return Math.max(0, Math.floor(d));
  }
  // 攻撃(筋力・弱点などを計算)。実際に減ったHPの合計を返す
  hit(src, tgt, base, times = 1) {
    let total = 0;
    for (let i = 0; i < times; i++) {
      if (tgt.dead) break;
      total += this.dealDamage(src, tgt, this.calcDamage(src, tgt, base), { attack: true });
    }
    return total;
  }
  aoe(src, base, times = 1) {
    let total = 0;
    for (let i = 0; i < times; i++) for (const e of this.enemies()) total += this.dealDamage(src, e, this.calcDamage(src, e, base), { attack: true });
    return total;
  }
  dealDamage(src, tgt, amt, opts = {}) {
    if (tgt.dead) return 0;
    let dmg = amt, absorbed = 0;
    if (tgt.block > 0) { absorbed = Math.min(tgt.block, dmg); tgt.block -= absorbed; dmg -= absorbed; }
    let lost = 0;
    if (dmg > 0) {
      tgt.hp -= dmg; lost = dmg;
      this.ev("dmg", tgt, dmg, { blocked: absorbed });
      if (!isPl(tgt)) {
        const def = ENEMIES[tgt.id];
        if (tgt.st.sleep) { delete tgt.st.sleep; this.ev("note", tgt, 0, { text: "目を覚ました!" }); this.rePlan(tgt); }
        if (tgt.st.curl) { this.rawBlock(tgt, tgt.st.curl); delete tgt.st.curl; }
        if (def.onDamaged && tgt.hp > 0) def.onDamaged(this, tgt, dmg);
      }
    } else if (absorbed) {
      this.ev("blocked", tgt, absorbed);
    }
    if (opts.attack && src && tgt.st.thorns && !opts.thorns) this.dealDamage(null, src, tgt.st.thorns, { thorns: true });
    if (tgt.hp <= 0) this.die(tgt);
    return lost;
  }
  loseHp(ent, n) {
    if (ent.dead || n <= 0) return;
    if (this.s.phase !== "battle") { ent.hp = Math.max(1, ent.hp - n); return; } // 戦闘外では死なない
    ent.hp -= n;
    this.ev("dmg", ent, n, { blocked: 0 });
    if (ent.hp <= 0) this.die(ent);
  }
  die(ent) {
    if (ent.dead) return;
    ent.hp = 0; ent.dead = true;
    this.ev("die", ent);
    if (isPl(ent)) {
      this.discardHand(ent);
      ent.ended = true; ent.block = 0;
      this.log(`${ent.name}は倒れた!`);
    } else {
      this.log(`${ent.name}を倒した`);
      const def = ENEMIES[ent.id];
      if (def.onDeath) def.onDeath(this, ent);
    }
  }
  rawBlock(ent, n) {
    if (ent.dead || n <= 0) return;
    ent.block += n;
    this.ev("block", ent, n);
  }
  // カードによるブロック(敏捷・もろさ・守りの絆を反映)
  block(p, n) {
    let b = n + (p.st.dex || 0);
    if (p.st.frail) b *= 0.75;
    b = Math.max(0, Math.floor(b));
    this.rawBlock(p, b);
    if (p.st.link) for (const q of this.livingPlayers()) if (q !== p) this.rawBlock(q, Math.floor(b / 2));
  }
  heal(ent, n) {
    if (ent.dead || n <= 0) return;
    const h = Math.min(n, ent.maxHp - ent.hp);
    if (h <= 0) return;
    ent.hp += h;
    this.ev("heal", ent, h);
  }
  status(ent, key, n) {
    if (ent.dead || !n) return;
    const v = (ent.st[key] || 0) + n;
    if (v === 0 || (v < 0 && key !== "str" && key !== "dex")) delete ent.st[key]; else ent.st[key] = v;
    this.ev("status", ent, n, { key });
  }
  draw(p, n) {
    let drawn = 0;
    for (let i = 0; i < n; i++) {
      if (p.hand.length >= MAX_HAND) break;
      if (!p.draw.length) {
        if (!p.disc.length) break;
        p.draw = this.shuffle(p.disc); p.disc = [];
      }
      p.hand.push(p.draw.pop()); drawn++;
    }
    if (drawn) this.ev("draw", p, drawn);
  }
  addEnergy(p, n) { if (!p.dead) { p.energy += n; this.ev("energy", p, n); } }
  addCard(p, id, where, up, n = 1) {
    for (let i = 0; i < n; i++) {
      const c = { c: id, u: up ? 1 : 0, id: this.uid() };
      if (where === "hand" && p.hand.length < MAX_HAND) p.hand.push(c);
      else if (where === "draw") p.draw.splice(this.ri(p.draw.length + 1), 0, c);
      else p.disc.push(c);
    }
    this.ev("addcard", p, n, { card: id });
  }
  discardHand(p) { while (p.hand.length) p.disc.push(p.hand.pop()); }

  // ---------- 敵 ----------
  spawn(id) {
    const def = ENEMIES[id];
    const n = this.s.players.length;
    const hp = Math.round((def.hp[0] + this.ri(def.hp[1] - def.hp[0] + 1)) * ACT_MULT * n);
    const b = this.s.battle;
    const e = { id, name: def.name, ic: def.ic, maxHp: hp, hp, block: 0, st: {}, move: null, tgt: null, hist: [], dead: false, ix: b.enemies.length, elite: !!def.elite, boss: !!def.boss };
    b.enemies.push(e);
    if (def.start) def.start(this, e);
    this.plan(e);
    this.ev("spawn", e);
    return e;
  }
  plan(e) {
    const def = ENEMIES[e.id];
    e.move = def.ai(e, this);
    const mv = def.moves[e.move];
    const live = this.livingPlayers();
    e.tgt = live.length && !(mv.all) ? this.pick(live).i : null;
  }
  rePlan(e) { this.plan(e); }
  refreshIntents() {
    const b = this.s.battle;
    if (!b) return;
    for (const e of b.enemies) {
      if (e.dead) { e.intent = null; continue; }
      const mv = ENEMIES[e.id].moves[e.move];
      if (!mv) { e.intent = null; continue; }
      const t = this.s.players[e.tgt] && !this.s.players[e.tgt].dead ? this.s.players[e.tgt] : this.livingPlayers()[0];
      let d = null;
      if (mv.d !== undefined && t) d = this.calcDamage(e, t, mv.d);
      e.intent = { k: mv.k, d, h: mv.h || 1, all: !!mv.all, b: mv.b ? mv.b * this.s.players.length : 0, tgt: e.tgt, all2: !!mv.all };
    }
  }

  // ---------- 戦闘 ----------
  startBattle(ids, kind) {
    const s = this.s;
    s.phase = "battle";
    s.battle = { enemies: [], turn: 0, phase: "players", kind };
    for (const p of s.players) {
      p.block = 0; p.st = {}; p.energy = 0; p.ended = false; p.dead = false; p.played = 0; p.firstDraw = 0; p.firstEnergy = 0;
      p.hand = []; p.disc = []; p.exh = [];
      const deck = p.deck.map((c) => ({ ...c }));
      this.shuffle(deck);
      // 初手(innate)を山札の上に
      deck.sort((x, y) => (cardFlags(x.c, x.u).includes("innate") ? 1 : 0) - (cardFlags(y.c, y.u).includes("innate") ? 1 : 0));
      p.draw = deck;
    }
    for (const id of ids) this.spawn(id);
    for (const p of s.players) for (const r of p.relics) if (RELICS[r].onStart) RELICS[r].onStart(this, p);
    this.log("戦闘開始!");
    this.beginPlayerTurn(true);
  }
  beginPlayerTurn(first) {
    const b = this.s.battle;
    b.turn++; b.phase = "players";
    for (const p of this.s.players) {
      if (p.dead) continue;
      if (!p.st.barricade) p.block = 0;
      p.energy = ENERGY + (p.st.energyUp || 0) + (first ? p.firstEnergy : 0);
      p.ended = false; p.played = 0;
      if (p.st.demon) this.status(p, "str", p.st.demon);
      if (p.st.plague) for (const e of this.enemies()) this.status(e, "poison", p.st.plague);
      if (p.st.blades) this.addCard(p, "shiv", "hand", false, p.st.blades);
      if (p.st.poison) { this.loseHp(p, p.st.poison); p.st.poison -= 1; if (p.st.poison <= 0) delete p.st.poison; }
      if (p.dead) continue;
      this.draw(p, HAND_SIZE + (p.st.drawUp || 0) + (first ? p.firstDraw : 0));
    }
    this.ev("turn", null, b.turn);
    if (this.s.players.every((p) => p.dead)) this.gameOver();
  }

  canPlay(p, card) {
    const def = CARDS[card.c];
    if (cardFlags(card.c, card.u).includes("unplayable")) return false;
    const cost = cardCost(card.c, card.u);
    if (cost !== "X" && p.energy < cost) return false;
    if (def.tg === "ally" && !this.other(p)) return false;
    return true;
  }
  playCard(p, uid, target) {
    const b = this.s.battle;
    if (b.phase !== "players" || p.dead || p.ended) return false;
    const idx = p.hand.findIndex((c) => c.id === uid);
    if (idx < 0) return false;
    const card = p.hand[idx], def = CARDS[card.c];
    if (!this.canPlay(p, card)) return false;
    let t = null;
    if (def.tg === "enemy") {
      if (!target || target.k !== "e") return false;
      t = b.enemies[target.i];
      if (!t || t.dead) return false;
    } else if (def.tg === "ally") {
      if (!target || target.k !== "p" || target.i === p.i) return false;
      t = this.P(target.i);
      if (!t || t.dead) return false;
    }
    let cost = cardCost(card.c, card.u), x = 0;
    if (cost === "X") { x = p.energy; cost = p.energy; }
    p.energy -= cost;
    p.hand.splice(idx, 1);
    const up = !!card.u;
    this.ev("play", p, 0, { card: card.c, up, tk: t ? (isPl(t) ? "p" : "e") : null, ti: t ? (isPl(t) ? t.i : t.ix) : null });
    def.play(this, { p, t, v: cardVals(card.c, up), x, up, card });
    p.played++;
    if (def.type === "skill") for (const e of this.enemies()) if (e.st.enrage) this.status(e, "str", e.st.enrage);
    if (def.type === "power") { /* 場に残る(カードは消える) */ }
    else if (cardFlags(card.c, card.u).includes("exhaust")) p.exh.push(card);
    else p.disc.push(card);
    return true;
  }
  endTurn(p) {
    const b = this.s.battle;
    if (b.phase !== "players" || p.dead) return false;
    p.ended = !p.ended;
    this.ev("ended", p, p.ended ? 1 : 0);
    if (this.livingPlayers().every((q) => q.ended)) this.runEnemyPhase();
    return true;
  }
  usePotion(p, slot, tk, ti) {
    const b = this.s.battle;
    if (b.phase !== "players" || p.dead) return false;
    const id = p.potions[slot];
    if (!id) return false;
    const def = POTIONS[id];
    let t;
    if (def.tg === "enemy") { t = b.enemies[ti]; if (tk !== "e" || !t || t.dead) return false; }
    else { t = this.P(ti); if (tk !== "p" || !t || t.dead) return false; }
    p.potions[slot] = null;
    this.ev("potion", p, 0, { potion: id });
    def.use(this, p, t);
    return true;
  }

  runEnemyPhase() {
    const b = this.s.battle;
    b.phase = "enemy";
    // --- プレイヤーのターン終了処理 ---
    for (const p of this.livingPlayers()) {
      for (const r of p.relics) if (RELICS[r].onEnd) RELICS[r].onEnd(this, p);
      if (p.st.metal) this.rawBlock(p, p.st.metal);
      if (p.st.strTmp) { this.status(p, "str", -p.st.strTmp); delete p.st.strTmp; }
      const keep = [];
      for (const c of p.hand) {
        const fl = cardFlags(c.c, c.u);
        if (fl.includes("retain")) keep.push(c);
        else if (fl.includes("ethereal")) p.exh.push(c);
        else p.disc.push(c);
      }
      p.hand = keep;
      for (const k of ["vuln", "weak", "frail"]) if (p.st[k]) { p.st[k]--; if (p.st[k] <= 0) delete p.st[k]; }
    }
    this.snap(300);
    // --- 敵の行動 ---
    for (const e of [...b.enemies]) {
      if (e.dead) continue;
      if (this.livingPlayers().length === 0) break;
      e.block = 0;
      if (e.st.poison) {
        this.loseHp(e, e.st.poison);
        e.st.poison -= 1;
        if (e.st.poison <= 0) delete e.st.poison;
        if (e.dead) { this.snap(450); continue; }
      }
      this.execute(e);
      this.snap(650);
      if (this.enemies().length === 0) break;
    }
    // --- ラウンド終了 ---
    for (const e of this.enemies()) {
      if (e.st.ritual) this.status(e, "str", e.st.ritual);
      for (const k of ["vuln", "weak", "marked"]) if (e.st[k]) { e.st[k]--; if (e.st[k] <= 0) delete e.st[k]; }
    }
    for (const p of this.s.players) delete p.st.taunt;
    this.checkEnd();
    if (this.s.phase !== "battle") return;
    for (const e of this.enemies()) this.plan(e);
    this.beginPlayerTurn(false);
    this.snap(300);
  }

  pickTarget(e) {
    const taunter = this.livingPlayers().find((p) => p.st.taunt);
    if (taunter) return taunter;
    const t = e.tgt !== null ? this.P(e.tgt) : null;
    if (t && !t.dead) return t;
    return this.pick(this.livingPlayers());
  }
  execute(e) {
    const def = ENEMIES[e.id], mv = def.moves[e.move];
    const n = this.s.players.length;
    this.ev("act", e, 0, { move: e.move });
    if (mv.k === "zzz") {
      this.rawBlock(e, 6 * n);
      if (e.wake !== undefined) { e.wake--; if (e.wake <= 0) { delete e.st.sleep; this.ev("note", e, 0, { text: "目を覚ました!" }); } }
    }
    let target = null;
    if (mv.d !== undefined) {
      const hits = mv.h || 1;
      for (let i = 0; i < hits; i++) {
        const targets = mv.all ? this.livingPlayers() : (target = this.pickTarget(e), target ? [target] : []);
        for (const t of targets) {
          if (t.dead) continue;
          this.ev("lunge", e, 0, { tk: "p", ti: t.i });
          this.dealDamage(e, t, this.calcDamage(e, t, mv.d), { attack: true });
        }
      }
    }
    if (mv.b) this.rawBlock(e, mv.b * n);
    if (mv.fx) {
      const t = mv.all ? null : target || this.pickTarget(e);
      if (!mv.all && !t) return;
      mv.fx(this, e, t);
    }
    e.hist.push(e.move);
  }

  checkEnd() {
    const s = this.s;
    if (s.phase !== "battle") return;
    if (s.players.every((p) => p.dead)) { this.gameOver(); return; }
    if (this.enemies().length === 0) { this.winBattle(); return; }
    // 生き残りが全員「ターン終了」済みで、残る1人が倒れた場合など
    const live = this.livingPlayers();
    if (s.battle.phase === "players" && live.length && live.every((q) => q.ended)) this.runEnemyPhase();
  }
  gameOver() {
    this.s.phase = "over"; this.s.result = "lose"; this.s.battle = this.s.battle;
    this.log("全員倒れてしまった…");
  }

  // ---------- 報酬 ----------
  cardPool(p, rarities) {
    const out = [];
    for (const [id, d] of Object.entries(CARDS)) {
      if (!rarities.includes(d.rar)) continue;
      if (d.cls === p.cls || d.cls === "colorless") out.push(id);
    }
    return out;
  }
  randCard(p, rarities) { return this.pick(this.cardPool(p, rarities)); }
  genCardChoices(p, kind) {
    const w = kind === "boss" ? [0, 0, 1] : kind === "elite" ? [0.5, 0.4, 0.1] : [0.6, 0.37, 0.03];
    const picks = [];
    let guard = 0;
    while (picks.length < 3 && guard++ < 50) {
      const r = this.rnd();
      const rar = r < w[0] ? "common" : r < w[0] + w[1] ? "uncommon" : "rare";
      const pool = this.cardPool(p, [rar]);
      if (!pool.length) continue;
      const id = this.pick(pool);
      if (!picks.includes(id)) picks.push(id);
    }
    return picks.map((c) => ({ c, u: 0 }));
  }
  randRelic(p) {
    const pool = Object.keys(RELICS).filter((r) => RELICS[r].rar === "common" && !p.relics.includes(r));
    return pool.length ? this.pick(pool) : "fruit";
  }
  randPotion() { return this.pick(Object.keys(POTIONS)); }
  giveRelic(p, id) {
    p.relics.push(id);
    if (RELICS[id].onPick) RELICS[id].onPick(this, p);
  }
  givePotion(p, id) {
    const i = p.potions.indexOf(null);
    if (i < 0) return false;
    p.potions[i] = id; return true;
  }
  addToDeck(p, id, up = false) { p.deck.push({ c: id, u: up ? 1 : 0, id: this.uid() }); }
  upgradable(c) { return !c.u && CARDS[c.c].type !== "status"; }
  upgradeRandom(p) {
    const l = p.deck.filter((c) => this.upgradable(c));
    if (l.length) this.pick(l).u = 1;
  }

  winBattle() {
    const s = this.s, b = s.battle, kind = b.kind;
    this.log("戦闘に勝利!");
    s.rew = [];
    for (const p of s.players) {
      if (p.dead) { p.dead = false; p.hp = 1; }
      p.block = 0; p.st = {}; p.hand = []; p.draw = []; p.disc = []; p.exh = []; p.energy = 0; p.ended = false;
      for (const r of p.relics) if (RELICS[r].onWin) RELICS[r].onWin(this, p);
      const gold = kind === "boss" ? 80 + this.ri(21) : kind === "elite" ? 25 + this.ri(11) : 12 + this.ri(9);
      p.gold += gold;
      let potion = null;
      if (this.rnd() < 0.4) { const id = this.randPotion(); if (this.givePotion(p, id)) potion = id; }
      let relic = null;
      if (kind === "elite") { relic = this.randRelic(p); this.giveRelic(p, relic); }
      s.rew.push({ gold, potion, relic, cards: this.genCardChoices(p, kind), done: false, took: null });
    }
    s.phase = "reward";
    s.battle = { ...b, over: true };
  }
  pickCard(p, idx) {
    const r = this.s.rew[p.i];
    if (r.done || !r.cards[idx]) return false;
    this.addToDeck(p, r.cards[idx].c, false);
    r.done = true; r.took = r.cards[idx].c;
    this.afterReward();
    return true;
  }
  skipCard(p) {
    const r = this.s.rew[p.i];
    if (r.done) return false;
    r.done = true; r.took = "skip";
    this.afterReward();
    return true;
  }
  afterReward() {
    const s = this.s;
    if (!s.rew.every((r) => r.done)) return;
    s.rew = null;
    const node = s.map.nodes[s.cur];
    if (node && node.type === "B") { s.phase = "over"; s.result = "win"; this.log("塔の頂上を制覇した!"); }
    else this.toMap();
  }
  toMap() { const s = this.s; s.phase = "map"; s.vote = [null, null]; s.battle = null; }

  // ---------- マップ ----------
  options() {
    const s = this.s;
    if (s.cur === null) return s.map.nodes.filter((n) => n.f === 0).map((n) => n.id);
    return s.map.nodes[s.cur].next;
  }
  vote(p, nodeId) {
    const s = this.s;
    if (!this.options().includes(nodeId)) return false;
    s.vote[p.i] = nodeId;
    if (s.vote.every((v) => v !== null)) {
      const chosen = s.vote[0] === s.vote[1] ? s.vote[0] : s.vote[this.ri(2)];
      this.enterNode(s.map.nodes[chosen]);
    }
    return true;
  }
  enterNode(node) {
    const s = this.s;
    s.cur = node.id; s.floor = node.f; s.vote = [null, null];
    let t = node.type;
    if (t === "Q") {
      const r = this.rnd();
      t = r < 0.55 ? "V" : r < 0.8 ? "M" : r < 0.9 ? "S" : "T";
    }
    node.shown = t;
    if (t === "M") this.startBattle(this.pick(node.f < 3 ? ENCOUNTERS.weak : ENCOUNTERS.normal), "normal");
    else if (t === "E") this.startBattle(this.pick(ENCOUNTERS.elite), "elite");
    else if (t === "B") this.startBattle([s.boss], "boss");
    else if (t === "R") { s.phase = "rest"; s.rest = s.players.map(() => ({ done: false, msg: "" })); }
    else if (t === "S") this.openShop();
    else if (t === "T") this.openTreasure();
    else if (t === "V") this.openEvent();
  }

  // ---------- 休憩所 ----------
  restAct(p, a) {
    const r = this.s.rest[p.i];
    if (r.done) return false;
    if (a.mode === "heal") { this.heal(p, Math.ceil(p.maxHp * 0.3)); r.msg = "休息した"; }
    else if (a.mode === "smith") {
      const c = p.deck.find((x) => x.id === a.uid);
      if (!c || !this.upgradable(c)) return false;
      c.u = 1; r.msg = `${CARDS[c.c].name}を強化した`;
    } else if (a.mode === "mend") {
      const o = this.s.players.find((q) => q !== p);
      if (!o) return false;
      this.heal(o, Math.ceil(o.maxHp * 0.3)); r.msg = `${o.name}を治療した`;
    } else return false;
    r.done = true;
    if (this.s.rest.every((x) => x.done)) { this.s.rest = null; this.toMap(); }
    return true;
  }

  // ---------- ショップ ----------
  openShop() {
    const s = this.s;
    s.phase = "shop";
    s.shop = s.players.map((p) => {
      const price = (r) => Math.round({ common: 50, uncommon: 75, rare: 150 }[r] * (0.9 + this.rnd() * 0.2));
      const cards = [];
      const ids = new Set();
      while (cards.length < 5) {
        const r = this.rnd();
        const rar = r < 0.55 ? "common" : r < 0.9 ? "uncommon" : "rare";
        const pool = this.cardPool(p, [rar]);
        const id = this.pick(pool);
        if (ids.has(id)) continue;
        ids.add(id);
        cards.push({ c: id, price: price(rar), sold: false });
      }
      const relics = [];
      const rp = Object.keys(RELICS).filter((r) => RELICS[r].rar === "common" && !p.relics.includes(r));
      this.shuffle(rp);
      for (const r of rp.slice(0, 2)) relics.push({ r, price: 150 + this.ri(80), sold: false });
      const potions = [{ p: this.randPotion(), price: 45 + this.ri(15), sold: false }];
      return { cards, relics, potions, removeCost: SHOP_REMOVE, left: false };
    });
  }
  buy(p, a) {
    const sh = this.s.shop[p.i];
    if (sh.left) return false;
    const list = a.kind === "card" ? sh.cards : a.kind === "relic" ? sh.relics : sh.potions;
    const it = list[a.idx];
    if (!it || it.sold || p.gold < it.price) return false;
    if (a.kind === "potion" && p.potions.indexOf(null) < 0) return false;
    p.gold -= it.price; it.sold = true;
    if (a.kind === "card") this.addToDeck(p, it.c);
    else if (a.kind === "relic") this.giveRelic(p, it.r);
    else this.givePotion(p, it.p);
    return true;
  }
  shopRemove(p, uid) {
    const sh = this.s.shop[p.i];
    if (sh.left || p.gold < sh.removeCost) return false;
    const i = p.deck.findIndex((c) => c.id === uid);
    if (i < 0) return false;
    p.gold -= sh.removeCost; sh.removeCost += 25;
    p.deck.splice(i, 1);
    return true;
  }
  leaveShop(p) {
    const sh = this.s.shop[p.i];
    if (sh.left) return false;
    sh.left = true;
    if (this.s.shop.every((x) => x.left)) { this.s.shop = null; this.toMap(); }
    return true;
  }

  // ---------- 宝箱 ----------
  openTreasure() {
    const s = this.s;
    s.phase = "treasure";
    const pool = this.shuffle(Object.keys(RELICS).filter((r) => RELICS[r].rar === "common"));
    s.treasure = { relics: pool.slice(0, s.players.length + 1), pick: s.players.map(() => null), msg: "" };
  }
  treasurePick(p, idx) {
    const t = this.s.treasure;
    if (t.relics[idx] === undefined || t.pick[p.i] !== null) return false;
    t.pick[p.i] = idx;
    if (t.pick.every((x) => x !== null)) {
      const taken = new Set();
      const order = this.s.players.map((q) => q.i);
      const msgs = [];
      // 被った場合はランダムで勝者を決め、負けた側は残りからランダム
      const final = [null, null];
      if (t.pick[0] === t.pick[1]) {
        const w = this.ri(2);
        final[w] = t.pick[0]; taken.add(t.pick[0]);
        const rest = t.relics.map((_, i) => i).filter((i) => !taken.has(i));
        final[1 - w] = this.pick(rest);
        msgs.push(`${this.P(w).name}がじゃんけんに勝ってレリックを獲得!`);
      } else { final[0] = t.pick[0]; final[1] = t.pick[1]; }
      order.forEach((i) => this.giveRelic(this.P(i), t.relics[final[i]]));
      t.final = final; t.msg = msgs.join(" ");
      this.s.treasure = null;
      this.log(msgs.join(" ") || "宝箱を開けた");
      this.toMap();
    }
    return true;
  }

  // ---------- イベント ----------
  openEvent() {
    const s = this.s;
    s.phase = "event";
    s.event = { id: this.pick(Object.keys(EVENTS)), pick: s.players.map(() => null), msg: s.players.map(() => "") };
  }
  eventPick(p, idx) {
    const ev = this.s.event, def = EVENTS[ev.id];
    const ch = def.choices[idx];
    if (!ch || ev.pick[p.i] !== null) return false;
    if (ch.req && !ch.req(p)) return false;
    ev.pick[p.i] = idx;
    ch.apply(this, p);
    if (ev.pick.every((x) => x !== null)) { this.s.event = null; this.toMap(); }
    return true;
  }
}
