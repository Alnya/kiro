// アニメーション: 戦闘ロジックの状態 → 人型リグのターゲットポーズ。
// キーフレーム形式: { t, p:[x,y,z]剣の位置, d:[x,y,z]剣先の向き, r:ロール, lean, tw:胴のひねり, dr:しゃがみ, pt:骨盤ひねり, h:[頭], side, lift }
// 座標: x は右が+、z は前。
import { P_ATTACKS, B_ATTACKS } from "./combat.js";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sm = (x) => x * x * (3 - 2 * x);

export function basePose() {
  return {
    drop: 0, pTwist: 0, pLean: 0, lean: 0.05, twist: 0, side: 0, head: [0, 0, 0], lift: 0,
    wPos: [0.14, 0.02, 0.36], wDir: [0, 0.4, 0.9], wRoll: 0, lHand: null,
    stanceW: 0.2, stanceR: 0.2, stanceL: -0.16,
  };
}

function K(t, p, d, o = {}) { return { t, p, d, r: o.r ?? 0, lean: o.lean ?? 0.05, tw: o.tw ?? 0, dr: o.dr ?? 0, pt: o.pt ?? 0, h: o.h ?? [0, 0, 0], side: o.side ?? 0, lift: o.lift ?? 0, lh: o.lh ?? null }; }

// トラックを時刻 time で評価して pose に書き込む
function evalTrack(track, time, pose) {
  let a = track[0], b = track[track.length - 1];
  if (time <= a.t) b = a;
  else if (time >= b.t) a = b;
  else for (let i = 0; i < track.length - 1; i++) if (time >= track[i].t && time <= track[i + 1].t) { a = track[i]; b = track[i + 1]; break; }
  const k = a === b ? 0 : sm(clamp((time - a.t) / (b.t - a.t), 0, 1));
  const L = (x, y) => x + (y - x) * k;
  pose.wPos = [L(a.p[0], b.p[0]), L(a.p[1], b.p[1]), L(a.p[2], b.p[2])];
  pose.wDir = [L(a.d[0], b.d[0]), L(a.d[1], b.d[1]), L(a.d[2], b.d[2])];
  pose.wRoll = L(a.r, b.r); pose.lean = L(a.lean, b.lean); pose.twist = L(a.tw, b.tw); pose.drop = L(a.dr, b.dr);
  pose.pTwist = L(a.pt, b.pt); pose.side = L(a.side, b.side); pose.lift = L(a.lift, b.lift);
  pose.head = [L(a.h[0], b.h[0]), L(a.h[1], b.h[1]), L(a.h[2], b.h[2])];
  if (a.lh || b.lh) { const la = a.lh || b.lh, lb = b.lh || a.lh; pose.lHand = [L(la[0], lb[0]), L(la[1], lb[1]), L(la[2], lb[2])]; }
}

const READY = K(0, [0.14, 0.02, 0.36], [0, 0.4, 0.9], { lean: 0.06 });

