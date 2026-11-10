// 主人公(剣士)とボス(鬼面の武将)のモデル。すべてプロシージャルなジオメトリ+PBRマテリアル。
import * as THREE from "../../vendor/three/three.module.js";
import { makeFabric, makeWood, makeWrap } from "./textures.js";

const mat = (o) => new THREE.MeshStandardMaterial(o);

export class Cloth {
  // 上端が原点、下へ h 垂れる布。親のローカル速度に応じて風になびく
  constructor(w, h, sx, sy, material) {
    const g = new THREE.PlaneGeometry(w, h, sx, sy);
    g.translate(0, -h / 2, 0);
    this.geo = g; this.base = g.attributes.position.array.slice();
    this.w = w; this.h = h;
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.castShadow = true; this.mesh.frustumCulled = false;
    this.lag = new THREE.Vector3();
  }
  update(t, velLocal, amp = 1) {
    this.lag.lerp(velLocal, 0.12);
    const pos = this.geo.attributes.position, b = this.base;
    for (let i = 0; i < pos.count; i++) {
      const x0 = b[i * 3], y0 = b[i * 3 + 1];
      const f = Math.min(1, Math.max(0, -y0 / this.h));
      const ff = f * f;
      const wave = Math.sin(t * 3.1 + y0 * 6 + x0 * 4) * 0.045 * ff * amp + Math.sin(t * 5.3 + y0 * 9) * 0.015 * ff * amp;
      pos.array[i * 3] = x0 - this.lag.x * 0.09 * ff;
      pos.array[i * 3 + 1] = y0 + Math.abs(this.lag.length()) * 0.05 * ff;
      pos.array[i * 3 + 2] = b[i * 3 + 2] - this.lag.z * 0.13 * ff + wave;
    }
    pos.needsUpdate = true;
    this.geo.computeVertexNormals();
  }
}

function mesh(geo, m, parent, x = 0, y = 0, z = 0) {
  const o = new THREE.Mesh(geo, m);
  o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true;
  if (parent) parent.add(o);
  return o;
}
const cylY = (len, r0, r1, seg = 14) => { const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1); g.translate(0, len / 2, 0); return g; };

// 刀身: 側面形状をExtrudeして反りと切先を作る。長手=+Y、刃=+Z側
function bladeGeometry(L, W, T, curve) {
  const sh = new THREE.Shape();
  const n = 14;
  const spine = [], edge = [];
  for (let i = 0; i <= n; i++) {
    const v = (i / n) * L;
    const k = i / n;
    const bow = curve * Math.sin(k * Math.PI * 0.5) * k; // 反り
    const taper = 1 - 0.25 * k;
    spine.push([bow - (W * taper) / 2 + W / 2 - W / 2, v]);
    edge.push([bow + (W * taper) / 2, v]);
  }
  sh.moveTo(spine[0][0], 0);
  sh.lineTo(edge[0][0], 0);
  for (let i = 1; i <= n - 2; i++) sh.lineTo(edge[i][0], edge[i][1]);
  sh.lineTo(edge[n - 1][0] + W * 0.12, L - W * 0.55);
  sh.lineTo(spine[n][0] + W * 0.55, L + W * 0.55); // 切先
  sh.lineTo(spine[n - 1][0], spine[n - 1][1]);
  for (let i = n - 2; i >= 0; i--) sh.lineTo(spine[i][0], spine[i][1]);
  const g = new THREE.ExtrudeGeometry(sh, { depth: T, bevelEnabled: true, bevelThickness: T * 0.45, bevelSize: T * 0.35, bevelSegments: 2, curveSegments: 4 });
  g.translate(0, 0, -T / 2);
  g.rotateY(-Math.PI / 2);   // 厚み軸→X、刃の向き→+Z
  g.computeVertexNormals();
  return g;
}

