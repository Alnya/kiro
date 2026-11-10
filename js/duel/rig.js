// 人型リグ: 2ボーンIK(腕=剣の握りに追従、脚=接地位置に追従)と足の踏み替え。
// ポーズ座標系: x は「キャラクターの右が+」、y 上、z 前(キャラが向いている方向)。
import * as THREE from "../../vendor/three/three.module.js";

const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();

// 2ボーンIK: 根元 A → 目標 T、骨長 l1,l2、肘/膝の向き pole。戻り値 {mid, end}
export function solveTwoBone(A, T, l1, l2, pole, out) {
  const d = _a.subVectors(T, A);
  let dist = d.length();
  const maxR = (l1 + l2) * 0.999;
  if (dist > maxR) dist = maxR;
  if (dist < 0.05) dist = 0.05;
  d.normalize();
  const a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  // pole を d に直交させる
  const pv = _b.copy(pole).addScaledVector(d, -pole.dot(d));
  if (pv.lengthSq() < 1e-6) pv.set(0, 0, 1).addScaledVector(d, -d.z);
  pv.normalize();
  out.mid.copy(A).addScaledVector(d, a).addScaledVector(pv, h);
  out.end.copy(A).addScaledVector(d, dist);
  return out;
}

export function placeBone(bone, a, b) {
  bone.position.copy(a);
  _c.subVectors(b, a);
  const len = _c.length();
  if (len > 1e-5) bone.quaternion.setFromUnitVectors(UP, _c.multiplyScalar(1 / len));
}

const damp = (k, dt) => 1 - Math.exp(-k * dt);
const R2L = (v) => new THREE.Vector3(-v[0], v[1], v[2]); // ポーズ座標(右+) → ローカル(左+)

export class Humanoid {
  // dims: スケール済み寸法
  constructor(S = 1) {
    this.S = S;
    const d = (this.dim = {
      legUp: 0.47 * S, legLow: 0.47 * S, hipW: 0.12 * S, torsoLen: 0.54 * S, shoulderW: 0.22 * S, shoulderY: 0.47 * S,
      armUp: 0.29 * S, armLow: 0.29 * S, headR: 0.115 * S, neck: 0.08 * S,
    });
    d.pelvisY = (d.legUp + d.legLow) * 0.955;

    this.root = new THREE.Group();
    this.body = new THREE.Group(); this.root.add(this.body);
    this.pelvis = new THREE.Group(); this.body.add(this.pelvis);
    this.torso = new THREE.Group(); this.pelvis.add(this.torso); this.torso.position.y = 0.05 * S;
    this.neckG = new THREE.Group(); this.torso.add(this.neckG); this.neckG.position.y = d.torsoLen;
    this.head = new THREE.Group(); this.neckG.add(this.head); this.head.position.y = d.neck;
    this.weapon = new THREE.Group(); this.torso.add(this.weapon);
    this.gripR = new THREE.Object3D(); this.weapon.add(this.gripR);
    this.gripL = new THREE.Object3D(); this.weapon.add(this.gripL); this.gripL.position.set(0, -0.17 * S, 0);

    const bone = () => { const g = new THREE.Group(); return g; };
    // 腕: torso の子 / 脚: pelvis の子
    this.arm = [0, 1].map(() => ({ up: bone(), lo: bone(), hand: new THREE.Group() }));
    this.leg = [0, 1].map(() => ({ up: bone(), lo: bone() }));
    for (const a of this.arm) { this.torso.add(a.up, a.lo, a.hand); }
    for (const l of this.leg) { this.pelvis.add(l.up, l.lo); }
    this.foot = [0, 1].map(() => new THREE.Group());
    for (const f of this.foot) this.body.add(f);

    // 状態
    this.pose = this.defaultPose();
    this.target = this.defaultPose();
    this.weaponPos = new THREE.Vector3(); this.weaponQuat = new THREE.Quaternion();
    this.footW = [new THREE.Vector3(), new THREE.Vector3()];
    this.step = [{ t: 1, from: new THREE.Vector3(), to: new THREE.Vector3() }, { t: 1, from: new THREE.Vector3(), to: new THREE.Vector3() }];
    this.vel = new THREE.Vector3();
    this.initFeet = false;
    this.dead = 0; // 0..1 倒れ具合
    this._ik = { mid: new THREE.Vector3(), end: new THREE.Vector3() };
  }