// ---------- 主人公 ----------
const PLAYER = {
  attack: [
    // 袈裟斬り(右上→左下)
    [K(0, [0.14, 0.02, 0.36], [0, 0.4, 0.9]), K(0.07, [0.4, 0.42, 0.04], [0.35, 0.95, -0.1], { lean: -0.12, tw: 0.55, dr: 0.04 }), K(0.15, [-0.2, 0.05, 0.58], [-0.75, 0.1, 0.62], { lean: 0.22, tw: -0.6, dr: 0.12, r: 0.4 }),
      K(0.28, [-0.4, -0.05, 0.46], [-0.9, -0.1, 0.4], { lean: 0.18, tw: -0.7, dr: 0.1 }), K(0.5, [0.14, 0.02, 0.36], [0, 0.4, 0.9])],
    // 返し(左→右の逆袈裟)
    [K(0, [-0.35, 0.0, 0.42], [-0.8, 0.1, 0.55], { lean: 0.15, tw: -0.6 }), K(0.06, [-0.42, -0.1, 0.34], [-0.85, -0.2, 0.4], { lean: 0.18, tw: -0.8, dr: 0.08 }), K(0.13, [0.38, 0.12, 0.55], [0.85, 0.2, 0.55], { lean: 0.22, tw: 0.7, dr: 0.1, r: -0.4 }),
      K(0.26, [0.5, 0.2, 0.4], [0.9, 0.3, 0.3], { lean: 0.15, tw: 0.8 }), K(0.48, [0.14, 0.02, 0.36], [0, 0.4, 0.9])],
    // 唐竹割り(上段から)
    [K(0, [0.1, 0.1, 0.4], [0, 0.5, 0.85]), K(0.12, [0.12, 0.85, -0.05], [0.02, 1, -0.3], { lean: -0.2, dr: -0.02 }), K(0.22, [0.04, 0.12, 0.7], [0, -0.35, 1], { lean: 0.38, dr: 0.18 }),
      K(0.4, [0.04, -0.02, 0.62], [0, -0.55, 0.9], { lean: 0.4, dr: 0.2 }), K(0.78, [0.14, 0.02, 0.36], [0, 0.4, 0.9])],
  ],
  guard: K(0, [0.03, 0.2, 0.36], [0.14, 1, 0.22], { r: 0.9, lean: 0.02, dr: 0.06 }),
  parry: [K(0, [0.03, 0.2, 0.36], [0.14, 1, 0.22], { r: 0.9, dr: 0.06 }), K(0.06, [-0.3, 0.3, 0.42], [-0.75, 0.8, 0.25], { r: 0.2, tw: -0.3, dr: 0.06 }), K(0.15, [0.22, 0.3, 0.42], [0.55, 0.9, 0.2], { r: 1.2, tw: 0.25, dr: 0.06 }), K(0.3, [0.03, 0.2, 0.36], [0.14, 1, 0.22], { r: 0.9, dr: 0.06 })],
  dodge: [K(0, [0.14, 0.02, 0.36], [0, 0.4, 0.9]), K(0.12, [0.25, 0.0, 0.1], [0.4, 0.3, -0.9], { lean: 0.38, dr: 0.38, tw: 0.2 }), K(0.5, [0.14, 0.02, 0.36], [0, 0.4, 0.9], { lean: 0.1, dr: 0.12 })],
  heal: [K(0, [0.14, 0.02, 0.36], [0, 0.4, 0.9]), K(0.25, [0.2, -0.1, 0.3], [0.2, 0.2, 0.9], { lean: 0.22, h: [0.35, 0, 0], dr: 0.1, lh: [-0.02, 0.72, 0.3] }), K(0.7, [0.2, -0.1, 0.3], [0.2, 0.2, 0.9], { lean: 0.22, h: [-0.2, 0, 0], dr: 0.1, lh: [-0.02, 0.76, 0.28] }), K(0.95, [0.14, 0.02, 0.36], [0, 0.4, 0.9])],
  // 突き(危): 引き絞って溜め → 踏み込んで突く
  thrust: [K(0, [0.14, 0.02, 0.36], [0, 0.4, 0.9]), K(0.3, [0.32, 0.08, -0.06], [0.08, 0.1, 1], { lean: -0.12, dr: 0.2, tw: 0.45 }), K(0.5, [0.34, 0.1, -0.12], [0.08, 0.12, 1], { lean: -0.16, dr: 0.24, tw: 0.5 }),
    K(0.64, [0.06, 0.16, 0.86], [0, 0.05, 1], { lean: 0.42, dr: 0.3, tw: -0.12 }), K(0.95, [0.06, 0.16, 0.84], [0, 0.05, 1], { lean: 0.4, dr: 0.28 }), K(1.3, [0.14, 0.02, 0.36], [0, 0.4, 0.9])],
  // 弾かれて体勢が崩れる
  recoil: [K(0, [0.3, 0.45, 0.12], [0.6, 0.85, -0.15], { lean: -0.32, dr: 0.08, h: [-0.3, 0, 0.1], tw: 0.35 }), K(0.3, [0.32, 0.38, 0.1], [0.6, 0.8, -0.05], { lean: -0.25, dr: 0.12, h: [-0.2, 0, 0.05], tw: 0.3 }), K(0.6, [0.14, 0.02, 0.36], [0, 0.4, 0.9])],
  deathblow: [K(0, [0.14, 0.02, 0.4], [0, 0.4, 0.9]), K(0.35, [0.1, 0.78, 0.12], [0, 1, 0.1], { lean: -0.18, dr: 0.05 }), K(0.8, [0.08, 0.7, 0.28], [0, 0.85, 0.3], { lean: -0.2 }), K(0.92, [0.06, 0.05, 0.75], [0, -1, 0.35], { lean: 0.5, dr: 0.28 }), K(1.4, [0.06, 0.0, 0.7], [0, -1, 0.3], { lean: 0.45, dr: 0.25 }), K(1.7, [0.14, 0.02, 0.36], [0, 0.4, 0.9])],
};

