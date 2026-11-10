// 演出: 火花・衝撃波リング・剣の軌跡・煙。加算合成+ブルームで光らせる。
import * as THREE from "../../vendor/three/three.module.js";
import { makeGlow, makeRing, makeSmoke } from "./textures.js";

export class Particles {
  // ビルボード・インスタンス粒子(加算合成)
  constructor(scene, max = 600, tex = makeGlow(64), additive = true) {
    this.max = max;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, fog: !additive, vertexColors: false });
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, max);
    this.mesh.frustumCulled = false; this.mesh.count = 0;
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    scene.add(this.mesh);
    this.p = [];
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3(); this._pos = new THREE.Vector3(); this._c = new THREE.Color();
  }
  spawn(pos, vel, { life = 0.5, size = 0.12, color = 0xffffff, grow = 0, g = 0, drag = 0, fade = 1 } = {}) {
    if (this.p.length >= this.max) this.p.shift();
    this.p.push({ x: pos.x, y: pos.y, z: pos.z, vx: vel.x, vy: vel.y, vz: vel.z, life, max: life, size, color: new THREE.Color(color), grow, g, drag, fade });
  }
  burst(pos, n, { speed = 4, spread = 1, up = 0.3, life = 0.5, size = 0.1, color = 0xffd9a0, g = 6, drag = 0.6, dir = null } = {}) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, e = (Math.random() - 0.3) * Math.PI * spread;
      const sp = speed * (0.35 + Math.random() * 0.75);
      const v = new THREE.Vector3(Math.cos(a) * Math.cos(e), Math.sin(e) + up, Math.sin(a) * Math.cos(e)).multiplyScalar(sp);
      if (dir) v.addScaledVector(dir, speed * 0.5);
      this.spawn(pos, v, { life: life * (0.6 + Math.random() * 0.8), size: size * (0.5 + Math.random()), color, g, drag });
    }
  }
  update(dt, camera) {
    const arr = this.p;
    let n = 0;
    for (let i = arr.length - 1; i >= 0; i--) {
      const p = arr[i];
      p.life -= dt;
      if (p.life <= 0) { arr.splice(i, 1); continue; }
    }
    for (const p of arr) {
      p.vy -= p.g * dt;
      const dr = Math.max(0, 1 - p.drag * dt);
      p.vx *= dr; p.vy *= dr; p.vz *= dr;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < 0.02 && p.g > 0) { p.y = 0.02; p.vy *= -0.3; }
      const k = p.life / p.max;
      const sz = (p.size + p.grow * (1 - k)) * (p.fade ? Math.min(1, k * 2.2) : 1);
      this._pos.set(p.x, p.y, p.z); this._s.set(sz, sz, sz);
      this._m.compose(this._pos, camera.quaternion, this._s);
      this.mesh.setMatrixAt(n, this._m);
      this._c.copy(p.color).multiplyScalar(this.mesh.material.blending === THREE.AdditiveBlending ? Math.min(1, k * 1.8) : 1);
      this.mesh.instanceColor.setXYZ(n, this._c.r, this._c.g, this._c.b);
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true; this.mesh.instanceColor.needsUpdate = true;
  }
}

export class Rings {
  constructor(scene, max = 8) {
    this.tex = makeRing(256);
    this.items = [];
    this.group = new THREE.Group(); scene.add(this.group);
    this.max = max;
  }
  spawn(pos, { color = 0xffffff, size = 3.2, life = 0.38, facing = null } = {}) {
    const mat = new THREE.MeshBasicMaterial({ map: this.tex, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    m.position.copy(pos); this.group.add(m);
    this.items.push({ m, life, max: life, size, facing });
    if (this.items.length > this.max) { const o = this.items.shift(); this.group.remove(o.m); o.m.material.dispose(); o.m.geometry.dispose(); }
  }
  update(dt, camera) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const r = this.items[i];
      r.life -= dt;
      if (r.life <= 0) { this.group.remove(r.m); r.m.material.dispose(); r.m.geometry.dispose(); this.items.splice(i, 1); continue; }
      const k = 1 - r.life / r.max;
      const s = r.size * (0.15 + 0.85 * Math.sqrt(k));
      r.m.scale.setScalar(s);
      r.m.material.opacity = (1 - k) * (1 - k);
      if (r.facing) r.m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), r.facing); else r.m.quaternion.copy(camera.quaternion);
    }
  }
}

