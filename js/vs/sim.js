// マリオVSルイージ方式の2D対戦アクション: 決定論シミュレーション(DOM非依存)。
// 両端末が同じ初期状態・同じ入力列から同じ結果を計算する(ロックステップ)。
// 注意: 乱数は seed 付き PRNG のみ、Math.sin 等の超越関数は使わない。
import { TILE, ROWS, SOLID, makeStage } from "./stages.js";

export const BTN = { L: 1, R: 2, J: 4, RUN: 8, D: 16 };
const T = TILE;

// ---- 調整値(px/フレーム, 60fps) ----
const WALK = 1.2, RUNSPD = 2.0;
const ACC = 0.08, FRIC = 0.10, AIRACC = 0.06, ICE_ACC = 0.025, ICE_FRIC = 0.012;
const G_UP = 0.2, G_DOWN = 0.4, MAXFALL = 5.5;
const STAR_RESPAWN = 600;      // 10秒
const COIN_BONUS = 8;
const STUN = 24, INV_AFTER_STUN = 60, INV_RESPAWN = 120;
const DUR = { star: 600, mega: 1200, mini: 900 };

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const mod = (a, n) => ((a % n) + n) % n;
const approach = (v, t, a) => (v < t ? Math.min(v + a, t) : Math.max(v - a, t));
const ITEM_TYPES = ["mushroom", "flower", "shell", "mini", "star", "mega"];

export class Sim {
  constructor(stageId, opts) {
    this.stage = makeStage(stageId);
    this.cols = this.stage.cols;
    this.W = this.cols * T;
    this.H = ROWS * T;
    this.wrap = this.stage.wrap;
    this.target = opts.stars;
    this.rand = mulberry32(opts.seed);
    this.t = 0;
    this.over = null;
    this.overT = 0;
    this.fx = [];
    this.fxSeq = 0;
    this.fieldStar = null;
    this.starTimer = 0;
    this.lastSpawn = -1;
    this.items = [];
    this.stars = [];
    this.players = [this.makePlayer(0, opts.lives), this.makePlayer(1, opts.lives)];
    this.resetLevel();
    this.spawnFieldStar();
  }

  // ---------- 基本ユーティリティ ----------
  emit(k, x, y, extra) {
    this.fx.push({ id: this.fxSeq++, k, x, y, t: this.t, ...extra });
    if (this.fx.length > 300) this.fx.splice(0, this.fx.length - 300);
  }
  tileAt(tx, ty) {
    if (ty < 0 || ty >= ROWS) return ".";
    if (this.wrap) tx = mod(tx, this.cols);
    else if (tx < 0 || tx >= this.cols) return "#";
    return this.tiles[ty][tx];
  }
  setTile(tx, ty, ch) {
    if (ty < 0 || ty >= ROWS) return;
    if (this.wrap) tx = mod(tx, this.cols);
    else if (tx < 0 || tx >= this.cols) return;
    this.tiles[ty][tx] = ch;
  }
  wdx(ax, bx) {
    const d = bx - ax;
    return this.wrap ? mod(d + this.W / 2, this.W) - this.W / 2 : d;
  }
  overlap(a, b) {
    const dx = this.wdx(a.x, b.x);
    return dx < a.w && dx + b.w > 0 && a.y < b.y + b.h && a.y + a.h > b.y;
  }
  normX(e) {
    if (!this.wrap) return;
    if (e.x < 0) e.x += this.W; else if (e.x >= this.W) e.x -= this.W;
  }
  cx(e) { return e.x + e.w / 2; }

  makePlayer(id, lives) {
    return {
      id, x: 0, y: 0, w: 12, h: 14, vx: 0, vy: 0, face: id === 0 ? 1 : -1, ground: false,
      form: "small", mini: 0, star: 0, mega: 0, shell: false, spin: false,
      stars: 0, coins: 0, lives: lives, out: false,
      stun: 0, inv: 0, dead: 0, pound: 0, poundFall: false, wallDir: 0, wallGrace: 0,
      contactCd: 0, fireCd: 0, prev: 0, anim: 0,
    };
  }
  placeAtSpawn(p) {
    const sp = this.stage.spawns[p.id];
    p.w = 12; p.h = 14; p.x = sp.x * T + 2; p.y = (sp.y + 1) * T - p.h;
    p.vx = 0; p.vy = 0; p.ground = false;
    p.face = p.id === 0 ? 1 : -1;
  }

