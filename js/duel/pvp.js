// 対人戦(2人)の戦闘ロジック。描画・DOM・Three.js 非依存。
// ロックステップ通信(毎フレームの入力だけを交換し、両端末で同じ計算をする)のため、計算は完全に決定論的にする:
//  - 固定の時間刻み(1/60秒)
//  - Math.sin / cos / atan2 / hypot は端末(ブラウザのJSエンジン)ごとに最後の桁が違うことがあるので使わず、
//    四則演算と Math.sqrt(IEEEで結果が一意)だけで作った関数を使う
//  - 乱数を使わない
//
// ルール(SEKIROライク・三本勝負):
//  - 攻撃(三段)/ 防御(ジャストでパリィ)/ 回避 / 回復 / 突き(「危」: 防御もパリィもできない)
//  - パリィされた側は体勢を崩され(弾かれ)、体幹が大きく溜まる。その間に反撃が入る
//  - 突きを相手の方へ踏み込む回避でかわすと「見切り」。突いた側の体幹が大きく溜まる
//  - 体幹が満タンになると「体幹崩し」。その間に攻撃すると致命の一撃で一本。体力0でも一本
//  - 先に2本取った方の勝ち。時間切れは残り体力の多い方が一本
import { TUNE, P_ATTACKS } from "./combat.js";

export const PVP = {
  dt: 1 / 60,
  hp: 100, posture: 100, gourds: 2, heal: 35,
  winsNeeded: 2, maxRounds: 5, roundTime: 99, introT: 2.0, endT: 3.6,
  hitStun: 0.3, heavyStun: 0.55, stunTime: 2.2, recoilTime: 0.5,
  parryPost: 2.6,     // パリィされた攻撃側に溜まる体幹(攻撃の post に対する倍率)
  blockPost: 1.7,     // 防御した側に溜まる体幹(倍率)
  blockChip: 0.12,    // 防御時に受けるダメージ(倍率)
  hitPost: 1.0,
  grace: 4 / 60,      // 遅延補償: 攻撃が当たってからこの時間内の防御入力もパリィとして扱う(入力遅延と同じ)
  thrust: { tell: 0.1, lock: 0.4, w: 0.62, T: 1.3, dmg: 28, post: 25, reach: 4.4, arc: 0.36, lungeFrom: 0.44, lungeTo: 0.66, lunge: 2.6 },
  mikiriPost: 55, mikiriRecoil: 0.9,
  dbRange: 4.4, dbHit: 0.9, dbLen: 1.7,
  reach: 2.9, arc: 1.15, radius: 0.45, minDist: 1.15,
  arena: TUNE.arena, spawn: 4.2,
};