// 剣の軌跡リボン
export class Trail {
  constructor(scene, n = 22, color = 0xbfd8ff, gain = 1) {
    this.gain = gain;
    this.n = n;
    this.pts = [];
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 2 * 3); this.col = new Float32Array(n * 2 * 3);
    geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(this.col, 3));
    const idx = [];
    for (let i = 0; i < n - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    geo.setIndex(idx);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    this.mesh.frustumCulled = false; scene.add(this.mesh);
    this.color = new THREE.Color(color);
    this.active = 0;
  }
  setColor(c) { this.color.set(c); }
  // base/tip: ワールド座標。active が真の間に点を追加
  push(base, tip, on) {
    if (on) this.pts.unshift({ a: base.clone(), b: tip.clone(), age: 0 });
    else if (this.pts.length) this.pts.unshift(null);
    if (this.pts.length > this.n) this.pts.length = this.n;
  }
  update(dt) {
    const pts = this.pts;
    for (const p of pts) if (p) p.age += dt;
    // 古い点を捨てる
    while (pts.length && (pts[pts.length - 1] === null || pts[pts.length - 1].age > 0.2)) pts.pop();
    const n = this.n;
    let last = null;
    for (let i = 0; i < n; i++) {
      let p = pts[i];
      if (!p) p = last;
      if (!p) { this.pos.fill(0, i * 6, i * 6 + 6); this.col.fill(0, i * 6, i * 6 + 6); continue; }
      last = p;
      const k = Math.max(0, 1 - p.age / 0.2) * (1 - i / n);
      this.pos[i * 6] = p.a.x; this.pos[i * 6 + 1] = p.a.y; this.pos[i * 6 + 2] = p.a.z;
      this.pos[i * 6 + 3] = p.b.x; this.pos[i * 6 + 4] = p.b.y; this.pos[i * 6 + 5] = p.b.z;
      const kk = k * k * this.gain;
      this.col[i * 6] = this.color.r * kk * 0.35; this.col[i * 6 + 1] = this.color.g * kk * 0.35; this.col[i * 6 + 2] = this.color.b * kk * 0.35;
      this.col[i * 6 + 3] = this.color.r * kk * 1.5; this.col[i * 6 + 4] = this.color.g * kk * 1.5; this.col[i * 6 + 5] = this.color.b * kk * 1.5;
    }
    this.mesh.geometry.attributes.position.needsUpdate = true; this.mesh.geometry.attributes.color.needsUpdate = true;
    this.mesh.visible = pts.length > 1;
  }
}

// ボスのオーラ(煙)
export class Aura {
  constructor(scene, max = 120) {
    this.sys = new Particles(scene, max, makeSmoke(128), true);
    this.on = false; this.acc = 0;
  }
  update(dt, camera, bossPos, active, color = 0xff2a10) {
    this.on = active;
    if (active) {
      this.acc += dt * 50;
      while (this.acc >= 1) {
        this.acc -= 1;
        const a = Math.random() * Math.PI * 2, r = 0.5 + Math.random() * 0.7;
        this.sys.spawn(new THREE.Vector3(bossPos.x + Math.cos(a) * r, 0.1 + Math.random() * 1.4, bossPos.z + Math.sin(a) * r),
          new THREE.Vector3((Math.random() - 0.5) * 0.4, 0.8 + Math.random() * 1.1, (Math.random() - 0.5) * 0.4), { life: 1.2, size: 0.55, color, grow: 0.9 });
      }
    }
    this.sys.update(dt, camera);
  }
}