export function makeKatana(S, opt = {}) {
  const g = new THREE.Group();
  const len = (opt.len ?? 0.74) * S, wid = (opt.wid ?? 0.034) * S, thick = (opt.thick ?? 0.011) * S;
  const hl = (opt.handle ?? 0.30) * S;
  const bladeMat = mat({ color: opt.color ?? 0xe6edf8, metalness: 1, roughness: opt.rough ?? 0.17, envMapIntensity: 1.6, emissive: opt.emissive ?? 0x000000, emissiveIntensity: 0 });
  const blade = mesh(bladeGeometry(len, wid, thick, (opt.curve ?? 0.02) * S), bladeMat, g, 0, 0.11 * S, 0);
  // 切先寄りの明るい刃(研ぎ面)
  const edgeMat = mat({ color: 0xffffff, metalness: 1, roughness: 0.05, envMapIntensity: 2, emissive: opt.edgeEmissive ?? 0x223344, emissiveIntensity: 0.6 });
  const edge = mesh(new THREE.BoxGeometry(thick * 0.5, len * 0.97, wid * 0.16), edgeMat, g, 0, 0.11 * S + len * 0.49, wid * 0.46);
  edge.castShadow = false;
  // 柄(巻き)
  const wrapTex = makeWrap(opt.wrap ?? "#16162a"); wrapTex.repeat.set(1, 3);
  const handle = mesh(new THREE.CylinderGeometry(0.019 * S, 0.017 * S, hl, 12), mat({ map: wrapTex, roughness: 0.75, metalness: 0.05 }), g, 0, -hl * 0.35 + 0.0, 0);
  handle.scale.z = 0.8;
  // 鍔
  const tsuba = mesh(new THREE.CylinderGeometry(0.052 * S, 0.052 * S, 0.008 * S, 24), mat({ color: opt.gold ?? 0xb08a2e, metalness: 1, roughness: 0.3, envMapIntensity: 1.2 }), g, 0, 0.105 * S, 0);
  tsuba.scale.set(1, 1, 0.85);
  // 縁・頭
  mesh(new THREE.CylinderGeometry(0.02 * S, 0.02 * S, 0.03 * S, 12), mat({ color: opt.gold ?? 0xb08a2e, metalness: 1, roughness: 0.3 }), g, 0, 0.08 * S, 0);
  mesh(new THREE.SphereGeometry(0.02 * S, 12, 8), mat({ color: opt.gold ?? 0xb08a2e, metalness: 1, roughness: 0.3 }), g, 0, -hl * 0.35 - hl * 0.5, 0);
  g.userData = { blade, bladeMat, edge, edgeMat, tipY: 0.11 * S + len, baseY: 0.13 * S, len };
  return g;
}

