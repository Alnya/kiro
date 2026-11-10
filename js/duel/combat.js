// ボス一騎討ちの戦闘ロジック(描画・DOM・Three.js 非依存)。
// 座標は (x,z) メートル、向き yaw は forward=(sin yaw, cos yaw)。Three.js の rotation.y と同じ向き。
//
// 戦闘の基本(SEKIROライク):
//  - 体力(HP)と体幹がある。体幹が満タンになると「体幹崩し」で無防備になり、致命の一撃が入る。
//  - 敵の攻撃に合わせてジャスト防御するとパリィ(弾き)。敵の体幹が大きく削れる。
//  - 通常の防御でも防げるが体幹が溜まる。「危」マークの攻撃は防御・パリィ不可、回避する。

export const TUNE = {
  arena: 13.5,
  playerHp: 100, playerPosture: 100, playerSpeed: 4.6, guardSpeed: 2.0, playerRadius: 0.45, bossRadius: 0.95, minDist: 1.5,
  parryWindow: 0.22, parryWindowSpam: 0.11, spamGap: 0.35,
  dodgeTime: 0.52, dodgeIFrom: 0.04, dodgeITo: 0.34, dodgeSpeed: 9.5,
  healTime: 0.95, healAmount: 45, gourds: 3,
  bossBarHp: 240, bossBars: 2, bossPosture: 100, bossStunTime: 4.0, bossKneelTime: 5.5,
  playerReach: 2.9,
};

// プレイヤーの攻撃(三段): w=当たり判定が出る時刻 T=全体の長さ
export const P_ATTACKS = [
  { w: 0.15, T: 0.50, dmg: 12, post: 8, lunge: 0.9 },
  { w: 0.13, T: 0.48, dmg: 12, post: 8, lunge: 0.9 },
  { w: 0.22, T: 0.78, dmg: 20, post: 14, lunge: 1.3 },
];

// ボスの攻撃。hits[].t は攻撃開始からの秒、post=パリィ/防御で溜まる体幹
export const B_ATTACKS = {
  slash: { name: "横薙ぎ", perilous: null, dur: 1.2, rec: 0.55, lockT: 0.32, hits: [{ t: 0.58, dmg: 14, post: 22, reach: 3.9, arc: 150 }], step: [0.30, 0.58, 1.3] },
  combo2: { name: "二連斬", perilous: null, dur: 1.7, rec: 0.65, lockT: 0.30, hits: [{ t: 0.52, dmg: 12, post: 18, reach: 3.9, arc: 150 }, { t: 1.0, dmg: 14, post: 20, reach: 3.9, arc: 150 }], step: [0.28, 0.52, 1.0] },
  combo3: { name: "三連斬", perilous: null, dur: 2.3, rec: 0.7, lockT: 0.30, hits: [{ t: 0.48, dmg: 11, post: 16, reach: 3.9, arc: 150 }, { t: 0.92, dmg: 12, post: 16, reach: 3.9, arc: 150 }, { t: 1.55, dmg: 20, post: 30, reach: 4.2, arc: 140 }], step: [0.25, 0.48, 1.0] },
  overhead: { name: "唐竹割り", perilous: null, dur: 1.9, rec: 0.85, lockT: 0.55, hits: [{ t: 1.0, dmg: 24, post: 36, reach: 3.7, arc: 100 }], step: [0.55, 1.0, 1.2] },
  thrust: { name: "突き", perilous: "thrust", dur: 1.8, rec: 0.9, lockT: 0.62, tell: [0.3, 0.95], hits: [{ t: 0.95, dmg: 36, post: 30, reach: 6.3, arc: 36 }], step: [0.65, 0.95, 4.8] },
  sweep: { name: "足払い", perilous: "sweep", dur: 1.9, rec: 0.9, lockT: 0.9, tell: [0.3, 0.9], hits: [{ t: 0.9, dmg: 32, post: 30, reach: 4.8, arc: 360 }] },
  leap: { name: "飛びかかり", perilous: null, dur: 1.9, rec: 0.75, lockT: 0.4, leap: [0.4, 1.0], hits: [{ t: 1.05, dmg: 18, post: 28, reach: 3.9, arc: 130 }] },
  grab: { name: "掴み", perilous: "grab", dur: 2.0, rec: 1.0, lockT: 0.7, tell: [0.3, 0.85], hits: [{ t: 0.85, dmg: 40, post: 30, reach: 3.2, arc: 80 }], step: [0.55, 0.85, 2.6] },
};