export function playerPose(duel, h, pose, extra) {
  const p = duel.p;
  const q = basePose();
  Object.assign(pose, q);
  let attackTrack = null, time = 0, kb = 16, kw = 30;
  switch (p.state) {
    case "attack": { attackTrack = PLAYER.attack[p.combo]; time = p.st; kw = 45; break; }
    case "guard": {
      if (extra.parryT >= 0 && extra.parryT < 0.3) { attackTrack = PLAYER.parry; time = extra.parryT; kw = 50; }
      else { attackTrack = [PLAYER.guard]; time = 0; kw = 26; }
      break;
    }
    case "dodge": attackTrack = PLAYER.dodge; time = p.st; kw = 30; break;
    case "heal": attackTrack = PLAYER.heal; time = p.st; kw = 14; break;
    case "deathblow": attackTrack = PLAYER.deathblow; time = p.st; kw = 40; break;
    case "hit": attackTrack = [K(0, [0.3, -0.05, 0.25], [0.5, 0.2, 0.7], { lean: -0.28, dr: 0.1, h: [-0.3, 0, 0.1] })]; kw = 20; break;
    case "stun": attackTrack = [K(0, [0.15, -0.25, 0.3], [0.2, -0.5, 0.85], { lean: 0.5, dr: 0.28, h: [0.4, 0, 0.15] })]; kw = 10; break;
    case "dead": attackTrack = [K(0, [0.2, -0.1, 0.2], [0.3, -0.3, 0.9], { lean: 0.3 })]; kw = 8; break;
    // 以下は対人戦で使う状態
    case "thrust": attackTrack = PLAYER.thrust; time = p.st; kw = 34; break;
    case "recoil": attackTrack = PLAYER.recoil; time = p.st; kw = 30; break;
    case "deathblowed": attackTrack = [K(0, [0.15, -0.1, 0.2], [0.2, -0.5, 0.8], { lean: -0.45, dr: 0.4, h: [-0.35, 0, 0] })]; kw = 12; break;
    default: attackTrack = [READY]; kw = 16; break;
  }
  evalTrack(attackTrack, time, pose);
  // 移動時の傾き・体重移動
  const sp = Math.hypot(p.vx, p.vz);
  if (p.state === "idle" || p.state === "guard") {
    const fwd = Math.sin(p.yaw) * p.vx + Math.cos(p.yaw) * p.vz, lat = Math.cos(p.yaw) * p.vx - Math.sin(p.yaw) * p.vz;
    pose.lean += clamp(fwd * 0.03, -0.1, 0.12); pose.side += clamp(-lat * 0.02, -0.1, 0.1);
    pose.drop += Math.sin(extra.t * 10) * 0.01 * Math.min(1, sp / 3);
    pose.wPos[1] += Math.sin(extra.t * 10) * 0.012 * Math.min(1, sp / 3);
  }
  pose.wPos[1] += Math.sin(extra.t * 1.7) * 0.006;
  pose.stanceW = p.state === "dodge" ? 0.3 : 0.2; pose.stanceR = 0.2; pose.stanceL = -0.17;
  if (p.state === "guard" || p.state === "heal") { pose.stanceR = 0.14; pose.stanceL = -0.2; }
  h.dead += ((p.state === "dead" ? 1 : 0) - h.dead) * Math.min(1, extra.dt * 5);
  return { body: kb, weapon: kw };
}