// ================= 主人公 =================
export function buildPlayer(h) {
  const d = h.dim, S = h.S;
  const indigo = makeFabric("#1d2745", 256, [3, 3]);
  const indigoDark = makeFabric("#10141f", 256, [3, 3]);
  const red = makeFabric("#a3262b", 256, [2, 2]);
  const cloth = mat({ map: indigo.map, bumpMap: indigo.bump, bumpScale: 0.9, roughness: 0.88, metalness: 0 });
  const clothD = mat({ map: indigoDark.map, bumpMap: indigoDark.bump, bumpScale: 0.9, roughness: 0.9 });
  const clothR = mat({ map: red.map, bumpMap: red.bump, bumpScale: 0.9, roughness: 0.82, side: THREE.DoubleSide });
  const skin = mat({ color: 0xd9a37e, roughness: 0.62 });
  const leather = mat({ color: 0x3a281a, roughness: 0.6, metalness: 0.1 });
  const steel = mat({ color: 0x8a93a2, metalness: 0.95, roughness: 0.35, envMapIntensity: 1.2 });
  const white = mat({ color: 0xe8e4da, roughness: 0.8 });
  const hair = mat({ color: 0x0c0a0e, roughness: 0.4, metalness: 0.2 });

  // --- 脚 ---
  for (let i = 0; i < 2; i++) {
    const L = h.leg[i];
    mesh(cylY(d.legUp, 0.115 * S, 0.085 * S, 14), cloth, L.up);                 // 袴の腿
    mesh(new THREE.SphereGeometry(0.088 * S, 12, 10), cloth, L.up, 0, d.legUp, 0);
    mesh(cylY(d.legLow, 0.083 * S, 0.062 * S, 14), clothD, L.lo);               // 脛
    const guard = mesh(new THREE.BoxGeometry(0.1 * S, d.legLow * 0.55, 0.035 * S), steel, L.lo, 0, d.legLow * 0.4, 0.05 * S); // 脛当て
    guard.rotation.x = -0.05;
    mesh(new THREE.CylinderGeometry(0.07 * S, 0.07 * S, 0.05 * S, 12), leather, L.lo, 0, 0.03 * S, 0);
    // 足(足袋)
    const F = h.foot[i];
    mesh(new THREE.BoxGeometry(0.095 * S, 0.06 * S, 0.26 * S), clothD, F, 0, 0.04 * S, 0.06 * S);
    mesh(new THREE.BoxGeometry(0.1 * S, 0.02 * S, 0.27 * S), leather, F, 0, 0.01 * S, 0.06 * S);
  }
  // --- 骨盤・帯・鞘 ---
  mesh(new THREE.CylinderGeometry(0.17 * S, 0.19 * S, 0.14 * S, 18), cloth, h.pelvis, 0, 0.0, 0).scale.z = 0.78;
  const obi = mesh(new THREE.CylinderGeometry(0.182 * S, 0.182 * S, 0.075 * S, 22), clothR, h.pelvis, 0, 0.1 * S, 0); obi.scale.z = 0.8;
  for (let k = 0; k < 2; k++) { const t = mesh(new THREE.BoxGeometry(0.03 * S, 0.22 * S, 0.012 * S), clothR, h.pelvis, (k ? 0.04 : -0.03) * S, 0.0, -0.17 * S); t.rotation.z = k ? 0.12 : -0.1; }
  const saya = new THREE.Group(); h.pelvis.add(saya);
  saya.position.set(0.17 * S, 0.1 * S, 0.02 * S); saya.rotation.set(1.35, 0, -0.1);
  mesh(new THREE.CylinderGeometry(0.02 * S, 0.016 * S, 0.8 * S, 10), mat({ color: 0x0b0b0e, roughness: 0.25, metalness: 0.4 }), saya, 0, 0.3 * S, 0);
  mesh(new THREE.TorusGeometry(0.021 * S, 0.006 * S, 6, 12), mat({ color: 0xb08a2e, metalness: 1, roughness: 0.3 }), saya, 0, 0.62 * S, 0).rotation.x = Math.PI / 2;
  // --- 胴 ---
  const chest = mesh(new THREE.CylinderGeometry(0.2 * S, 0.155 * S, d.torsoLen, 18), cloth, h.torso, 0, d.torsoLen / 2, 0); chest.scale.z = 0.72;
  const under = mesh(new THREE.CylinderGeometry(0.205 * S, 0.2 * S, d.torsoLen * 0.4, 18, 1, true), clothD, h.torso, 0, d.torsoLen * 0.7, 0.002); under.scale.z = 0.74;
  const plate = mesh(new THREE.BoxGeometry(0.2 * S, 0.24 * S, 0.035 * S), steel, h.torso, 0, d.torsoLen * 0.62, 0.135 * S); plate.rotation.x = 0.08; // 胸当て
  mesh(new THREE.BoxGeometry(0.035 * S, 0.26 * S, 0.012 * S), clothR, h.torso, 0, d.torsoLen * 0.62, 0.155 * S);
  for (const sx of [-1, 1]) { // 襟(白)
    const col = mesh(new THREE.BoxGeometry(0.05 * S, 0.3 * S, 0.014 * S), white, h.torso, sx * 0.045 * S, d.torsoLen * 0.78, 0.15 * S); col.rotation.z = -sx * 0.4;
  }
  for (const sx of [-1, 1]) { // 肩
    mesh(new THREE.SphereGeometry(0.075 * S, 14, 10), cloth, h.torso, sx * d.shoulderW, d.shoulderY, 0);
    const sode = mesh(new THREE.CylinderGeometry(0.09 * S, 0.09 * S, 0.12 * S, 12, 1, true, 0, Math.PI), steel, h.torso, sx * (d.shoulderW + 0.01 * S), d.shoulderY + 0.03 * S, 0);
    sode.rotation.z = Math.PI / 2; sode.rotation.y = sx * 0.3; sode.material.side = THREE.DoubleSide;
  }
  // --- 腕 ---
  for (let i = 0; i < 2; i++) {
    const A = h.arm[i];
    mesh(cylY(d.armUp, 0.062 * S, 0.075 * S, 12), cloth, A.up);                  // 袖(広がる)
    mesh(new THREE.SphereGeometry(0.066 * S, 10, 8), clothD, A.up, 0, d.armUp, 0);
    mesh(cylY(d.armLow, 0.058 * S, 0.047 * S, 12), clothD, A.lo);
    mesh(cylY(d.armLow * 0.7, 0.062 * S, 0.052 * S, 12), steel, A.lo, 0, d.armLow * 0.25, 0); // 籠手
    mesh(new THREE.SphereGeometry(0.048 * S, 10, 8), mat({ color: 0x15151c, roughness: 0.6 }), A.hand);                 // 手
  }
  // --- 頭 ---
  const neck = mesh(new THREE.CylinderGeometry(0.05 * S, 0.06 * S, d.neck + 0.03 * S, 10), skin, h.neckG, 0, d.neck / 2, 0);
  void neck;
  mesh(new THREE.SphereGeometry(d.headR, 24, 18), skin, h.head, 0, d.headR * 1.0, 0).scale.set(0.95, 1.1, 1.0);
  // 口元の覆面
  const mask = mesh(new THREE.SphereGeometry(d.headR * 1.04, 24, 12, 0, Math.PI * 2, Math.PI * 0.55, Math.PI * 0.35), clothD, h.head, 0, d.headR * 1.0, 0.004); mask.scale.set(0.97, 1.1, 1.02);
  // 髪・まげ・鉢巻き
  const hairCap = mesh(new THREE.SphereGeometry(d.headR * 1.07, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.62), hair, h.head, 0, d.headR * 1.04, -0.012 * S); hairCap.scale.set(0.98, 1.1, 1.05);
  const knot = mesh(new THREE.SphereGeometry(0.04 * S, 12, 10), hair, h.head, 0, d.headR * 2.0, -d.headR * 0.9); knot.scale.set(1, 0.8, 1.3);
  mesh(new THREE.CylinderGeometry(0.014 * S, 0.02 * S, 0.14 * S, 8), hair, h.head, 0, d.headR * 2.15, -d.headR * 1.4).rotation.x = -1.0;
  const band = mesh(new THREE.TorusGeometry(d.headR * 1.01, 0.012 * S, 6, 24), clothR, h.head, 0, d.headR * 1.35, 0); band.rotation.x = Math.PI / 2 + 0.12; band.scale.set(0.97, 1.08, 1);
  for (const sx of [-1, 1]) { // 目
    const eye = mesh(new THREE.SphereGeometry(0.014 * S, 8, 6), mat({ color: 0x08080a, roughness: 0.2 }), h.head, sx * d.headR * 0.38, d.headR * 1.12, d.headR * 0.93); eye.scale.set(1.4, 0.7, 0.6);
  }
  // --- 襟巻き(赤い布)---
  const scarfRing = mesh(new THREE.TorusGeometry(0.085 * S, 0.028 * S, 8, 16), clothR, h.neckG, 0, 0.03 * S, 0); scarfRing.rotation.x = Math.PI / 2;
  h.cloths = [];
  const sc = new Cloth(0.13 * S, 0.62 * S, 4, 10, clothR);
  sc.mesh.position.set(0, 0.02 * S, -0.09 * S); h.neckG.add(sc.mesh); h.cloths.push(sc);
  const sc2 = new Cloth(0.09 * S, 0.45 * S, 3, 8, clothR);
  sc2.mesh.position.set(0.07 * S, 0.0, -0.085 * S); sc2.mesh.rotation.y = 0.4; h.neckG.add(sc2.mesh); h.cloths.push(sc2);
  // --- 武器 ---
  const katana = makeKatana(S);
  h.weapon.add(katana);
  h.blade = katana.userData;
  return h;
}