  defaultPose() {
    return {
      drop: 0, pTwist: 0, pLean: 0, lean: 0.05, twist: 0, side: 0, head: [0, 0, 0], lift: 0,
      wPos: [0.14, 0.02, 0.36], wDir: [0, 0.4, 0.9], wRoll: 0,
      lHand: null,            // 左手を握りから外して置く位置(ポーズ座標)
      stanceW: 0.2, stanceR: 0.18, stanceL: -0.16,
    };
  }

  setRoot(x, z, yaw) { this.root.position.set(x, 0, z); this.root.rotation.y = yaw; }

  // target ポーズへ向けて平滑化しつつ姿勢を反映
  update(dt, velWorld, targetPose, k = {}) {
    const kb = k.body ?? 16, kw = k.weapon ?? 28;
    const t = targetPose, p = this.pose;
    const fb = damp(kb, dt), fw = damp(kw, dt);
    p.drop += (t.drop - p.drop) * fb; p.pTwist += (t.pTwist - p.pTwist) * fb; p.pLean += (t.pLean - p.pLean) * fb;
    p.lean += (t.lean - p.lean) * fb; p.twist += (t.twist - p.twist) * fb; p.side += (t.side - p.side) * fb; p.lift += ((t.lift || 0) - p.lift) * fb;
    for (let i = 0; i < 3; i++) { p.head[i] += (t.head[i] - p.head[i]) * fb; p.wPos[i] += (t.wPos[i] - p.wPos[i]) * fw; p.wDir[i] += (t.wDir[i] - p.wDir[i]) * fw; }
    p.wRoll += (t.wRoll - p.wRoll) * fw;
    p.stanceW += (t.stanceW - p.stanceW) * fb; p.stanceR += (t.stanceR - p.stanceR) * fb; p.stanceL += (t.stanceL - p.stanceL) * fb;
    if (t.lHand) { if (!p.lHand) p.lHand = t.lHand.slice(); for (let i = 0; i < 3; i++) p.lHand[i] += (t.lHand[i] - p.lHand[i]) * fw; } else p.lHand = null;
    this.vel.copy(velWorld);
    this.apply(dt);
  }

  apply(dt) {
    const d = this.dim, p = this.pose, S = this.S;
    // 倒れる
    this.body.rotation.x = -this.dead * (Math.PI / 2 - 0.05);
    this.body.position.y = this.dead * 0.2 * S + p.lift * S;

    // 骨盤・胴
    this.pelvis.position.set(0, d.pelvisY - p.drop * S, 0);
    this.pelvis.rotation.set(p.pLean, p.pTwist, 0);
    this.torso.rotation.set(p.lean, -p.twist, -p.side);
    this.head.rotation.set(p.head[0] - p.lean * 0.6, -p.head[1], -p.head[2]);

    // 武器(torso ローカル): 位置と向き(ブレード=+Y)とロール
    this.weaponPos.copy(R2L(p.wPos).multiplyScalar(S));
    const dir = R2L(p.wDir).normalize();
    this.weaponQuat.setFromUnitVectors(UP, dir);
    const roll = new THREE.Quaternion().setFromAxisAngle(UP, p.wRoll);
    this.weaponQuat.multiply(roll);
    this.weapon.position.copy(this.weaponPos);
    this.weapon.quaternion.copy(this.weaponQuat);

    this.root.updateMatrixWorld(true);
    this.updateArms();
    this.updateLegs(dt);
  }