// ================= 決定論的な数学関数 =================
const PI = 3.141592653589793, TAU = 2 * PI, HALF = PI / 2;
export function dsin(x) {
  x -= TAU * Math.round(x / TAU);
  if (x > HALF) x = PI - x; else if (x < -HALF) x = -PI - x;
  const x2 = x * x;
  return x * (1 + x2 * (-1 / 6 + x2 * (1 / 120 + x2 * (-1 / 5040 + x2 * (1 / 362880 + x2 * (-1 / 39916800 + x2 / 6227020800))))));
}
export const dcos = (x) => dsin(x + HALF);
function datan(z) {
  const neg = z < 0; if (neg) z = -z;
  const inv = z > 1; if (inv) z = 1 / z;
  // 半角の公式で2回縮める: atan(z) = 2·atan(z / (1 + √(1+z²)))
  z = z / (1 + Math.sqrt(1 + z * z));
  z = z / (1 + Math.sqrt(1 + z * z));
  const z2 = z * z;
  let r = 4 * z * (1 - z2 * (1 / 3 - z2 * (1 / 5 - z2 * (1 / 7 - z2 * (1 / 9 - z2 * (1 / 11 - z2 / 13))))));
  if (inv) r = HALF - r;
  return neg ? -r : r;
}
export function datan2(y, x) {
  if (x > 0) return datan(y / x);
  if (x < 0) return y >= 0 ? datan(y / x) + PI : datan(y / x) - PI;
  return y > 0 ? HALF : y < 0 ? -HALF : 0;
}
const hyp = (x, z) => Math.sqrt(x * x + z * z);
const angTo = (dx, dz) => datan2(dx, dz);
const angDiff = (a, b) => { let d = b - a; while (d > PI) d -= TAU; while (d < -PI) d += TAU; return d; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const approach = (v, t, a) => (v < t ? Math.min(v + a, t) : Math.max(v - a, t));

// ================= 入力のビット表現 =================
// mx,mz: 各4ビット(0..14、7が中央) / 8:防御中 9:防御押下 10:攻撃 11:回避 12:回復 13:突き
export const EDGE_MASK = (1 << 9) | (1 << 10) | (1 << 11) | (1 << 12) | (1 << 13);
export function encodeInput(i) {
  const q = (v) => clamp(Math.round((v || 0) * 7) + 7, 0, 14);
  return q(i.mx) | (q(i.mz) << 4) | (i.guard ? 1 << 8 : 0) | (i.guardEdge ? 1 << 9 : 0) | (i.attack ? 1 << 10 : 0) |
    (i.dodge ? 1 << 11 : 0) | (i.heal ? 1 << 12 : 0) | (i.thrust ? 1 << 13 : 0);
}
export function decodeInput(b) {
  b = b | 0;
  const mxq = b & 15, mzq = (b >> 4) & 15;
  return {
    mx: mxq === 15 ? 0 : (mxq - 7) / 7, mz: mzq === 15 ? 0 : (mzq - 7) / 7,
    guard: !!(b & (1 << 8)), guardEdge: !!(b & (1 << 9)), attack: !!(b & (1 << 10)), dodge: !!(b & (1 << 11)), heal: !!(b & (1 << 12)), thrust: !!(b & (1 << 13)),
  };
}
export const NEUTRAL = encodeInput({});

const STATES = ["idle", "guard", "attack", "thrust", "dodge", "hit", "recoil", "stun", "heal", "deathblow", "deathblowed", "dead"];

function newFighter(i) {
  return {
    i, x: 0, z: i === 0 ? PVP.spawn : -PVP.spawn, yaw: i === 0 ? PI : 0, vx: 0, vz: 0,
    hp: PVP.hp, posture: 0, state: "idle", st: 0, combo: 0, queued: false, hitDone: false,
    guardHeld: false, guardPress: -9, parryWin: 0, guardUpAt: -9, invuln: 0, gourds: PVP.gourds, lastPost: -9,
    dodgeDx: 0, dodgeDz: 1, healDone: false, hitLen: 0.3, recoilLen: 0.5, dead: false, perilFired: false,
    dbFrom: null, dbTo: null, dbDone: false,
    stats: { parries: 0, mikiri: 0, deathblows: 0, hits: 0 },
  };
}

export class PvpSim {
  constructor() {
    this.f = 0; this.t = 0; this.wins = [0, 0]; this.round = 0; this.ev = []; this.matchOver = null;
    this.total = [{ parries: 0, mikiri: 0, deathblows: 0, hits: 0 }, { parries: 0, mikiri: 0, deathblows: 0, hits: 0 }];
    this.newRound();
  }

  newRound() {
    this.F = [newFighter(0), newFighter(1)];
    this.phase = "intro"; this.pt = 0; this.roundT = 0; this.roundResult = null;
    this.pendingHits = []; this.freeze = 0; this.frozen = false; this.pend = [0, 0]; this.lastDeath = null;
    this.emit("roundStart", { round: this.round });
  }

  emit(k, o = {}) { this.ev.push({ k, t: this.t, ...o }); }
  dist() { const [a, b] = this.F; return hyp(a.x - b.x, a.z - b.z); }

  // bits: [入力0, 入力1](encodeInput の値)。このフレームのイベント配列を返す
  step(bits) {
    this.f++;
    if (this.freeze > 0) {
      // ヒットストップ: 両者とも止まる(押したボタンは止まっている間も覚えておく)
      this.freeze--; this.frozen = true;
      this.pend[0] |= bits[0] & EDGE_MASK; this.pend[1] |= bits[1] & EDGE_MASK;
      return this.ev.splice(0);
    }
    this.frozen = false;
    const dt = PVP.dt;
    this.t += dt; this.pt += dt;
    const inp = [decodeInput(bits[0] | this.pend[0]), decodeInput(bits[1] | this.pend[1])];
    this.pend = [0, 0];
    const [A, B] = this.F;

    if (this.phase === "intro") {
      const idle = decodeInput(NEUTRAL);
      this.updateFighter(A, B, idle, dt); this.updateFighter(B, A, idle, dt);
      if (this.pt >= PVP.introT) { this.phase = "fight"; this.pt = 0; this.emit("fight"); }
    } else if (this.phase === "fight") {
      this.roundT += dt;
      this.updateFighter(A, B, inp[0], dt);
      this.updateFighter(B, A, inp[1], dt);
      this.resolveHits();
      this.separate();
      this.checkRoundEnd();
    } else {
      // 決着後も演出(倒れる・致命の一撃の続き)のために動かす
      const idle = decodeInput(NEUTRAL);
      this.updateFighter(A, B, idle, dt); this.updateFighter(B, A, idle, dt);
      this.resolveHits();
      this.separate();
      if (this.phase === "end" && this.pt >= PVP.endT) {
        if (this.matchOver) { this.phase = "over"; this.emit("matchEnd", { winner: this.matchOver.winner }); }
        else { this.round++; this.newRound(); }
      }
    }
    return this.ev.splice(0);
  }

  // ================= 一人分の更新 =================
  updateFighter(F, O, inp, dt) {
    F.st += dt;
    if (F.invuln > 0) F.invuln -= dt;
    if (!F.dead && F.state !== "stun" && F.state !== "deathblowed" && this.t - F.lastPost > 1.0) F.posture = Math.max(0, F.posture - (F.state === "guard" ? 8 : 15) * dt);
    if (F.dead || F.state === "deathblowed") { F.vx = F.vz = 0; return; }

    const toO = angTo(O.x - F.x, O.z - F.z);
    const fx = dsin(toO), fz = dcos(toO);
    const rx = -fz, rz = fx;
    const mx = clamp(inp.mx || 0, -1, 1), mz = clamp(inp.mz || 0, -1, 1);
    const mlen = hyp(mx, mz);
    const wx = fx * mz + rx * mx, wz = fz * mz + rz * mx;
    const dist = hyp(O.x - F.x, O.z - F.z);

    // 防御・パリィの受付
    const wasGuard = F.guardHeld;
    F.guardHeld = !!inp.guard;
    const canGuard = F.state === "idle" || F.state === "guard" || (F.state === "attack" && F.st > P_ATTACKS[F.combo].w + 0.1);
    if (inp.guardEdge && canGuard) {
      const spam = this.t - F.guardUpAt < TUNE.spamGap;
      F.parryWin = spam ? TUNE.parryWindowSpam : TUNE.parryWindow;
      F.guardPress = this.t;
      if (F.state === "attack") { F.combo = 0; F.queued = false; }
      this.setS(F, "guard");
      this.emit("guardUp", { who: F.i });
    }
    if (!F.guardHeld && wasGuard) F.guardUpAt = this.t;

    const free = F.state === "idle" || F.state === "guard";
    if (inp.attack) {
      if (O.state === "stun" && dist < PVP.dbRange && (free || F.state === "attack")) this.startDeathblow(F, O);
      else if (free) { F.combo = 0; this.startAttack(F); }
      else if (F.state === "attack" && F.st >= P_ATTACKS[F.combo].w * 0.6) F.queued = true;
    }
    if (inp.thrust && free) { this.setS(F, "thrust"); F.hitDone = false; F.perilFired = false; this.emit("thrustStart", { who: F.i }); }
    if (inp.dodge && (free || (F.state === "attack" && F.st > P_ATTACKS[F.combo].w + 0.06))) this.startDodge(F, wx, wz, mlen, fx, fz);
    if (inp.heal && free && F.gourds > 0 && F.hp < PVP.hp) { this.setS(F, "heal"); F.healDone = false; F.gourds--; this.emit("healStart", { who: F.i }); }

    let speed = 0, dirx = 0, dirz = 0, turn = 16, face = toO;
    switch (F.state) {
      case "idle":
        if (F.guardHeld) this.setS(F, "guard");
        speed = TUNE.playerSpeed; dirx = wx; dirz = wz; break;
      case "guard":
        if (!F.guardHeld) this.setS(F, "idle");
        speed = TUNE.guardSpeed; dirx = wx; dirz = wz; break;
      case "attack": {
        const a = P_ATTACKS[F.combo];
        turn = F.st < a.w * 0.5 ? 9 : 0;   // 振り始めたら向きは変えられない(横への回避が有効になる)
        if (!F.hitDone && F.st >= a.w) { F.hitDone = true; this.registerHit(F, O, { dmg: a.dmg, post: a.post, heavy: F.combo === 2, combo: F.combo, reach: PVP.reach, arc: PVP.arc }); }
        if (F.st < a.w + 0.06 && dist > PVP.minDist + 0.25) { dirx = dsin(F.yaw); dirz = dcos(F.yaw); speed = a.lunge / (a.w + 0.06); }
        if (F.st >= a.T - 0.12 && F.queued && F.combo < P_ATTACKS.length - 1) { F.combo++; F.queued = false; this.startAttack(F); }
        else if (F.st >= a.T) this.setS(F, F.guardHeld ? "guard" : "idle");
        break;
      }
      case "thrust": {
        const T = PVP.thrust;
        turn = F.st < T.lock ? 5 : 0;
        if (!F.perilFired && F.st >= T.tell) { F.perilFired = true; this.emit("peril", { who: F.i }); }
        if (F.st >= T.lungeFrom && F.st <= T.lungeTo) { dirx = dsin(F.yaw); dirz = dcos(F.yaw); speed = T.lunge / (T.lungeTo - T.lungeFrom); }
        if (!F.hitDone && F.st >= T.w) { F.hitDone = true; this.registerHit(F, O, { dmg: T.dmg, post: T.post, heavy: true, perilous: true, reach: T.reach, arc: T.arc }); }
        if (F.st >= T.T) this.setS(F, F.guardHeld ? "guard" : "idle");
        break;
      }
      case "dodge": {
        const k = Math.max(0, 1 - F.st / 0.4);
        speed = TUNE.dodgeSpeed * k; dirx = F.dodgeDx; dirz = F.dodgeDz;
        face = angTo(F.dodgeDx, F.dodgeDz);
        if (F.st >= TUNE.dodgeTime) this.setS(F, F.guardHeld ? "guard" : "idle");
        break;
      }
      case "hit": turn = 4; if (F.st >= F.hitLen) this.setS(F, "idle"); break;
      case "recoil": turn = 0; if (F.st >= F.recoilLen) this.setS(F, "idle"); break;
      case "stun": turn = 0; if (F.st >= PVP.stunTime) { F.posture = 50; this.setS(F, "idle"); this.emit("recover", { who: F.i }); } break;
      case "heal":
        if (!F.healDone && F.st >= TUNE.healTime * 0.7) { F.healDone = true; F.hp = Math.min(PVP.hp, F.hp + PVP.heal); this.emit("healed", { who: F.i }); }
        speed = 0.8; dirx = wx; dirz = wz;
        if (F.st >= TUNE.healTime) this.setS(F, "idle");
        break;
      case "deathblow": this.updateDeathblow(F, O); return;
      default: break;
    }

    const dl = hyp(dirx, dirz);
    let tvx = 0, tvz = 0;
    if (dl > 0.01 && speed > 0) {
      const s = (F.state === "attack" || F.state === "dodge" || F.state === "thrust" ? 1 : Math.min(1, dl)) * speed;
      tvx = (dirx / dl) * s; tvz = (dirz / dl) * s;
    }
    const acc = F.state === "dodge" || F.state === "attack" || F.state === "thrust" ? 99 : 38;
    F.vx = approach(F.vx, tvx, acc * dt); F.vz = approach(F.vz, tvz, acc * dt);
    F.x += F.vx * dt; F.z += F.vz * dt;
    if (turn > 0) F.yaw += clamp(angDiff(F.yaw, face), -turn * dt, turn * dt);
    F.yaw = angDiff(0, F.yaw);
    this.clampArena(F);
  }

  setS(F, s) { F.state = s; F.st = 0; }

  startAttack(F) {
    F.hitDone = false; F.queued = false; this.setS(F, "attack");
    this.emit("swing", { who: F.i, idx: F.combo });
  }
  startDodge(F, wx, wz, mlen, fx, fz) {
    let dx = wx, dz = wz;
    if (mlen < 0.2) { dx = -fx; dz = -fz; }
    const l = hyp(dx, dz) || 1;
    F.dodgeDx = dx / l; F.dodgeDz = dz / l;
    F.queued = false; this.setS(F, "dodge");
    this.emit("dodgeStart", { who: F.i });
  }

  // ================= 攻撃の判定 =================
  // 当たった瞬間に範囲を判定し、PVP.grace 秒後に「防御・パリィ・回避」を確定する(入力遅延の補償)
  registerHit(F, O, h) {
    const dx = O.x - F.x, dz = O.z - F.z, d = hyp(dx, dz);
    const inRange = d <= h.reach + PVP.radius && Math.abs(angDiff(F.yaw, angTo(dx, dz))) <= h.arc;
    this.emit(h.perilous ? "thrustHit" : "strike", { who: F.i });
    if (!inRange) { this.emit("whiff", { who: F.i }); return; }
    this.pendingHits.push({ att: F.i, def: O.i, t0: this.t, at: this.t + PVP.grace - 1e-9, h, dodged: this.inIFrames(O), guarding: O.state === "guard", atkX: F.x, atkZ: F.z });
  }
  inIFrames(O) { return O.state === "dodge" && O.st >= TUNE.dodgeIFrom && O.st <= TUNE.dodgeITo; }

  resolveHits() {
    if (!this.pendingHits.length) return;
    const keep = [];
    for (const ph of this.pendingHits) {
      if (this.t < ph.at) { keep.push(ph); continue; }
      this.resolveHit(ph);
    }
    this.pendingHits = keep;
  }

  resolveHit(ph) {
    const F = this.F[ph.att], O = this.F[ph.def], h = ph.h;
    if (O.dead || O.state === "deathblowed" || O.state === "deathblow" || F.dead || F.state === "deathblowed") return;
    if (this.phase !== "fight") return;
    const mid = { x: (F.x + O.x) / 2, z: (F.z + O.z) / 2 };
    if (ph.dodged || this.inIFrames(O)) {
      // 見切り: 突きを、相手の方へ踏み込む回避でかわす
      const tx = ph.atkX - O.x, tz = ph.atkZ - O.z, tl = hyp(tx, tz) || 1;
      if (h.perilous && (O.dodgeDx * tx + O.dodgeDz * tz) / tl > 0.35) {
        O.stats.mikiri++;
        this.addPosture(F, PVP.mikiriPost);
        if (F.state !== "stun") { F.recoilLen = PVP.mikiriRecoil; this.setS(F, "recoil"); }
        F.vx = F.vz = 0;
        this.knock(F, 0.6, O);
        this.freeze = Math.max(this.freeze, 7);
        this.emit("mikiri", { who: O.i, att: F.i, ...mid });
      } else this.emit("dodged", { who: O.i, att: F.i, perilous: !!h.perilous });
      return;
    }
    if (O.invuln > 0) return;
    // 素早いタップ(すでに離している)でもパリィになるよう、押した時刻で判定する
    const guardOk = O.state === "guard" || O.state === "idle";
    if (!h.perilous && guardOk && O.guardPress >= ph.t0 - O.parryWin && O.guardPress <= this.t) {
      // パリィ(弾き): 攻撃した側が体勢を崩す
      O.stats.parries++;
      O.posture = Math.max(0, O.posture - 6);
      this.addPosture(F, h.post * PVP.parryPost);
      if (F.state !== "stun") { F.recoilLen = PVP.recoilTime; F.queued = false; this.setS(F, "recoil"); }
      F.vx = F.vz = 0;
      this.knock(F, 0.45, O); this.knock(O, 0.12, F);
      this.freeze = Math.max(this.freeze, 5);
      this.emit("parry", { who: O.i, att: F.i, ...mid });
      return;
    }
    if (!h.perilous && (O.state === "guard" || (ph.guarding && O.state === "idle"))) {
      O.hp = Math.max(1, O.hp - h.dmg * PVP.blockChip);
      O.posture += h.post * PVP.blockPost; O.lastPost = this.t;
      this.knock(O, 0.55, F);
      this.freeze = Math.max(this.freeze, 2);
      this.emit("block", { who: O.i, att: F.i, ...mid });
      if (O.posture >= PVP.posture) this.postureBreak(O);
      return;
    }
    // 被弾
    F.stats.hits++;
    O.hp -= h.dmg;
    O.posture += h.post * PVP.hitPost; O.lastPost = this.t;
    O.queued = false;
    this.freeze = Math.max(this.freeze, h.heavy ? 5 : 3);
    this.emit("hit", { who: O.i, att: F.i, dmg: h.dmg, heavy: !!h.heavy, perilous: !!h.perilous, x: O.x, z: O.z });
    if (O.hp <= 0) { this.kill(O, F, h.perilous ? "thrust" : "hp"); return; }
    if (O.state === "heal") this.emit("healCancel", { who: O.i });
    if (O.state !== "stun") {
      O.hitLen = h.heavy ? PVP.heavyStun : PVP.hitStun;
      this.setS(O, "hit");
    }
    this.knock(O, h.heavy ? 0.9 : 0.4, F);
    if (O.posture >= PVP.posture) this.postureBreak(O);
  }

  addPosture(F, v) {
    if (F.state === "stun" || F.dead || F.state === "deathblowed") return;
    F.posture += v; F.lastPost = this.t;
    if (F.posture >= PVP.posture) this.postureBreak(F);
  }
  postureBreak(F) {
    if (F.dead || F.state === "stun") return;
    F.posture = PVP.posture; F.queued = false; this.setS(F, "stun");
    F.vx = F.vz = 0;
    this.freeze = Math.max(this.freeze, 6);
    this.emit("postureBreak", { who: F.i });
  }
  knock(e, d, from) {
    const dx = e.x - from.x, dz = e.z - from.z, l = hyp(dx, dz) || 1;
    e.x += (dx / l) * d; e.z += (dz / l) * d;
    this.clampArena(e);
  }

  // ================= 致命の一撃 =================
  startDeathblow(F, O) {
    this.setS(F, "deathblow");
    F.dbFrom = { x: F.x, z: F.z };
    const a = angTo(F.x - O.x, F.z - O.z);
    F.dbTo = { x: O.x + dsin(a) * 1.5, z: O.z + dcos(a) * 1.5 };
    F.dbDone = false; F.vx = F.vz = 0;
    O.state = "deathblowed"; O.st = 0; O.vx = O.vz = 0;
    O.yaw = angTo(F.x - O.x, F.z - O.z);
    this.pendingHits = this.pendingHits.filter((p) => p.att !== O.i);
    this.emit("deathblowStart", { who: F.i, vic: O.i });
  }
  updateDeathblow(F, O) {
    const k = clamp(F.st / 0.35, 0, 1);
    F.x = F.dbFrom.x + (F.dbTo.x - F.dbFrom.x) * k; F.z = F.dbFrom.z + (F.dbTo.z - F.dbFrom.z) * k;
    F.yaw = angTo(O.x - F.x, O.z - F.z);
    F.vx = F.vz = 0;
    if (!F.dbDone && F.st >= PVP.dbHit) {
      F.dbDone = true; F.stats.deathblows++;
      this.freeze = Math.max(this.freeze, 14);
      this.emit("deathblow", { who: F.i, vic: O.i, x: O.x, z: O.z });
      this.kill(O, F, "deathblow");
    }
    if (F.st >= PVP.dbLen) this.setS(F, "idle");
  }

  kill(O, F, reason) {
    O.hp = 0; O.dead = true; this.setS(O, "dead"); O.vx = O.vz = 0;
    this.lastDeath = reason;
    this.emit("death", { who: O.i, by: F.i, reason });
  }

  // ================= 決着 =================
  checkRoundEnd() {
    if (this.phase !== "fight") return;
    const [A, B] = this.F;
    let winner = null, reason = "";
    if (A.dead && B.dead) { winner = -1; reason = "double"; }
    else if (A.dead || B.dead) {
      const w = A.dead ? 1 : 0;
      winner = w; reason = this.lastDeath || "hp";
    } else if (this.roundT >= PVP.roundTime) {
      const ha = A.hp - A.posture * 0.001, hb = B.hp - B.posture * 0.001;
      winner = ha > hb ? 0 : hb > ha ? 1 : -1; reason = "time";
    }
    if (winner === null) return;
    this.phase = "end"; this.pt = 0;
    if (winner >= 0) this.wins[winner]++;
    for (let i = 0; i < 2; i++) for (const k of Object.keys(this.total[i])) this.total[i][k] += this.F[i].stats[k];
    this.roundResult = { winner, reason };
    const done = this.wins[0] >= PVP.winsNeeded || this.wins[1] >= PVP.winsNeeded || this.round + 1 >= PVP.maxRounds;
    if (done) this.matchOver = { winner: this.wins[0] > this.wins[1] ? 0 : this.wins[1] > this.wins[0] ? 1 : -1 };
    this.emit("roundEnd", { winner, reason, wins: [...this.wins] });
  }

  // ================= 共通 =================
  separate() {
    const [A, B] = this.F;
    const busy = (e) => e.state === "deathblow" || e.state === "deathblowed" || e.dead;
    if (busy(A) || busy(B)) return;
    const dx = A.x - B.x, dz = A.z - B.z, d = hyp(dx, dz);
    if (d < PVP.minDist && d > 1e-4) {
      const push = (PVP.minDist - d) / 2;
      A.x += (dx / d) * push; A.z += (dz / d) * push;
      B.x -= (dx / d) * push; B.z -= (dz / d) * push;
    }
    this.clampArena(A); this.clampArena(B);
  }
  clampArena(e) {
    const d = hyp(e.x, e.z), m = PVP.arena - PVP.radius;
    if (d > m) { e.x = (e.x / d) * m; e.z = (e.z / d) * m; }
  }

  // 同期確認用のハッシュ
  hash() {
    let h = 2166136261 >>> 0;
    const mix = (v) => { h = Math.imul(h ^ (v | 0), 16777619) >>> 0; };
    mix(this.f); mix(this.wins[0]); mix(this.wins[1]); mix(this.round); mix(this.freeze);
    for (const F of this.F) {
      mix(Math.round(F.x * 1000)); mix(Math.round(F.z * 1000)); mix(Math.round(F.yaw * 1000));
      mix(Math.round(F.hp * 100)); mix(Math.round(F.posture * 100)); mix(STATES.indexOf(F.state)); mix(Math.round(F.st * 1000)); mix(F.gourds);
    }
    return h;
  }
}