// ================= ボス =================
export function buildBoss(h) {
  const d = h.dim, S = h.S;
  const iron = mat({ color: 0x1b1c24, metalness: 0.85, roughness: 0.42, envMapIntensity: 1.2 });
  const ironL = mat({ color: 0x2c2e3a, metalness: 0.85, roughness: 0.35, envMapIntensity: 1.3 });
  const lacq = mat({ color: 0x7c1117, metalness: 0.35, roughness: 0.32, envMapIntensity: 1.2 });
  const gold = mat({ color: 0xc9a227, metalness: 1, roughness: 0.28, envMapIntensity: 1.5 });
  const fabric = makeFabric("#4a0d12", 256, [2, 3]);
  const clothR = mat({ map: fabric.map, bumpMap: fabric.bump, bumpScale: 0.8, roughness: 0.85, side: THREE.DoubleSide });
  const dark = makeFabric("#14141a", 256, [3, 3]);
  const clothD = mat({ map: dark.map, bumpMap: dark.bump, bumpScale: 0.8, roughness: 0.9, side: THREE.DoubleSide });
  const bone = mat({ color: 0xe9e2cf, roughness: 0.5 });
  h.glow = mat({ color: 0xff3b1f, emissive: 0xff2a10, emissiveIntensity: 2.2, roughness: 0.4 });

  // --- 脚(重い脛当て) ---
  for (let i = 0; i < 2; i++) {
    const L = h.leg[i];
    mesh(cylY(d.legUp, 0.125 * S, 0.1 * S, 14), clothD, L.up);
    mesh(new THREE.BoxGeometry(0.17 * S, d.legUp * 0.55, 0.05 * S), iron, L.up, 0, d.legUp * 0.5, 0.075 * S);   // 佩楯
    mesh(new THREE.SphereGeometry(0.1 * S, 12, 10), ironL, L.up, 0, d.legUp, 0.02 * S);                          // 膝当て
    mesh(cylY(d.legLow, 0.095 * S, 0.075 * S, 14), iron, L.lo);
    mesh(new THREE.BoxGeometry(0.13 * S, d.legLow * 0.7, 0.045 * S), ironL, L.lo, 0, d.legLow * 0.45, 0.06 * S);
    mesh(new THREE.TorusGeometry(0.085 * S, 0.012 * S, 6, 16), gold, L.lo, 0, d.legLow * 0.8, 0).rotation.x = Math.PI / 2;
    const F = h.foot[i];
    mesh(new THREE.BoxGeometry(0.13 * S, 0.08 * S, 0.3 * S), iron, F, 0, 0.05 * S, 0.07 * S);
    mesh(new THREE.BoxGeometry(0.135 * S, 0.025 * S, 0.31 * S), ironL, F, 0, 0.012 * S, 0.07 * S);
  }
  // --- 腰回り(草摺) ---
  mesh(new THREE.CylinderGeometry(0.2 * S, 0.22 * S, 0.14 * S, 20), clothD, h.pelvis, 0, 0, 0).scale.z = 0.8;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const pl = mesh(new THREE.BoxGeometry(0.15 * S, 0.3 * S, 0.02 * S), k % 2 ? iron : ironL, h.pelvis, Math.sin(a) * 0.23 * S, -0.1 * S, Math.cos(a) * 0.19 * S);
    pl.rotation.y = a; pl.rotation.x = 0.18;
    mesh(new THREE.BoxGeometry(0.15 * S, 0.015 * S, 0.03 * S), gold, pl, 0, -0.14 * S, 0.005);
    mesh(new THREE.BoxGeometry(0.02 * S, 0.28 * S, 0.026 * S), lacq, pl, 0, 0, 0.004);
  }
  mesh(new THREE.CylinderGeometry(0.215 * S, 0.215 * S, 0.06 * S, 22), lacq, h.pelvis, 0, 0.1 * S, 0).scale.z = 0.8;
  const emblem = mesh(new THREE.SphereGeometry(0.05 * S, 12, 10), bone, h.pelvis, 0, 0.1 * S, 0.19 * S); emblem.scale.set(1, 1.2, 0.7);
  // --- 胴(大鎧) ---
  const chest = mesh(new THREE.SphereGeometry(0.26 * S, 24, 18), iron, h.torso, 0, d.torsoLen * 0.6, 0); chest.scale.set(1.05, 1.2, 0.78);
  mesh(new THREE.CylinderGeometry(0.22 * S, 0.19 * S, d.torsoLen * 0.5, 20), clothD, h.torso, 0, d.torsoLen * 0.2, 0).scale.z = 0.75;
  for (let k = 0; k < 5; k++) { // 胴の縅(おどし)
    const b = mesh(new THREE.BoxGeometry(0.4 * S, 0.035 * S, 0.06 * S), k % 2 ? lacq : ironL, h.torso, 0, (0.15 + k * 0.095) * S, 0.185 * S - Math.abs(k - 2) * 0.012 * S);
    b.rotation.x = -0.1 + k * 0.02;
  }
  mesh(new THREE.TorusGeometry(0.075 * S, 0.012 * S, 8, 20), gold, h.torso, 0, d.torsoLen * 0.75, 0.205 * S);
  for (const sx of [-1, 1]) { // 大袖(肩)
    for (let k = 0; k < 4; k++) {
      const plate = mesh(new THREE.CylinderGeometry((0.2 - k * 0.012) * S, (0.2 - k * 0.012) * S, 0.17 * S, 14, 1, true, 0, Math.PI), k % 2 ? iron : ironL, h.torso, sx * (d.shoulderW + 0.03 * S), (d.shoulderY + 0.09 - k * 0.075) * S / S * 1, 0);
      plate.material = plate.material.clone(); plate.material.side = THREE.DoubleSide;
      plate.rotation.set(0, sx > 0 ? 0 : Math.PI, Math.PI / 2); plate.rotation.y += sx * 0.1;
      plate.position.y = d.shoulderY + 0.07 * S - k * 0.065 * S;
      mesh(new THREE.BoxGeometry(0.01 * S, 0.01 * S, 0.17 * S), gold, plate, 0.2 * S * 0, 0.001, 0).visible = false;
    }
    mesh(new THREE.SphereGeometry(0.095 * S, 14, 10), ironL, h.torso, sx * d.shoulderW, d.shoulderY + 0.02 * S, 0);
  }
  // --- 腕 ---
  for (let i = 0; i < 2; i++) {
    const A = h.arm[i];
    mesh(cylY(d.armUp, 0.075 * S, 0.088 * S, 12), clothD, A.up);
    mesh(new THREE.SphereGeometry(0.075 * S, 10, 8), iron, A.up, 0, d.armUp, 0);
    mesh(cylY(d.armLow, 0.075 * S, 0.06 * S, 12), iron, A.lo);
    mesh(cylY(d.armLow * 0.8, 0.085 * S, 0.07 * S, 12), ironL, A.lo, 0, d.armLow * 0.2, 0);
    mesh(new THREE.TorusGeometry(0.075 * S, 0.012 * S, 6, 16), gold, A.lo, 0, d.armLow * 0.2, 0).rotation.x = Math.PI / 2;
    mesh(new THREE.SphereGeometry(0.065 * S, 10, 8), iron, A.hand);
  }
  // --- 頭: 兜 + 鬼面 ---
  mesh(new THREE.CylinderGeometry(0.075 * S, 0.095 * S, d.neck + 0.05 * S, 10), clothD, h.neckG, 0, d.neck / 2, 0);
  const hr = d.headR;
  const face = mesh(new THREE.SphereGeometry(hr, 26, 18), lacq, h.head, 0, hr * 1.0, 0.01 * S); face.scale.set(1.0, 1.05, 1.0);
  // 兜の鉢
  const bowl = mesh(new THREE.SphereGeometry(hr * 1.2, 26, 16, 0, Math.PI * 2, 0, Math.PI * 0.52), iron, h.head, 0, hr * 1.15, -0.01 * S); bowl.scale.set(1, 1.0, 1.08);
  // 錣(しころ)
  for (let k = 0; k < 4; k++) {
    const sk = mesh(new THREE.CylinderGeometry((hr * 1.25 + k * 0.045 * S), (hr * 1.3 + k * 0.05 * S), 0.04 * S, 22, 1, true, Math.PI * 0.35, Math.PI * 1.3), k % 2 ? lacq : iron, h.head, 0, hr * 0.9 - k * 0.035 * S, -0.02 * S);
    sk.material = sk.material.clone(); sk.material.side = THREE.DoubleSide;
  }
  // 前立て(三日月)
  const crest = mesh(new THREE.TorusGeometry(hr * 1.45, 0.016 * S, 8, 28, Math.PI * 1.05), gold, h.head, 0, hr * 2.15, hr * 0.2);
  crest.rotation.z = Math.PI * 0.5 - Math.PI * 0.525;
  // 角
  for (const sx of [-1, 1]) {
    const horn = mesh(new THREE.ConeGeometry(0.03 * S, 0.3 * S, 10), bone, h.head, sx * hr * 0.7, hr * 1.95, hr * 0.7);
    horn.rotation.set(0.5, 0, -sx * 0.5);
    const horn2 = mesh(new THREE.ConeGeometry(0.02 * S, 0.14 * S, 8), bone, h.head, sx * hr * 1.05, hr * 2.35, hr * 0.9); horn2.rotation.set(0.35, 0, -sx * 0.3);
  }
  // 眉・目(発光)・牙・髭
  for (const sx of [-1, 1]) {
    const brow = mesh(new THREE.BoxGeometry(hr * 0.7, hr * 0.14, hr * 0.2), iron, h.head, sx * hr * 0.42, hr * 1.25, hr * 0.88); brow.rotation.z = -sx * 0.4;
    mesh(new THREE.SphereGeometry(hr * 0.15, 10, 8), h.glow, h.head, sx * hr * 0.4, hr * 1.08, hr * 0.9).scale.set(1.4, 0.65, 0.7);
  }
  const jaw = mesh(new THREE.BoxGeometry(hr * 1.2, hr * 0.5, hr * 0.5), ironL, h.head, 0, hr * 0.45, hr * 0.78); jaw.rotation.x = 0.1;
  for (const sx of [-1, 1]) mesh(new THREE.ConeGeometry(hr * 0.09, hr * 0.5, 8), bone, h.head, sx * hr * 0.32, hr * 0.62, hr * 1.02).rotation.x = Math.PI;
  const beard = new Cloth(0.2 * S, 0.5 * S, 3, 6, mat({ color: 0xcfcfd6, roughness: 0.7, side: THREE.DoubleSide }));
  beard.mesh.position.set(0, hr * 0.5, hr * 0.7); h.head.add(beard.mesh);
  h.cloths = [beard];
  // --- 背旗(指物)と外套 ---
  const pole = mesh(new THREE.CylinderGeometry(0.014 * S, 0.014 * S, 1.5 * S, 8), mat({ color: 0x2a1c12, roughness: 0.6 }), h.torso, 0.1 * S, d.torsoLen * 0.9 + 0.3 * S, -0.26 * S);
  pole.rotation.z = 0.05;
  const banner = new Cloth(0.55 * S, 1.15 * S, 5, 12, clothR);
  banner.flip = true; banner.mesh.position.set(0.1 * S, d.torsoLen * 0.9 + 0.95 * S, -0.27 * S); banner.mesh.rotation.y = Math.PI;
  h.torso.add(banner.mesh); h.cloths.push(banner);
  mesh(new THREE.CircleGeometry(0.11 * S, 20), bone, banner.mesh, 0, -0.4 * S, 0.003).scale.set(1, 1, 1);
  const cape = new Cloth(0.5 * S, 0.9 * S, 5, 9, clothD);
  cape.flip = true; cape.mesh.position.set(0, d.shoulderY - 0.02 * S, -0.2 * S); cape.mesh.rotation.y = Math.PI; h.torso.add(cape.mesh); h.cloths.push(cape);
  // --- 大太刀 ---
  const katana = makeKatana(S, { len: 1.28, wid: 0.06, thick: 0.017, handle: 0.5, gold: 0xc9a227, wrap: "#3a0c10", emissive: 0xff2a10, curve: 0.03, color: 0xcfd6e4 });
  h.weapon.add(katana);
  h.gripL.position.set(0, -0.27 * S, 0);
  h.blade = katana.userData;
  // 刀身の魔力の筋(第2形態で発光)
  const runeMat = mat({ color: 0xff3b1f, emissive: 0xff3b1f, emissiveIntensity: 0, roughness: 0.4 });
  const rune = mesh(new THREE.BoxGeometry(0.004 * S, 1.0 * S, 0.008 * S), runeMat, katana, 0, 0.11 * S + 0.65 * S, 0.0);
  rune.castShadow = false;
  h.runeMat = runeMat;
  return h;
}