  resetLevel() {
    this.tiles = this.stage.grid.map((r) => r.slice());
    this.enemies = [];
    this.fire = [];
    for (const g of this.stage.goombas) this.enemies.push(this.mkEnemy("goomba", g.x, g.y));
    for (const k of this.stage.koopas) this.enemies.push(this.mkEnemy("koopa", k.x, k.y));
    // 初回のみプレイヤーを配置
    if (this.t === 0) for (const p of this.players) this.placeAtSpawn(p);
  }
  mkEnemy(kind, tx, ty) {
    const w = 12, h = kind === "koopa" ? 16 : 12;
    return { k: kind, x: tx * T + (T - w) / 2, y: (ty + 1) * T - h, w, h, vx: -0.4, vy: 0, dead: 0, owner: -1, kickCd: 0, ground: false };
  }

  spawnFieldStar() {
    const sp = this.stage.starSpawns;
    let i = Math.floor(this.rand() * sp.length);
    if (i === this.lastSpawn) i = (i + 1) % sp.length;
    this.lastSpawn = i;
    const s = { x: sp[i].x * T + 1, y: sp[i].y * T + 1, w: 14, h: 14, vx: 0, vy: 0, field: true, life: -1, nopick: [0, 0] };
    this.stars.push(s);
    this.fieldStar = s;
    this.emit("starspawn", s.x, s.y);
  }