// ---------- ボス ----------
const BOSS_READY = K(0, [0.2, 0.1, 0.42], [0.1, 0.55, 0.85], { lean: 0.04 });
const SW = (c) => c; void SW;
const BOSS = {
  slash: [BOSS_READY, K(0.28, [0.6, 0.55, 0.0], [0.85, 0.55, -0.25], { tw: 0.7, lean: -0.05, dr: 0.12 }), K(0.5, [0.62, 0.5, -0.02], [0.85, 0.5, -0.3], { tw: 0.78, lean: -0.08, dr: 0.12 }),
    K(0.58, [-0.4, 0.05, 0.7], [-0.9, 0.0, 0.45], { tw: -0.8, lean: 0.22, dr: 0.18 }), K(0.85, [-0.65, 0.0, 0.4], [-1, -0.05, 0.25], { tw: -0.9, lean: 0.2, dr: 0.12 }), K(1.2, BOSS_READY.p, BOSS_READY.d)],
  combo2: [BOSS_READY, K(0.26, [0.6, 0.55, 0.0], [0.85, 0.55, -0.25], { tw: 0.7, dr: 0.12 }), K(0.52, [-0.4, 0.05, 0.7], [-0.9, 0.0, 0.45], { tw: -0.8, lean: 0.22, dr: 0.18 }),
    K(0.7, [-0.7, 0.1, 0.35], [-1, 0.1, 0.2], { tw: -1.0, lean: 0.1, dr: 0.12 }), K(1.0, [0.45, 0.1, 0.7], [0.9, 0.05, 0.45], { tw: 0.85, lean: 0.22, dr: 0.18 }), K(1.2, [0.7, 0.1, 0.4], [1, 0.05, 0.25], { tw: 0.95, dr: 0.12 }), K(1.7, BOSS_READY.p, BOSS_READY.d)],
  combo3: [BOSS_READY, K(0.24, [0.6, 0.55, 0.0], [0.85, 0.55, -0.25], { tw: 0.7, dr: 0.12 }), K(0.48, [-0.4, 0.05, 0.7], [-0.9, 0.0, 0.45], { tw: -0.8, lean: 0.22, dr: 0.18 }), K(0.7, [-0.7, 0.1, 0.35], [-1, 0.1, 0.2], { tw: -1.0, dr: 0.12 }),
    K(0.92, [0.45, 0.1, 0.7], [0.9, 0.05, 0.45], { tw: 0.85, lean: 0.22, dr: 0.18 }), K(1.15, [0.1, 1.0, -0.15], [0.02, 1, -0.3], { lean: -0.25, dr: -0.02 }), K(1.4, [0.1, 1.05, -0.2], [0.02, 1, -0.4], { lean: -0.3 }),
    K(1.55, [0.0, 0.05, 0.8], [0, -0.5, 1], { lean: 0.45, dr: 0.22 }), K(2.3, BOSS_READY.p, BOSS_READY.d)],
  overhead: [BOSS_READY, K(0.5, [0.1, 1.0, -0.15], [0.02, 1, -0.3], { lean: -0.28, dr: -0.02 }), K(0.9, [0.1, 1.08, -0.2], [0.02, 1, -0.45], { lean: -0.32 }), K(1.0, [0.0, 0.05, 0.8], [0, -0.5, 1], { lean: 0.45, dr: 0.22 }),
    K(1.3, [0.0, -0.05, 0.75], [0, -0.7, 0.9], { lean: 0.45, dr: 0.25 }), K(1.9, BOSS_READY.p, BOSS_READY.d)],
  thrust: [BOSS_READY, K(0.3, [0.4, 0.1, -0.1], [0.1, 0.12, 1], { lean: -0.12, dr: 0.18, tw: 0.35 }), K(0.8, [0.42, 0.12, -0.15], [0.1, 0.14, 1], { lean: -0.16, dr: 0.22, tw: 0.4 }), K(0.95, [0.1, 0.2, 0.95], [0, 0.05, 1], { lean: 0.38, dr: 0.28, tw: -0.1 }),
    K(1.3, [0.1, 0.2, 0.92], [0, 0.05, 1], { lean: 0.38, dr: 0.28 }), K(1.8, BOSS_READY.p, BOSS_READY.d)],
  sweep: [BOSS_READY, K(0.3, [0.55, 0.0, -0.1], [0.95, 0.0, -0.3], { tw: 0.9, dr: 0.5, lean: 0.1 }), K(0.8, [0.6, -0.05, -0.15], [1, 0.0, -0.4], { tw: 1.1, dr: 0.55, lean: 0.12 }), K(0.9, [-0.55, -0.08, 0.6], [-1, 0.0, 0.2], { tw: -1.4, dr: 0.5, lean: 0.15 }),
    K(1.2, [-0.7, -0.05, 0.3], [-1, 0.0, 0.0], { tw: -1.5, dr: 0.45 }), K(1.9, BOSS_READY.p, BOSS_READY.d)],
  leap: [BOSS_READY, K(0.3, [0.15, 0.05, 0.3], [0.1, 0.5, 0.8], { dr: 0.5, lean: 0.2 }), K(0.5, [0.1, 0.95, -0.1], [0.02, 1, -0.3], { dr: 0.0, lean: -0.2, lift: 0.9 }), K(0.9, [0.1, 1.0, -0.1], [0.02, 1, -0.3], { lean: -0.2, lift: 0.7 }), K(1.05, [0.0, 0.05, 0.8], [0, -0.5, 1], { lean: 0.45, dr: 0.25, lift: 0.0 }),
    K(1.4, [0.0, -0.05, 0.75], [0, -0.6, 0.9], { lean: 0.4, dr: 0.28 }), K(1.9, BOSS_READY.p, BOSS_READY.d)],
  grab: [BOSS_READY, K(0.3, [0.5, 0.1, 0.1], [0.9, 0.3, -0.2], { tw: 0.5, dr: 0.2, lh: [-0.15, 0.25, 0.3] }), K(0.55, [0.55, 0.1, 0.0], [0.9, 0.3, -0.3], { tw: 0.6, dr: 0.22, lh: [-0.2, 0.28, 0.7] }), K(0.85, [0.5, 0.1, 0.0], [0.9, 0.3, -0.3], { tw: -0.2, lean: 0.3, dr: 0.25, lh: [-0.1, 0.1, 1.1] }),
    K(1.2, [0.5, 0.1, 0.0], [0.9, 0.3, -0.3], { lean: 0.25, dr: 0.2, lh: [0.0, 0.3, 0.9] }), K(2.0, BOSS_READY.p, BOSS_READY.d)],
};