  updateArms() {
    const d = this.dim, ik = this._ik;
    const gripW = [this.gripR, this.gripL];
    for (let i = 0; i < 2; i++) {
      const sgn = i === 0 ? -1 : 1; // 0=右(−x) 1=左(+x)
      const A = new THREE.Vector3(sgn * d.shoulderW, d.shoulderY, 0);
      let T;
      if (i === 1 && this.pose.lHand) T = R2L(this.pose.lHand).multiplyScalar(this.S);
      else {
        // 握り位置(weapon ローカル → torso ローカル)
        T = new THREE.Vector3(); gripW[i].updateMatrix();
        T.copy(gripW[i].position).applyQuaternion(this.weaponQuat).add(this.weaponPos);
      }
      solveTwoBone(A, T, d.armUp, d.armLow, new THREE.Vector3(sgn * 0.55, -1, -0.35), ik);
      const arm = this.arm[i];
      placeBone(arm.up, A, ik.mid);
      placeBone(arm.lo, ik.mid, ik.end);
      arm.hand.position.copy(ik.end);
      arm.hand.quaternion.copy(this.weaponQuat);
    }
  }

  updateLegs(dt) {
    const d = this.dim, p = this.pose, S = this.S;
    const ik = this._ik;
    const yaw = this.root.rotation.y;
    const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const left = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)); // 左(+x)方向
    const rootPos = this.root.position;
    const speed = this.vel.length();
    const ideal = [0, 1].map((i) => {
      const sgn = i === 0 ? -1 : 1;
      const z = (i === 0 ? p.stanceR : p.stanceL) * S;
      const v = new THREE.Vector3().copy(rootPos).addScaledVector(left, sgn * p.stanceW * S).addScaledVector(fwd, z);
      v.addScaledVector(this.vel, 0.13);
      v.y = 0;
      return v;
    });
    if (!this.initFeet) { for (let i = 0; i < 2; i++) { this.footW[i].copy(ideal[i]); this.step[i].t = 1; } this.initFeet = true; }

    if (this.dead < 0.01) {
      const thr = (0.34 + Math.min(speed, 8) * 0.055) * S;
      const dur = Math.max(0.1, 0.2 - speed * 0.012);
      for (let i = 0; i < 2; i++) {
        const st = this.step[i];
        if (st.t < 1) {
          st.t = Math.min(1, st.t + dt / dur);
          const k = st.t * st.t * (3 - 2 * st.t);
          this.footW[i].lerpVectors(st.from, st.to, k);
          this.footW[i].y = Math.sin(st.t * Math.PI) * 0.16 * S * Math.min(1, 0.5 + speed * 0.2);
        } else {
          this.footW[i].y = 0;
          const other = this.step[1 - i];
          const dist = this.footW[i].distanceTo(ideal[i]);
          if (dist > thr && other.t >= 1) { st.t = 0; st.from.copy(this.footW[i]); st.to.copy(ideal[i]); st.to.addScaledVector(this.vel, 0.05); }
        }
      }
    }
    this.root.updateMatrixWorld(true);
    this.pelvis.updateMatrix();
    const inv = new THREE.Matrix4().copy(this.pelvis.matrix).invert();
    for (let i = 0; i < 2; i++) {
      const sgn = i === 0 ? -1 : 1;
      // 足のワールド → body ローカル → pelvis ローカル
      const fb = this.body.worldToLocal(this.footW[i].clone());
      const foot = this.foot[i];
      foot.position.copy(fb);
      foot.rotation.y = 0; // body ローカルでは前=+z。root の回転に追従
      const fp = fb.clone().applyMatrix4(inv);
      fp.y += 0.07 * S; // くるぶしの高さ
      const A = new THREE.Vector3(sgn * d.hipW, 0, 0);
      solveTwoBone(A, fp, d.legUp, d.legLow, new THREE.Vector3(0, 0, 1), ik);
      placeBone(this.leg[i].up, A, ik.mid);
      placeBone(this.leg[i].lo, ik.mid, ik.end);
    }
  }

  // 足をその場にリセット(開始時・ワープ時)
  resetFeet() { this.initFeet = false; }
}