  // ---------- タイル衝突 ----------
  solidFor(tx, ty, pl) {
    const t = this.tileAt(tx, ty);
    if (!SOLID.has(t)) return false;
    if (pl && pl.mega > 0 && (t === "B" || t === "?" || t === "Q" || t === "U")) {
      this.breakBlock(tx, ty);
      return false;
    }
    return true;
  }
  overlapsSolid(x, y, w, h, pl) {
    const x0 = Math.floor(x / T), x1 = Math.floor((x + w - 0.001) / T);
    const y0 = Math.floor(y / T), y1 = Math.floor((y + h - 0.001) / T);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
      const t = this.tileAt(tx, ty);
      if (!SOLID.has(t)) continue;
      if (pl && pl.mega > 0 && (t === "B" || t === "?" || t === "Q" || t === "U")) continue;
      return true;
    }
    return false;
  }
  moveX(e, dx, pl) {
    e.x += dx;
    if (dx === 0) return 0;
    const y0 = Math.floor(e.y / T), y1 = Math.floor((e.y + e.h - 0.001) / T);
    if (dx > 0) {
      const tx = Math.floor((e.x + e.w - 0.001) / T);
      for (let ty = y0; ty <= y1; ty++) if (this.solidFor(tx, ty, pl)) { e.x = tx * T - e.w; return 1; }
    } else {
      const tx = Math.floor(e.x / T);
      for (let ty = y0; ty <= y1; ty++) if (this.solidFor(tx, ty, pl)) { e.x = (tx + 1) * T; return -1; }
    }
    return 0;
  }
  // 戻り値: 1=床に着地 / -1=天井に衝突(this.bumpTile に対象) / 0=なし
  moveY(e, dy, pl) {
    e.y += dy;
    if (dy === 0) return 0;
    const x0 = Math.floor(e.x / T), x1 = Math.floor((e.x + e.w - 0.001) / T);
    if (dy > 0) {
      const ty = Math.floor((e.y + e.h - 0.001) / T);
      let hit = false;
      for (let tx = x0; tx <= x1; tx++) {
        if (!this.solidFor(tx, ty, pl)) continue;
        if (pl && pl.poundFall && pl.form !== "small" && this.tileAt(tx, ty) === "B") { this.breakBlock(tx, ty); continue; }
        hit = true;
      }
      if (hit) { e.y = ty * T - e.h; return 1; }
    } else {
      const ty = Math.floor(e.y / T);
      let best = null, bestOv = 0;
      for (let tx = x0; tx <= x1; tx++) {
        if (!this.solidFor(tx, ty, pl)) continue;
        const ov = Math.min(e.x + e.w, (tx + 1) * T) - Math.max(e.x, tx * T);
        if (ov > bestOv) { bestOv = ov; best = tx; }
      }
      if (best !== null) { e.y = (ty + 1) * T; this.bumpTile = { tx: best, ty }; return -1; }
    }
    return 0;
  }

  breakBlock(tx, ty) {
    this.setTile(tx, ty, ".");
    this.emit("brick", mod(tx, this.cols) * T, ty * T);
  }

  // ---------- プレイヤーサイズ ----------
  sizeOf(p) {
    if (p.mega > 0) return [30, 44];
    if (p.mini > 0) return [6, 7];
    if (p.spin) return [14, 14];
    return p.form === "small" ? [12, 14] : [12, 26];
  }
  applySize(p) {
    const [w, h] = this.sizeOf(p);
    if (w === p.w && h === p.h) return;
    const nx = p.x + p.w / 2 - w / 2, ny = p.y + p.h - h;
    if (!this.overlapsSolid(nx, ny, w, h, p)) { p.x = nx; p.y = ny; p.w = w; p.h = h; this.normX(p); }
  }

  // ---------- 入力→プレイヤー ----------
  updatePlayer(p, bits) {
    const L = bits & 1, R = bits & 2, J = bits & 4, RN = bits & 8, D = bits & 16;
    const jp = J && !(p.prev & 4), rp = RN && !(p.prev & 8), dp = D && !(p.prev & 16);
    p.prev = bits;
    if (p.out) return;
    if (p.dead > 0) {
      p.dead--;
      if (p.dead === 0) this.respawn(p);
      return;
    }
    if (p.inv > 0) p.inv--;
    if (p.contactCd > 0) p.contactCd--;
    if (p.fireCd > 0) p.fireCd--;
    if (p.star > 0) p.star--;
    if (p.mega > 0) p.mega--;
    if (p.mini > 0) p.mini--;
    if (p.stun > 0) { p.stun--; if (p.stun === 0) p.inv = INV_AFTER_STUN; }
    const stunned = p.stun > 0;

    p.spin = p.shell && !!RN && Math.abs(p.vx) >= 1.8 && !stunned && p.mega === 0;
    this.applySize(p);

    const onIce = p.ground && this.tileAt(Math.floor((p.x + p.w / 2) / T), Math.floor((p.y + p.h + 1) / T)) === "I";
    const dir = (R ? 1 : 0) - (L ? 1 : 0);

    // 横移動
    if (!stunned && p.pound === 0 && !p.poundFall) {
      const maxV = (RN ? RUNSPD : WALK) * (p.mega > 0 ? 0.9 : 1);
      const acc = p.ground ? (onIce ? ICE_ACC : ACC) : AIRACC;
      let fric = p.ground ? (onIce ? ICE_FRIC : FRIC) : 0.01;
      if (p.spin) fric = 0.015;
      if (dir !== 0) {
        p.face = dir;
        let a = acc;
        if (p.vx * dir < 0) a = acc * (onIce ? 1.5 : 2.2);
        else if (Math.abs(p.vx) > maxV) a = fric;
        p.vx = approach(p.vx, dir * maxV, a);
      } else {
        p.vx = approach(p.vx, 0, fric);
      }
    } else if (stunned) {
      p.vx = approach(p.vx, 0, 0.03);
    }

    // ジャンプ・壁キック
    if (!stunned && jp) {
      if (p.ground) {
        p.vy = -(5.0 + Math.abs(p.vx) * 0.15); p.ground = false; this.emit("jump", p.x, p.y, { who: p.id });
      } else if (p.wallDir !== 0 && p.wallGrace > 0 && p.pound === 0 && !p.poundFall) {
        p.vy = -4.8; p.vx = -p.wallDir * 2.0; p.face = -p.wallDir; p.wallGrace = 0; p.wallDir = 0;
        this.emit("jump", p.x, p.y, { who: p.id });
      }
    }

    // ヒップドロップ(空中で↓を押す)
    if (!stunned && !p.ground && dp && p.pound === 0 && !p.poundFall) {
      p.pound = 10; p.vx = 0; p.vy = 0; this.emit("poundstart", p.x, p.y, { who: p.id });
    }
    // ファイアボール
    if (!stunned && rp && p.form === "fire" && p.mini === 0 && p.mega === 0 && !p.spin && p.fireCd === 0 &&
        this.fire.filter((f) => f.owner === p.id).length < 2) {
      this.fire.push({ x: p.x + (p.face > 0 ? p.w : -6), y: p.y + 8, w: 6, h: 6, vx: 3.4 * p.face, vy: 0, owner: p.id, life: 240 });
      p.fireCd = 8; this.emit("fire", p.x, p.y, { who: p.id });
    }

    // 重力
    if (p.pound > 0) {
      p.pound--; p.vy = 0; p.vx = 0;
      if (p.pound === 0) { p.poundFall = true; p.vy = 7; }
    } else if (p.poundFall) {
      p.vy = 7; p.vx = 0;
    } else {
      const floaty = p.mini > 0 ? 0.65 : 1;
      const g = (p.vy < 0 && J && !stunned ? G_UP : G_DOWN) * floaty;
      p.vy = Math.min(p.mini > 0 ? 3.5 : MAXFALL, p.vy + g);
      if (!p.ground && p.wallGrace > 0 && p.wallDir !== 0 && p.vy > 1.0) p.vy = 1.0;
    }

    // 移動と衝突
    const hx = this.moveX(p, p.vx, p);
    if (hx !== 0) {
      if (p.spin) { p.vx = -p.vx * 0.9; p.face = -p.face; this.emit("bump", p.x, p.y); }
      else {
        if (!p.ground && ((hx > 0 && R) || (hx < 0 && L))) { p.wallDir = hx; p.wallGrace = 6; }
        p.vx = 0;
      }
    }
    this.bumpTile = null;
    const hy = this.moveY(p, p.vy, p);
    if (hy > 0) {
      p.ground = true; p.vy = 0;
      if (p.poundFall) { p.poundFall = false; this.emit("pound", p.x + p.w / 2, p.y + p.h, { who: p.id }); }
      p.wallDir = 0; p.wallGrace = 0;
    } else {
      p.ground = false;
      if (hy < 0) {
        p.vy = 0;
        if (p.mini === 0 && this.bumpTile) this.bumpBlock(p, this.bumpTile.tx, this.bumpTile.ty);
      }
    }
    if (p.wallGrace > 0) { p.wallGrace--; if (p.wallGrace === 0) p.wallDir = 0; }
    this.normX(p);
    p.anim += Math.abs(p.vx) + 0.2;

    // コイン
    const cx0 = Math.floor(p.x / T), cx1 = Math.floor((p.x + p.w - 0.001) / T);
    const cy0 = Math.floor(p.y / T), cy1 = Math.floor((p.y + p.h - 0.001) / T);
    for (let ty = cy0; ty <= cy1; ty++) for (let tx = cx0; tx <= cx1; tx++) {
      if (this.tileAt(tx, ty) === "o") { this.setTile(tx, ty, "."); this.addCoins(p, 1, mod(tx, this.cols) * T, ty * T); }
    }
    // 落下死
    if (p.y > this.H + 24) this.kill(p, "pit");
  }

  addCoins(p, n, x, y) {
    p.coins += n;
    this.emit("coin", x, y, { who: p.id });
    if (p.coins >= COIN_BONUS) {
      p.coins -= COIN_BONUS;
      const type = ITEM_TYPES[Math.floor(this.rand() * ITEM_TYPES.length)];
      const ox = (this.rand() - 0.5) * 40;
      this.items.push(this.mkItem(type, this.cx(p) - 7 + ox, -14, 0));
      this.emit("bonus", this.cx(p), 0, { who: p.id });
    }
  }
  mkItem(type, x, y, emerge) {
    const vx = { mushroom: 0.8, flower: 0, shell: 0.9, mini: 0.7, star: 1.2, mega: 0.7 }[type];
    return { k: type, x, y, w: 14, h: 14, vx, vy: 0, emerge, age: 0 };
  }

  // ---------- ブロック ----------
  bumpBlock(p, tx, ty) {
    const t = this.tileAt(tx, ty);
    const X = mod(tx, this.cols) * T, Y = ty * T;
    if (t === "?") {
      this.setTile(tx, ty, "U");
      const type = p.form === "small" ? "mushroom" : "flower";
      this.items.push(this.mkItem(type, X + 1, Y, 16));
      this.emit("block", X, Y, { tx: mod(tx, this.cols), ty });
    } else if (t === "Q") {
      this.setTile(tx, ty, "U");
      this.addCoins(p, 1, X, Y - T);
      this.emit("block", X, Y, { tx: mod(tx, this.cols), ty });
    } else if (t === "B" && p.form !== "small") {
      this.breakBlock(tx, ty);
    } else {
      this.emit("bump", X, Y, { tx: mod(tx, this.cols), ty });
    }
    // ブロックの上に乗っているものへ衝撃
    const tileRect = { x: X, y: Y - 3, w: T, h: 3 };
    for (const e of this.enemies) {
      if (e.dead) continue;
      if (this.overlap(tileRect, { x: e.x, y: e.y + e.h - 1, w: e.w, h: 2 })) this.stompEnemy(e, p, true);
    }
    const o = this.players[1 - p.id];
    if (!o.out && o.dead === 0 && Math.abs(o.y + o.h - Y) <= 2 && this.overlap(tileRect, { x: o.x, y: o.y + o.h - 1, w: o.w, h: 2 })) {
      this.hurt(o, "block", X + T / 2);
    }
  }

  // ---------- ダメージ ----------
  loseStars(p, n) {
    n = Math.min(n, p.stars);
    if (n <= 0) return;
    p.stars -= n;
    for (let i = 0; i < n; i++) {
      this.stars.push({
        x: this.cx(p) - 7, y: p.y + p.h / 2 - 7, w: 14, h: 14,
        vx: (this.rand() - 0.5) * 3.2, vy: -3 - this.rand() * 2, field: false, life: 480,
        nopick: [p.id === 0 ? 50 : 0, p.id === 1 ? 50 : 0],
      });
    }
    this.emit("starlost", this.cx(p), p.y, { who: p.id, n });
  }
  // kind: stomp/pound/power/enemy/fire/block/contact。返り値: ダメージが通ったか
  hurt(p, kind, srcX, opts = {}) {
    if (p.out || p.dead > 0 || p.inv > 0 || p.stun > 0 || p.mega > 0) return false;
    if (p.star > 0 && !opts.mega) return false;
    this.loseStars(p, kind === "pound" ? 3 : 1);
    const shrink = kind === "power" || kind === "enemy" || kind === "fire";
    let fatal = false;
    if (shrink) {
      if (p.mini > 0) fatal = true;
      else if (p.shell) p.shell = false;
      else if (p.form === "fire") p.form = "big";
      else if (p.form === "big") p.form = "small";
      else fatal = true;
    }
    this.emit("hurt", this.cx(p), p.y, { who: p.id, kind });
    if (fatal) { this.kill(p, kind); return true; }
    const dir = this.wdx(srcX, this.cx(p)) >= 0 ? 1 : -1;
    p.vx = dir * 2.2; p.vy = -3; p.stun = kind === "contact" ? 16 : STUN;
    p.ground = false; p.pound = 0; p.poundFall = false;
    return true;
  }
  kill(p, reason) {
    if (p.dead > 0 || p.out) return;
    this.emit("die", this.cx(p), p.y, { who: p.id, reason });
    if (p.lives > 0) p.lives--;
    p.vx = 0; p.vy = 0; p.stun = 0; p.pound = 0; p.poundFall = false;
    if (p.lives === 0) { p.out = true; p.dead = 1 << 20; } else p.dead = 90;
  }
  respawn(p) {
    p.form = "small"; p.mini = 0; p.star = 0; p.mega = 0; p.shell = false; p.spin = false;
    p.stun = 0; p.inv = INV_RESPAWN; p.pound = 0; p.poundFall = false; p.wallDir = 0;
    this.placeAtSpawn(p);
    this.emit("respawn", p.x, p.y, { who: p.id });
  }

  // ---------- 敵 ----------
  stompEnemy(e, p, byBlock) {
    if (e.k === "goomba") { e.dead = 20; e.vx = 0; }
    else if (e.k === "koopa") { e.k = "shell"; e.h = 12; e.y += 4; e.vx = 0; e.owner = -1; e.kickCd = 20; }
    else if (e.k === "shell") { e.vx = 0; e.kickCd = 20; }
    this.emit("stomp", e.x, e.y, { who: p.id });
    if (byBlock && e.k === "shell") e.vy = -3;
  }
  killEnemy(e, p) {
    e.dead = e.k === "goomba" ? 20 : 1;
    e.vx = 0;
    if (e.k !== "goomba") e.remove = true;
    this.emit("stomp", e.x, e.y, { who: p ? p.id : -1 });
  }

  updateEnemies() {
    for (const e of this.enemies) {
      if (e.dead) { e.dead--; if (e.dead <= 0) e.remove = true; continue; }
      if (e.kickCd > 0) e.kickCd--;
      e.vy = Math.min(5, e.vy + 0.3);
      const hx = this.moveX(e, e.vx, null);
      if (hx) { e.vx = -e.vx; if (e.k === "shell" && e.vx !== 0) this.emit("bump", e.x, e.y); }
      const hy = this.moveY(e, e.vy, null);
      if (hy > 0) { e.vy = 0; e.ground = true; } else e.ground = false;
      this.normX(e);
      if (e.y > this.H + 40) e.remove = true;
    }
    // 動くコウラは他の敵を倒す
    for (const s of this.enemies) {
      if (s.k !== "shell" || s.vx === 0 || s.dead) continue;
      for (const o of this.enemies) {
        if (o === s || o.dead || o.remove) continue;
        if (this.overlap(s, o)) this.killEnemy(o, s.owner >= 0 ? this.players[s.owner] : null);
      }
    }
    this.enemies = this.enemies.filter((e) => !e.remove);
  }

  interactEnemies() {
    for (const p of this.players) {
      if (p.out || p.dead > 0) continue;
      for (const e of this.enemies) {
        if (e.dead || e.remove || !this.overlap(p, e)) continue;
        const power = p.mega > 0 || p.star > 0 || p.spin;
        const stomping = p.vy > 0 && p.y + p.h - e.y <= 10;
        if (e.k === "shell") {
          if (e.vx === 0) {
            if (e.kickCd > 0) continue;
            // 止まっているコウラは蹴る
            e.vx = (this.wdx(this.cx(p), this.cx(e)) >= 0 ? 1 : -1) * 3.5;
            e.owner = p.id; e.kickCd = 24;
            if (stomping) { p.vy = -3; }
            this.emit("kick", e.x, e.y, { who: p.id });
          } else if (power) {
            e.remove = true; this.emit("stomp", e.x, e.y, { who: p.id });
          } else if (stomping) {
            e.vx = 0; e.kickCd = 20; p.vy = (p.prev & 4) ? -4.8 : -3.5; this.emit("stomp", e.x, e.y, { who: p.id });
          } else if (!(e.owner === p.id && e.kickCd > 0)) {
            this.hurt(p, "power", this.cx(e));
          }
          continue;
        }
        if (power) { this.killEnemy(e, p); continue; }
        if (stomping || p.poundFall) {
          this.stompEnemy(e, p, false);
          p.poundFall = false;
          p.vy = (p.prev & 4) ? -4.8 : -3.5;
          continue;
        }
        this.hurt(p, "enemy", this.cx(e));
      }
    }
  }

  // ---------- ファイアボール ----------
  updateFire() {
    for (const f of this.fire) {
      f.life--;
      f.vy = Math.min(4, f.vy + 0.25);
      if (this.moveX(f, f.vx, null)) f.life = 0;
      const hy = this.moveY(f, f.vy, null);
      if (hy > 0) f.vy = -2.8; else if (hy < 0) f.life = 0;
      this.normX(f);
      if (f.y > this.H + 20) f.life = 0;
    }
    this.fire = this.fire.filter((f) => f.life > 0);
  }
  interactFire() {
    for (const f of this.fire) {
      for (const e of this.enemies) {
        if (e.dead || e.k === "shell" || !this.overlap(f, e)) continue;
        this.killEnemy(e, this.players[f.owner]);
        this.addCoins(this.players[f.owner], 1, e.x, e.y);
        f.life = 0;
        break;
      }
      if (f.life <= 0) continue;
      const o = this.players[1 - f.owner];
      if (!o.out && o.dead === 0 && this.overlap(f, o)) {
        f.life = 0;
        this.hurt(o, "fire", f.x);
      }
    }
  }

  // ---------- アイテム ----------
  updateItems() {
    for (const it of this.items) {
      it.age++;
      if (it.emerge > 0) { it.emerge--; it.y -= 1; continue; }
      it.vy = Math.min(4, it.vy + 0.3);
      if (this.moveX(it, it.vx, null)) it.vx = -it.vx;
      const hy = this.moveY(it, it.vy, null);
      if (hy > 0) it.vy = it.k === "star" ? -3.8 : 0;
      this.normX(it);
      if (it.y > this.H + 30 || it.age > 1500) it.remove = true;
    }
    this.items = this.items.filter((i) => !i.remove);
  }
  interactItems() {
    for (const it of this.items) {
      if (it.emerge > 0 || it.remove) continue;
      for (const p of this.players) {
        if (p.out || p.dead > 0 || !this.overlap(p, it)) continue;
        this.applyItem(p, it.k);
        it.remove = true;
        break;
      }
    }
  }
  applyItem(p, k) {
    if (k === "mushroom") { if (p.form === "small") p.form = "big"; }
    else if (k === "flower") p.form = "fire";
    else if (k === "shell") p.shell = true;
    else if (k === "mini") { p.mini = DUR.mini; p.mega = 0; }
    else if (k === "star") p.star = DUR.star;
    else if (k === "mega") { p.mega = DUR.mega; p.mini = 0; }
    this.emit("item", this.cx(p), p.y, { who: p.id, item: k });
  }

  // ---------- ビッグスター ----------
  updateStars() {
    for (const s of this.stars) {
      if (s.nopick[0] > 0) s.nopick[0]--;
      if (s.nopick[1] > 0) s.nopick[1]--;
      if (s.field) continue;
      s.life--;
      s.vy = Math.min(4.5, s.vy + 0.25);
      if (this.moveX(s, s.vx, null)) s.vx = -s.vx;
      const hy = this.moveY(s, s.vy, null);
      if (hy > 0) { s.vy = -3.0; s.vx *= 0.9; } else if (hy < 0) s.vy = 0;
      this.normX(s);
      if (s.y > this.H + 30) s.life = 0;
    }
    this.stars = this.stars.filter((s) => s.field || s.life > 0);
  }
  interactStars() {
    for (const s of this.stars) {
      if (s.taken) continue;
      for (const p of this.players) {
        if (p.out || p.dead > 0 || s.nopick[p.id] > 0 || !this.overlap(p, s)) continue;
        s.taken = true;
        p.stars++;
        this.emit("star", this.cx(p), p.y, { who: p.id });
        if (s.field) {
          this.fieldStar = null;
          this.starTimer = STAR_RESPAWN;
          this.resetLevel();
        }
        if (p.stars >= this.target && !this.over) this.over = { winner: p.id, reason: "stars" };
        break;
      }
    }
    this.stars = this.stars.filter((s) => !s.taken);
  }

  // ---------- プレイヤー同士 ----------
  powerOf(p) { return p.mega > 0 ? 3 : p.star > 0 ? 2 : p.spin ? 1 : 0; }
  interactPlayers() {
    const a = this.players[0], b = this.players[1];
    if (a.out || b.out || a.dead > 0 || b.dead > 0) return;
    if (!this.overlap(a, b)) return;
    const pa = this.powerOf(a), pb = this.powerOf(b);
    if (pa || pb) {
      if (pa > pb) this.hurt(b, "power", this.cx(a), { mega: a.mega > 0 });
      else if (pb > pa) this.hurt(a, "power", this.cx(b), { mega: b.mega > 0 });
      else if (a.contactCd === 0) {
        const d = this.wdx(this.cx(a), this.cx(b)) >= 0 ? 1 : -1;
        a.vx = -d * 2; b.vx = d * 2; a.contactCd = b.contactCd = 20;
        this.emit("bump", this.cx(a), a.y);
      }
      return;
    }
    const aTop = a.vy > 0 && a.y + a.h - b.y <= 10 + a.vy && a.y < b.y;
    const bTop = b.vy > 0 && b.y + b.h - a.y <= 10 + b.vy && b.y < a.y;
    if (aTop && !bTop) return this.stomp(a, b);
    if (bTop && !aTop) return this.stomp(b, a);
    const running = (p) => (p.prev & 8) && Math.abs(p.vx) >= 1.5;
    if (a.contactCd === 0 && b.contactCd === 0 && (running(a) || running(b)) && a.mini === 0 && b.mini === 0) {
      const ha = this.hurt(a, "contact", this.cx(b));
      const hb = this.hurt(b, "contact", this.cx(a));
      if (ha || hb) { a.contactCd = b.contactCd = 30; this.emit("bump", this.cx(a), a.y); }
    }
  }
  stomp(top, under) {
    const pound = top.poundFall;
    top.poundFall = false;
    top.vy = (top.prev & 4) ? -4.8 : -3.5;
    if (top.mini > 0 && !pound) return; // ミニは踏みつけダメージなし(ヒップドロップのみ)
    if (this.hurt(under, pound ? "pound" : "stomp", this.cx(top))) {
      this.emit(pound ? "pound" : "stomp", this.cx(under), under.y, { who: top.id });
    }
  }

  // ---------- 1フレーム ----------
  step(inputs) {
    if (this.over) { this.overT++; inputs = [0, 0]; }
    if (!this.fieldStar && !this.over && this.starTimer > 0) {
      this.starTimer--;
      if (this.starTimer === 0) this.spawnFieldStar();
    }
    this.updatePlayer(this.players[0], inputs[0] | 0);
    this.updatePlayer(this.players[1], inputs[1] | 0);
    this.updateFire();
    this.updateEnemies();
    this.updateItems();
    this.updateStars();
    this.interactEnemies();
    this.interactFire();
    this.interactItems();
    this.interactStars();
    this.interactPlayers();
    if (!this.over) {
      const [a, b] = this.players;
      if (a.out && b.out) this.over = { winner: -1, reason: "lives" };
      else if (a.out) this.over = { winner: 1, reason: "lives" };
      else if (b.out) this.over = { winner: 0, reason: "lives" };
    }
    this.t++;
  }

  hash() {
    let h = this.t | 0;
    const mix = (v) => { h = (Math.imul(h, 31) + (v | 0)) | 0; };
    for (const p of this.players) {
      mix(Math.round(p.x * 8)); mix(Math.round(p.y * 8)); mix(p.stars); mix(p.coins); mix(p.lives);
      mix(p.stun); mix(p.inv); mix(p.star); mix(p.mega); mix(p.mini);
    }
    mix(this.enemies.length); mix(this.items.length); mix(this.stars.length); mix(this.starTimer);
    for (const s of this.stars) { mix(Math.round(s.x * 8)); mix(Math.round(s.y * 8)); }
    return h >>> 0;
  }
}