export function bossPose(duel, h, pose, extra) {
  const b = duel.b;
  Object.assign(pose, basePose());
  pose.stanceW = 0.26; pose.stanceR = 0.26; pose.stanceL = -0.22;
  let track = [BOSS_READY], time = 0, kw = 18;
  switch (b.state) {
    case "attack": track = BOSS[b.atkName] || [BOSS_READY]; time = b.atkClock; kw = 40; break;
    case "guard": track = [K(0, [0.05, 0.3, 0.42], [0.2, 1, 0.3], { r: 0.8, dr: 0.12, lean: 0.0 })]; kw = 26; break;
    case "stun": track = [K(0, [0.1, -0.3, 0.3], [0.2, -0.6, 0.8], { lean: 0.55, dr: 0.5, h: [0.45, 0, 0.1] })]; kw = 8; break;
    case "kneel": track = [K(0, [0.1, -0.5, 0.2], [0.1, -0.9, 0.5], { lean: 0.35, dr: 0.85, h: [0.5, 0, 0.1] })]; kw = 6; break;
    case "roar": track = [K(0, [0.05, 0.75, 0.2], [0.1, 1, 0.1], { lean: -0.35, dr: 0.0, h: [-0.45, 0, 0] }), K(2.4, [0.05, 0.75, 0.2], [0.1, 1, 0.1], { lean: -0.35, h: [-0.45, 0, 0] })]; kw = 14; break;
    case "deathblowed": track = [K(0, [0.1, -0.1, 0.2], [0.1, -0.5, 0.8], { lean: -0.45, dr: 0.45, h: [-0.3, 0, 0] })]; kw = 12; break;
    case "dying": track = [K(0, [0.1, -0.5, 0.2], [0.1, -0.9, 0.5], { lean: 0.4, dr: 0.9 })]; kw = 6; break;
    default: track = [BOSS_READY]; break;
  }
  evalTrack(track, time, pose);
  if (b.state === "idle") {
    pose.wPos[1] += Math.sin(extra.t * 1.4) * 0.02; pose.lean += Math.sin(extra.t * 1.1) * 0.02; pose.drop += Math.sin(extra.t * 1.3) * 0.012;
  }
  if (b.state === "roar") pose.side = Math.sin(extra.t * 40) * 0.03;
  h.dead += ((b.state === "dying" && b.st > 1.4 ? 1 : 0) - h.dead) * Math.min(1, extra.dt * 2.5);
  return { body: 14, weapon: kw };
}

export { PLAYER, BOSS, P_ATTACKS, B_ATTACKS };