const rad = (d) => (d * Math.PI) / 180;
const angTo = (dx, dz) => Math.atan2(dx, dz);
const angDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const approach = (v, t, a) => (v < t ? Math.min(v + a, t) : Math.max(v - a, t));

export function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Duel {
  constructor(seed = 1) {
    this.rng = mulberry(seed);
    this.t = 0; this.ev = []; this.over = null;
    this.stats = { parries: 0, deaths: 0, blocks: 0, dodges: 0 };
    this.p = {
      x: 0, z: 7.5, yaw: Math.PI, vx: 0, vz: 0, hp: TUNE.playerHp, posture: 0, state: "idle", st: 0, combo: 0, queued: false, hitDone: false,
      guardHeld: false, parryEnd: -1, guardUpAt: -9, invuln: 0, gourds: TUNE.gourds, lastPost: -9, dodgeDx: 0, dodgeDz: 1, revived: false, dead: false,
      healDone: false, lastActive: 0, dbT: 0,
    };
    this.b = {
      x: 0, z: -3.5, yaw: 0, hp: TUNE.bossBarHp, posture: 0, bars: TUNE.bossBars, phase: 1, state: "idle", st: 0, atk: null, atkName: null, atkClock: 0,
      hitIdx: 0, think: 1.6, lastPost: -9, strafe: 1, guardCd: 0, hist: [], perilFired: false, leapFrom: null, leapTo: null, moveAmt: 0, counter: false,
      speed: 1, spin: 0,
    };
  }

  emit(k, o) { this.ev.push({ k, t: this.t, ...o }); }
  get bossDist() { return Math.hypot(this.p.x - this.b.x, this.p.z - this.b.z); }

  // ================= 入力つき更新 =================
  // inp: { mx, mz (相手方向を前とした移動入力 -1..1), attack(押した瞬間), guard(押している), guardEdge, dodge, heal }
  update(dt, inp) {
    this.t += dt;
    if (!this.over) this.stats.time = (this.stats.time || 0) + dt;
    this.updatePlayer(dt, inp || {});
    this.updateBoss(dt);
    this.separate();
    return this.ev.splice(0);
  }

  // ================= プレイヤー =================
  updatePlayer(dt, inp) {
    const p = this.p, b = this.b;
    p.st += dt;
    if (p.invuln > 0) p.invuln -= dt;
    // 体幹の回復
    if (!p.dead && this.t - p.lastPost > 1.0 && p.state !== "stun") p.posture = Math.max(0, p.posture - (p.state === "guard" ? 8 : 15) * dt);
    if (p.dead) { p.vx = p.vz = 0; return; }

    const toB = angTo(b.x - p.x, b.z - p.z);
    const fx = Math.sin(toB), fz = Math.cos(toB);   // プレイヤー→ボス
    const rx = -fz, rz = fx;                          // 右手方向
    const mx = clamp(inp.mx || 0, -1, 1), mz = clamp(inp.mz || 0, -1, 1);
    const mlen = Math.hypot(mx, mz);
    const wx = (fx * mz + rx * mx), wz = (fz * mz + rz * mx);

    // ガード状態の管理
    const wasGuard = p.guardHeld;
    p.guardHeld = !!inp.guard;
    const canGuard = p.state === "idle" || p.state === "guard" || (p.state === "attack" && p.st > P_ATTACKS[p.combo].w + 0.1);
    if (inp.guardEdge && canGuard) {
      const spam = this.t - p.guardUpAt < TUNE.spamGap;
      p.parryEnd = this.t + (spam ? TUNE.parryWindowSpam : TUNE.parryWindow);
      p.guardPress = this.t;
      if (p.state === "attack") { p.combo = 0; p.queued = false; }
      this.setP("guard");
      this.emit("guardUp", {});
    }
    if (!p.guardHeld && wasGuard) p.guardUpAt = this.t;

    // 一撃・致命の一撃の入力
    const vulnerable = b.state === "stun" || b.state === "kneel";
    if (inp.attack) {
      if (vulnerable && this.bossDist < 4.4 && (p.state === "idle" || p.state === "guard" || p.state === "attack")) { this.startDeathblow(); }
      else if (p.state === "idle" || p.state === "guard") { p.combo = 0; this.startAttack(); }
      else if (p.state === "attack" && p.st >= P_ATTACKS[p.combo].w * 0.6) p.queued = true;
    }
    if (inp.dodge && (p.state === "idle" || p.state === "guard" || (p.state === "attack" && p.st > P_ATTACKS[p.combo].w + 0.06))) this.startDodge(wx, wz, mlen, fx, fz);
    if (inp.heal && (p.state === "idle" || p.state === "guard") && p.gourds > 0 && p.hp < TUNE.playerHp) { this.setP("heal"); p.healDone = false; p.gourds--; this.emit("healStart", {}); }

    let speed = 0, dirx = 0, dirz = 0;
    switch (p.state) {
      case "idle":
        if (p.guardHeld && p.state === "idle") this.setP("guard");
        speed = TUNE.playerSpeed; dirx = wx; dirz = wz; break;
      case "guard":
        if (!p.guardHeld) this.setP("idle");
        speed = TUNE.guardSpeed; dirx = wx; dirz = wz; break;
      case "attack": {
        const a = P_ATTACKS[p.combo];
        if (!p.hitDone && p.st >= a.w) { p.hitDone = true; this.playerHit(a); }
        // 踏み込み
        if (p.st < a.w + 0.06) { const sp = a.lunge / (a.w + 0.06); dirx = fx; dirz = fz; speed = sp; }
        if (p.st >= a.T - 0.12 && p.queued && p.combo < P_ATTACKS.length - 1) { p.combo++; p.queued = false; this.startAttack(); }
        else if (p.st >= a.T) { this.setP(p.guardHeld ? "guard" : "idle"); }
        break;
      }
      case "dodge": {
        const k = Math.max(0, 1 - p.st / 0.4);
        speed = TUNE.dodgeSpeed * k; dirx = p.dodgeDx; dirz = p.dodgeDz;
        if (p.st >= TUNE.dodgeTime) this.setP(p.guardHeld ? "guard" : "idle");
        break;
      }
      case "hit": speed = 0; if (p.st >= (p.hitLen || 0.42)) this.setP("idle"); break;
      case "stun": if (p.st >= 1.8) { p.posture = 45; this.setP("idle"); } break;
      case "heal":
        if (!p.healDone && p.st >= TUNE.healTime * 0.7) { p.healDone = true; p.hp = Math.min(TUNE.playerHp, p.hp + TUNE.healAmount); this.emit("healed", {}); }
        speed = 0.8; dirx = wx; dirz = wz;
        if (p.st >= TUNE.healTime) this.setP("idle");
        break;
      case "deathblow": this.updateDeathblow(dt); return;
      default: break;
    }

    // 速度の更新(ステート側で決めた方向と速さ)
    const dl = Math.hypot(dirx, dirz);
    let tvx = 0, tvz = 0;
    if (dl > 0.01 && speed > 0) { const s = (p.state === "attack" || p.state === "dodge" ? 1 : Math.min(1, dl)) * speed; tvx = (dirx / dl) * s; tvz = (dirz / dl) * s; }
    const acc = p.state === "dodge" || p.state === "attack" ? 99 : 38;
    p.vx = approach(p.vx, tvx, acc * dt); p.vz = approach(p.vz, tvz, acc * dt);
    p.x += p.vx * dt; p.z += p.vz * dt;
    // 向き: 回避中は進行方向、それ以外はボスを向く
    const targetYaw = p.state === "dodge" ? angTo(p.dodgeDx, p.dodgeDz) : toB;
    p.yaw += clamp(angDiff(p.yaw, targetYaw), -16 * dt, 16 * dt);
    this.clampArena(p, TUNE.playerRadius);
  }

  setP(s) { this.p.state = s; this.p.st = 0; }

  startAttack() {
    const p = this.p;
    p.hitDone = false; p.queued = false; this.setP("attack");
    this.emit("swing", { idx: p.combo });
    // ボスの反応ガード
    const b = this.b;
    if (b.state === "idle" && b.guardCd <= 0 && this.bossDist < 4.4 && this.rng() < (b.phase === 2 ? 0.34 : 0.24)) {
      b.state = "guard"; b.st = 0; b.guardCd = 3.2; this.emit("bossGuardUp", {});
    }
  }
  startDodge(wx, wz, mlen, fx, fz) {
    const p = this.p;
    let dx = wx, dz = wz;
    if (mlen < 0.2) { dx = -fx; dz = -fz; }
    const l = Math.hypot(dx, dz) || 1;
    p.dodgeDx = dx / l; p.dodgeDz = dz / l;
    p.queued = false; this.setP("dodge");
    this.emit("dodgeStart", {});
  }

  playerHit(a) {
    const p = this.p, b = this.b;
    const dx = b.x - p.x, dz = b.z - p.z, dist = Math.hypot(dx, dz);
    if (dist > TUNE.playerReach + TUNE.bossRadius * 0.4 || Math.abs(angDiff(p.yaw, angTo(dx, dz))) > 1.2) { this.emit("whiff", {}); return; }
    if (b.state === "roar" || b.state === "dying" || b.state === "deathblowed") return;
    if (b.state === "guard") {
      this.addBossPosture(14); this.emit("bossBlock", { x: b.x, z: b.z }); b.hp -= a.dmg * 0.1; this.knock(b, 0.35, p);
      if (b.hp <= 0) this.bossZero();
      return;
    }
    let dmg = a.dmg;
    if (b.state === "stun" || b.state === "kneel") dmg *= 1.5;
    b.hp -= dmg;
    this.addBossPosture(a.post);
    this.emit("bossHit", { dmg, combo: p.combo, x: b.x, z: b.z, heavy: p.combo === 2 });
    if (b.hp <= 0) this.bossZero();
  }

  knock(ent, d, from) {
    const dx = ent.x - from.x, dz = ent.z - from.z, l = Math.hypot(dx, dz) || 1;
    ent.x += (dx / l) * d; ent.z += (dz / l) * d;
  }

  hurtPlayer(dmg, postAdd, src) {
    const p = this.p;
    p.hp -= dmg;
    p.posture += postAdd; p.lastPost = this.t;
    p.queued = false;
    if (p.hp <= 0) { p.hp = 0; p.dead = true; p.state = "dead"; p.st = 0; this.stats.deaths++; this.emit("lose", { canRevive: !p.revived }); this.over = { win: false, time: this.stats.time, canRevive: !p.revived }; return; }
    if (p.state === "heal") this.emit("healCancel", {});
    p.hitLen = dmg >= 30 ? 0.9 : 0.42;
    this.setP("hit");
    p.invuln = 0.35;
    this.knock(p, dmg >= 30 ? 1.2 : 0.5, src);
    if (p.posture >= TUNE.playerPosture) this.playerPostureBreak();
  }
  playerPostureBreak() {
    const p = this.p;
    if (p.state === "dead") return;
    p.posture = TUNE.playerPosture; this.setP("stun");
    this.emit("playerPostureBreak", {});
  }

  revive() {
    const p = this.p, b = this.b;
    if (!p.dead || p.revived) return false;
    p.dead = false; p.revived = true; p.hp = TUNE.playerHp * 0.6; p.posture = 0; p.invuln = 2.5; this.setP("idle");
    b.posture = 0; if (b.state === "attack") { b.state = "idle"; b.st = 0; b.think = 1.5; }
    this.over = null;
    this.emit("revive", {});
    return true;
  }

  // ================= 致命の一撃 =================
  startDeathblow() {
    const p = this.p, b = this.b;
    this.setP("deathblow");
    p.dbFrom = { x: p.x, z: p.z };
    const a = angTo(p.x - b.x, p.z - b.z);
    p.dbTo = { x: b.x + Math.sin(a) * 1.9, z: b.z + Math.cos(a) * 1.9 };
    p.dbDone = false;
    b.prevState = b.state; b.state = "deathblowed"; b.st = 0;
    this.emit("deathblowStart", {});
  }
  updateDeathblow() {
    const p = this.p, b = this.b;
    const k = clamp(p.st / 0.35, 0, 1);
    p.x = p.dbFrom.x + (p.dbTo.x - p.dbFrom.x) * k; p.z = p.dbFrom.z + (p.dbTo.z - p.dbFrom.z) * k;
    p.yaw = angTo(b.x - p.x, b.z - p.z);
    p.vx = p.vz = 0;
    if (!p.dbDone && p.st >= 0.9) {
      p.dbDone = true;
      b.bars--;
      this.emit("deathblow", { final: b.bars <= 0, x: b.x, z: b.z });
      if (b.bars <= 0) { b.state = "dying"; b.st = 0; b.hp = 0; this.emit("win", {}); }
      else { b.phase = 2; b.state = "roar"; b.st = 0; b.hp = TUNE.bossBarHp; b.posture = 0; b.speed = 1.2; b.think = 1; b.atk = null; this.emit("phase2", {}); }
    }
    if (p.st >= 1.7) this.setP("idle");
  }

  // ================= ボス =================
  addBossPosture(v) {
    const b = this.b;
    if (b.state === "stun" || b.state === "kneel" || b.state === "roar" || b.state === "dying" || b.state === "deathblowed") return;
    b.posture += v; b.lastPost = this.t;
    if (b.posture >= TUNE.bossPosture) {
      b.posture = TUNE.bossPosture; b.state = "stun"; b.st = 0; b.atk = null;
      this.emit("bossPostureBreak", {});
    }
  }
  bossZero() {
    const b = this.b;
    b.hp = 0;
    if (b.state === "stun" || b.state === "kneel" || b.state === "roar" || b.state === "dying" || b.state === "deathblowed") return;
    b.state = "kneel"; b.st = 0; b.atk = null;
    this.emit("bossKneel", {});
  }

  chooseAttack() {
    const b = this.b, d = this.bossDist, ph = b.phase;
    let o;
    if (d > 6.5) o = { leap: 3, thrust: 2, slash: 0.6 };
    else if (d > 3.9) o = { thrust: 2, leap: 1.4, slash: 2.2, combo2: 2 };
    else o = { slash: 2.6, combo2: 3, overhead: 2, sweep: 1.5, thrust: 0.8, combo3: ph === 2 ? 3 : 0, grab: ph === 2 ? 1.6 : 0 };
    const last = b.hist[b.hist.length - 1];
    let tot = 0;
    for (const k of Object.keys(o)) { if (k === last) o[k] *= 0.3; tot += o[k]; }
    let r = this.rng() * tot;
    for (const [k, w] of Object.entries(o)) { r -= w; if (r <= 0) return k; }
    return "slash";
  }

  startBossAttack(name) {
    const b = this.b, p = this.p;
    b.state = "attack"; b.st = 0; b.atkClock = 0; b.atk = B_ATTACKS[name]; b.atkName = name; b.hitIdx = 0; b.perilFired = false; b.leapFrom = null;
    b.hist.push(name); if (b.hist.length > 4) b.hist.shift();
    b.moveAmt = 0;
    this.emit("bossAttack", { name, perilous: b.atk.perilous });
    void p;
  }

  updateBoss(dt) {
    const b = this.b, p = this.p;
    b.st += dt;
    if (b.guardCd > 0) b.guardCd -= dt;
    if (this.over && this.over.win) { if (b.state === "dying" && b.st > 3.4 && !this.over.fin) this.over.fin = true; return; }
    // 体幹の自然回復
    if (!["stun", "kneel", "roar", "dying", "deathblowed"].includes(b.state) && this.t - b.lastPost > 1.8) b.posture = Math.max(0, b.posture - (b.phase === 2 ? 6 : 9) * dt);

    const toP = angTo(p.x - b.x, p.z - b.z);
    const dist = this.bossDist;
    switch (b.state) {
      case "idle": {
        if (p.dead) break;
        b.yaw += clamp(angDiff(b.yaw, toP), -4 * dt, 4 * dt);
        const spd = (b.phase === 2 ? 3.4 : 2.7);
        if (dist > 3.4) { b.x += Math.sin(toP) * spd * dt; b.z += Math.cos(toP) * spd * dt; }
        else if (dist < 2.2) { b.x -= Math.sin(toP) * 1.2 * dt; b.z -= Math.cos(toP) * 1.2 * dt; }
        else { const tx = Math.cos(toP) * b.strafe, tz = -Math.sin(toP) * b.strafe; b.x += tx * 1.3 * dt; b.z += tz * 1.3 * dt; }
        if (this.rng() < dt * 0.25) b.strafe *= -1;
        b.think -= dt;
        if (b.think <= 0) this.startBossAttack(this.chooseAttack());
        break;
      }
      case "attack": this.updateBossAttack(dt, toP, dist); break;
      case "guard":
        b.yaw += clamp(angDiff(b.yaw, toP), -5 * dt, 5 * dt);
        if (b.st >= 0.8) { b.state = "idle"; b.st = 0; b.think = this.rng() < 0.5 ? 0.05 : 0.5; }
        break;
      case "stun":
        if (b.st >= TUNE.bossStunTime) { b.state = "idle"; b.st = 0; b.posture = 25; b.think = 0.9; this.emit("bossRecover", {}); }
        break;
      case "kneel":
        if (b.st >= TUNE.bossKneelTime) { b.state = "idle"; b.st = 0; b.hp = TUNE.bossBarHp * 0.35; b.posture = 0; b.think = 0.9; this.emit("bossRecover", {}); }
        break;
      case "roar":
        b.yaw += clamp(angDiff(b.yaw, toP), -3 * dt, 3 * dt);
        if (b.st >= 2.4) { b.state = "idle"; b.st = 0; b.think = 0.7; }
        break;
      case "deathblowed": if (b.st > 2) { b.state = b.bars > 0 ? "idle" : "dying"; } break;
      case "dying": if (b.st >= 3.4 && this.over == null) this.over = { win: true, time: this.stats.time, stats: { ...this.stats } }; break;
      default: break;
    }
    this.clampArena(b, TUNE.bossRadius);
  }

  updateBossAttack(dt, toP, dist) {
    const b = this.b, a = b.atk, p = this.p;
    b.atkClock += dt * b.speed;
    const c = b.atkClock;
    if (c < a.lockT) b.yaw += clamp(angDiff(b.yaw, toP), -2.8 * dt * b.speed, 2.8 * dt * b.speed);
    // 危マーク
    if (a.perilous && !b.perilFired && c >= a.tell[0]) { b.perilFired = true; this.emit("peril", { kind: a.perilous }); }
    // 踏み込み
    if (a.step && c >= a.step[0] && c <= a.step[1]) {
      const sp = (a.step[2] / (a.step[1] - a.step[0])) * dt * b.speed;
      const stopAt = TUNE.minDist * 0.9;
      const move = Math.min(sp, Math.max(0, dist - stopAt));
      b.x += Math.sin(b.yaw) * (a.perilous === "thrust" ? sp : move);
      b.z += Math.cos(b.yaw) * (a.perilous === "thrust" ? sp : move);
    }
    // 飛びかかり
    if (a.leap) {
      if (c >= a.leap[0] && !b.leapFrom) { b.leapFrom = { x: b.x, z: b.z }; const d = Math.max(0, dist - 2.2); b.leapTo = { x: b.x + Math.sin(toP) * d, z: b.z + Math.cos(toP) * d }; b.yaw = toP; this.emit("bossLeap", {}); }
      if (b.leapFrom && c <= a.leap[1]) {
        const k = clamp((c - a.leap[0]) / (a.leap[1] - a.leap[0]), 0, 1);
        b.x = b.leapFrom.x + (b.leapTo.x - b.leapFrom.x) * k; b.z = b.leapFrom.z + (b.leapTo.z - b.leapFrom.z) * k;
      }
    }
    // 攻撃判定
    while (b.hitIdx < a.hits.length && c >= a.hits[b.hitIdx].t) {
      const h = a.hits[b.hitIdx++];
      this.emit("bossSwing", { idx: b.hitIdx - 1, perilous: a.perilous });
      this.bossHitCheck(h, a);
    }
    if (c >= a.dur) {
      b.state = "idle"; b.st = 0; b.atk = null;
      b.think = (a.rec * (b.phase === 2 ? 0.6 : 1)) * (0.8 + this.rng() * 0.5);
    }
  }

  bossHitCheck(h, a) {
    const b = this.b, p = this.p;
    if (p.dead || p.state === "deathblow") return;
    const dx = p.x - b.x, dz = p.z - b.z, dist = Math.hypot(dx, dz);
    const inRange = dist <= h.reach + TUNE.playerRadius && (h.arc >= 360 || Math.abs(angDiff(b.yaw, angTo(dx, dz))) <= rad(h.arc / 2));
    const dmgMul = b.phase === 2 ? 1.1 : 1;
    if (!inRange) { this.emit("miss", {}); return; }
    if (p.invuln > 0) return;
    if (p.state === "dodge" && p.st >= TUNE.dodgeIFrom && p.st <= TUNE.dodgeITo) { this.stats.dodges++; this.emit("dodged", { perilous: a.perilous }); return; }
    const dmg = Math.round(h.dmg * dmgMul);
    if (p.state === "stun") { this.hurtPlayer(dmg, 0, b); this.emit("playerHit", { dmg, perilous: a.perilous }); return; }
    if (a.perilous) { this.hurtPlayer(dmg, 10, b); this.emit("playerHit", { dmg, perilous: a.perilous }); return; }
    if (p.state === "guard" && this.t <= p.parryEnd) {
      // パリィ(弾き)
      this.stats.parries++;
      p.posture = Math.max(0, p.posture - 8);
      this.addBossPosture(h.post * (b.phase === 2 ? 0.9 : 1));
      this.knock(b, 0.5, p); this.knock(p, 0.15, b);
      this.emit("parry", { x: (p.x + b.x) / 2, z: (p.z + b.z) / 2, y: 1.3 });
      return;
    }
    if (p.state === "guard") {
      this.stats.blocks++;
      p.hp -= dmg * 0.12;
      p.posture += h.post; p.lastPost = this.t;
      this.knock(p, 0.7, b);
      this.emit("block", { x: (p.x + b.x) / 2, z: (p.z + b.z) / 2 });
      if (p.hp <= 0) { p.hp = 1; }
      if (p.posture >= TUNE.playerPosture) this.playerPostureBreak();
      return;
    }
    this.hurtPlayer(dmg, h.post * 0.5, b);
    this.emit("playerHit", { dmg, perilous: false });
  }

  // ================= 共通 =================
  separate() {
    const p = this.p, b = this.b;
    if (p.state === "deathblow" || p.dead) return;
    const dx = p.x - b.x, dz = p.z - b.z, d = Math.hypot(dx, dz);
    if (d < TUNE.minDist && d > 1e-4) {
      const push = (TUNE.minDist - d);
      const bossPushed = b.state === "attack" && b.atkName !== "leap" ? 0.15 : 0.35;
      p.x += (dx / d) * push * (1 - bossPushed); p.z += (dz / d) * push * (1 - bossPushed);
      b.x -= (dx / d) * push * bossPushed; b.z -= (dz / d) * push * bossPushed;
    }
    this.clampArena(p, TUNE.playerRadius); this.clampArena(b, TUNE.bossRadius);
  }
  clampArena(e, r) {
    const d = Math.hypot(e.x, e.z), m = TUNE.arena - r;
    if (d > m) { e.x = (e.x / d) * m; e.z = (e.z / d) * m; }
  }

  snapshot() {
    const b = this.b;
    return { hp: Math.max(0, b.hp) / TUNE.bossBarHp, bars: b.bars, phase: b.phase, time: this.stats.time || 0, state: this.over ? (this.over.win ? "win" : "lose") : "fight" };
  }
}
