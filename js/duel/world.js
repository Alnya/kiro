// 舞台: 月夜の神社の境内。夜空シェーダー、石畳、鳥居、灯籠、桜、杉林、霧、花びら、蛍。
import * as THREE from "../../vendor/three/three.module.js";
import { makeStone, makeMist, makePetal, makeGlow, makeSmoke, makeWood, fbm } from "./textures.js";

export const MOON_DIR = new THREE.Vector3(-0.28, 0.44, -0.85).normalize();
const FOG_COLOR = 0x0d1424;

const skyVert = `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
const skyFrag = `
varying vec3 vDir; uniform vec3 uMoon; uniform float uTime;
float h21(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
float n2(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y); }
float fbm2(vec2 p){ float v=0.0,a=0.5; for(int i=0;i<4;i++){ v+=a*n2(p); p*=2.03; a*=0.5; } return v; }
void main(){
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 horizon = vec3(0.16,0.22,0.38), mid = vec3(0.05,0.08,0.18), zenith = vec3(0.012,0.02,0.07);
  vec3 col = mix(horizon, mid, smoothstep(0.0, 0.25, h));
  col = mix(col, zenith, smoothstep(0.15, 0.9, h));
  col = mix(col*0.5, col, smoothstep(-0.25, 0.02, h));
  // 星
  vec2 sp = d.xz/(abs(d.y)+0.35)*220.0;
  float s = h21(floor(sp));
  float star = step(0.9965, s) * smoothstep(0.0,0.2,h) * (0.6+0.4*sin(uTime*2.0+s*50.0));
  col += vec3(star);
  // 雲
  vec2 cp = d.xz/(d.y+0.25)*1.3 + vec2(uTime*0.004, 0.0);
  float c = smoothstep(0.52, 0.85, fbm2(cp*1.7));
  float md = max(dot(d, uMoon), 0.0);
  col = mix(col, vec3(0.10,0.13,0.22) + vec3(0.5,0.6,0.85)*pow(md,6.0)*0.35, c*0.55*smoothstep(0.0,0.15,h));
  // 月
  float disc = smoothstep(0.99935, 0.99965, md);
  float crater = 0.85 + 0.15*fbm2(d.xz*90.0 + d.y*40.0);
  col += vec3(1.0,0.97,0.88)*disc*crater*3.2;
  col += vec3(0.55,0.65,0.95)*pow(md,260.0)*1.2 + vec3(0.25,0.35,0.7)*pow(md,22.0)*0.5 + vec3(0.1,0.15,0.3)*pow(md,4.0)*0.25;
  gl_FragColor = vec4(col, 1.0);
}`;

function bell(x) { return Math.exp(-x * x); }

export function buildWorld(renderer, scene, quality) {
  const Q = quality; // {shadow, shadowSize, trees, particles, mist}
  const world = { flicker: [], t: 0 };
  scene.fog = new THREE.FogExp2(FOG_COLOR, 0.0165);
  scene.background = new THREE.Color(FOG_COLOR);

  // ---- 空 ----
  const skyMat = new THREE.ShaderMaterial({ vertexShader: skyVert, fragmentShader: skyFrag, side: THREE.BackSide, depthWrite: false, fog: false, uniforms: { uMoon: { value: MOON_DIR }, uTime: { value: 0 } } });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(400, 48, 32), skyMat);
  sky.renderOrder = -10; sky.frustumCulled = false;
  scene.add(sky);
  world.sky = sky; world.skyMat = skyMat;

  // ---- 環境マップ(PBR反射用): 空だけを一度PMREM化 ----
  try {
    const pm = new THREE.PMREMGenerator(renderer);
    const es = new THREE.Scene();
    es.add(new THREE.Mesh(new THREE.SphereGeometry(400, 32, 20), skyMat.clone()));
    const rt = pm.fromScene(es, 0.03);
    scene.environment = rt.texture;
    pm.dispose();
  } catch (e) { /* 環境マップなしでも動作 */ }

  // ---- ライト ----
  const hemi = new THREE.HemisphereLight(0x7f9be0, 0x241f2c, 0.8);
  scene.add(hemi);
  const moon = new THREE.DirectionalLight(0xb6ccff, 2.6);
  moon.position.copy(MOON_DIR).multiplyScalar(40);
  moon.castShadow = Q.shadow;
  if (Q.shadow) {
    moon.shadow.mapSize.set(Q.shadowSize, Q.shadowSize);
    const c = moon.shadow.camera; c.left = -12; c.right = 12; c.top = 12; c.bottom = -12; c.near = 5; c.far = 90;
    moon.shadow.bias = -0.0003; moon.shadow.normalBias = 0.035; moon.shadow.radius = 3;
  }
  scene.add(moon); scene.add(moon.target);
  const rim = new THREE.DirectionalLight(0x7a8cff, 0.7); rim.position.set(18, 10, 22); scene.add(rim);
  const warm = new THREE.DirectionalLight(0xffa56a, 0.35); warm.position.set(-14, 6, 18); scene.add(warm);
  const fill = new THREE.DirectionalLight(0x8fa6e8, 0.9); fill.position.set(0, 6, 30); scene.add(fill); scene.add(fill.target);
  world.moon = moon; world.hemi = hemi; world.fill = fill;

  // ---- 地面 ----
  const stone = makeStone(Q.texSize, [7, 7]);
  const arenaMat = new THREE.MeshStandardMaterial({ map: stone.map, bumpMap: stone.bump, bumpScale: 2.2, roughnessMap: stone.rough, roughness: 1, metalness: 0, envMapIntensity: 0.9 });
  const arena = new THREE.Mesh(new THREE.CylinderGeometry(15, 15.4, 0.7, 72), [new THREE.MeshStandardMaterial({ color: 0x24262c, roughness: 0.9 }), arenaMat, new THREE.MeshStandardMaterial({ color: 0x24262c, roughness: 0.9 })]);
  arena.position.y = -0.35; arena.receiveShadow = true; arena.castShadow = false;
  // 円筒の上面UVを石畳に使う(側面はマテリアル0)
  scene.add(arena);
  // 縁石
  const kerb = new THREE.Mesh(new THREE.TorusGeometry(15.2, 0.32, 10, 96), new THREE.MeshStandardMaterial({ color: 0x3c3f46, roughness: 0.8, bumpMap: stone.bump, bumpScale: 1.2 }));
  kerb.rotation.x = Math.PI / 2; kerb.position.y = 0.02; kerb.receiveShadow = true; kerb.castShadow = true; scene.add(kerb);
  // 外側の地面(苔むした土)
  const gTex = (() => {
    const c = document.createElement("canvas"); c.width = c.height = 512; const x = c.getContext("2d"); const d = x.createImageData(512, 512);
    for (let j = 0; j < 512; j++) for (let i = 0; i < 512; i++) { const n = fbm(i / 60, j / 60, 6, 5), m = fbm(i / 14, j / 14, 9, 3); const k = (j * 512 + i) * 4; const v = 0.55 + n * 0.6; d.data[k] = 24 * v + m * 14; d.data[k + 1] = 38 * v + m * 18; d.data[k + 2] = 26 * v + m * 8; d.data[k + 3] = 255; }
    x.putImageData(d, 0, 0);
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(30, 30); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
  })();
  const ground = new THREE.Mesh(new THREE.CircleGeometry(220, 48), new THREE.MeshStandardMaterial({ map: gTex, roughness: 1, metalness: 0 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.7; ground.receiveShadow = true; scene.add(ground);

  // 水たまり
  const puddleMat = new THREE.MeshStandardMaterial({ color: 0x3a4a6e, roughness: 0.06, metalness: 0.6, envMapIntensity: 3.0, transparent: true, opacity: 0.42, depthWrite: false });
  for (const [x, z, r] of [[-5.5, 3.5, 2.0], [4.5, -4.8, 1.6], [6.5, 6.5, 1.3], [-8, -3, 1.5], [1, 10, 1.2]]) {
    const p = new THREE.Mesh(new THREE.CircleGeometry(r, 28), puddleMat);
    p.rotation.x = -Math.PI / 2; p.position.set(x, 0.013, z); p.scale.set(1, 0.7 + (x * 7 % 3) * 0.1, 1); scene.add(p);
  }

  // ---- 鳥居 ----
  const lacquer = new THREE.MeshStandardMaterial({ color: 0xa3151b, roughness: 0.34, metalness: 0.25, envMapIntensity: 1.3 });
  const blackLq = new THREE.MeshStandardMaterial({ color: 0x0e0e12, roughness: 0.3, metalness: 0.3 });
  const torii = new THREE.Group();
  for (const sx of [-1, 1]) {
    const pil = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 8.4, 20), lacquer); pil.position.set(sx * 4.3, 4.2, 0); pil.castShadow = true; torii.add(pil);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.64, 0.8, 20), blackLq); base.position.set(sx * 4.3, 0.4, 0); torii.add(base);
    const baseStone = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 1.0, 0.5, 12), new THREE.MeshStandardMaterial({ color: 0x4a4c54, roughness: 0.85 })); baseStone.position.set(sx * 4.3, 0.1, 0); torii.add(baseStone);
  }
  const nuki = new THREE.Mesh(new THREE.BoxGeometry(11.4, 0.5, 0.55), lacquer); nuki.position.y = 6.3; nuki.castShadow = true; torii.add(nuki);
  const kasagi = new THREE.Mesh(new THREE.BoxGeometry(14.2, 0.62, 0.95), blackLq); kasagi.position.y = 8.55; kasagi.castShadow = true; torii.add(kasagi);
  const shimaki = new THREE.Mesh(new THREE.BoxGeometry(12.6, 0.5, 0.8), lacquer); shimaki.position.y = 8.0; torii.add(shimaki);
  for (const sx of [-1, 1]) { const tip = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.62, 0.95), blackLq); tip.position.set(sx * 7.5, 8.82, 0); tip.rotation.z = sx * 0.28; torii.add(tip); }
  const plaque = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.7, 0.2), new THREE.MeshStandardMaterial({ color: 0x15151a, roughness: 0.5 })); plaque.position.set(0, 7.15, 0.05); torii.add(plaque);
  torii.position.set(0, 0, -21); scene.add(torii);
  world.torii = torii;
  // 参道の石段と奥の社(シルエット)
  const stairMat = new THREE.MeshStandardMaterial({ color: 0x3a3c44, roughness: 0.9, bumpMap: stone.bump, bumpScale: 1 });
  for (let i = 0; i < 6; i++) { const st = new THREE.Mesh(new THREE.BoxGeometry(8.5 - i * 0.2, 0.3, 2.2), stairMat); st.position.set(0, 0.15 + i * 0.3, -17.8 - i * 2.0 - 3.3 - 3.5); st.receiveShadow = true; scene.add(st); }
  const pagoda = new THREE.Group();
  const wallM = new THREE.MeshStandardMaterial({ color: 0x1a1214, roughness: 0.8 });
  const roofM = new THREE.MeshStandardMaterial({ color: 0x15171d, roughness: 0.6, metalness: 0.2 });
  const winM = new THREE.MeshStandardMaterial({ color: 0xffb060, emissive: 0xff8a30, emissiveIntensity: 1.2 });
  for (let i = 0; i < 4; i++) {
    const w = 9 - i * 1.5;
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, 2.6, w), wallM); b.position.y = 1.3 + i * 4.6; pagoda.add(b);
    const r = new THREE.Mesh(new THREE.ConeGeometry(w * 1.05, 2.2, 4), roofM); r.rotation.y = Math.PI / 4; r.position.y = 3.7 + i * 4.6; pagoda.add(r);
    const win = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.3, 1.1), winM); win.position.set(0, 1.4 + i * 4.6, w / 2 + 0.01); pagoda.add(win);
  }
  const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.14, 4, 8), roofM); spire.position.y = 19.5; pagoda.add(spire);
  pagoda.position.set(-4, 3.3, -56); scene.add(pagoda);

  // ---- 灯籠 ----
  const stoneM = new THREE.MeshStandardMaterial({ color: 0x5a5d66, roughness: 0.85, bumpMap: stone.bump, bumpScale: 1.5 });
  const flameM = new THREE.MeshStandardMaterial({ color: 0xffd9a0, emissive: 0xffa04a, emissiveIntensity: 3.2 });
  const glowTex = makeGlow(128);
  const lanternPos = [[-11, 5, 0.6], [11.5, 3, -0.4], [-9.5, -9, 0.2], [10, -10.5, 0.9]];
  lanternPos.forEach(([x, z, ph], idx) => {
    const g = new THREE.Group();
    const mk = (geo, y, m = stoneM) => { const o = new THREE.Mesh(geo, m); o.position.y = y; o.castShadow = true; o.receiveShadow = true; g.add(o); return o; };
    mk(new THREE.CylinderGeometry(0.55, 0.65, 0.25, 8), 0.12);
    mk(new THREE.CylinderGeometry(0.18, 0.2, 1.5, 8), 1.0);
    mk(new THREE.CylinderGeometry(0.5, 0.35, 0.18, 8), 1.82);
    const box = mk(new THREE.BoxGeometry(0.62, 0.6, 0.62), 2.2, stoneM);
    const fl = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.4, 0.66), flameM); fl.position.y = 2.2; g.add(fl);
    const fl2 = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.4, 0.34), flameM); fl2.position.y = 2.2; g.add(fl2);
    mk(new THREE.ConeGeometry(0.85, 0.55, 8), 2.78);
    mk(new THREE.SphereGeometry(0.14, 8, 6), 3.15);
    void box;
    g.position.set(x, 0, z);
    scene.add(g);
    const light = new THREE.PointLight(0xffa458, 28, 17, 2);
    light.position.set(x, 2.3, z); scene.add(light);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffa052, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.7, fog: false }));
    spr.scale.set(2.4, 2.4, 1); spr.position.set(x, 2.3, z); scene.add(spr);
    world.flicker.push({ light, spr, base: 28, ph: ph + idx });
  });

  // ---- 木々・山・竹 ----
  const rnd = (() => { let s = 12345; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); })();
  const treeCount = Q.trees;
  const trunkG = new THREE.CylinderGeometry(0.28, 0.45, 5, 7); trunkG.translate(0, 2.5, 0);
  const trunks = new THREE.InstancedMesh(trunkG, new THREE.MeshStandardMaterial({ color: 0x2a1d17, roughness: 0.95 }), treeCount);
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x0f2418, roughness: 0.9, flatShading: true });
  const cones = [0, 1, 2].map((k) => { const g = new THREE.ConeGeometry(2.6 - k * 0.55, 3.6, 8); g.translate(0, 5 + k * 2.1, 0); return new THREE.InstancedMesh(g, leafMat, treeCount); });
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pp = new THREE.Vector3();
  for (let i = 0; i < treeCount; i++) {
    const a = rnd() * Math.PI * 2, r = 26 + rnd() * 70;
    if (Math.abs(a - Math.PI * 1.5) < 0.2 && r < 50) { i--; continue; } // 鳥居の奥の道をあける
    const s = 0.8 + rnd() * 1.5;
    pp.set(Math.cos(a) * r, -0.7, Math.sin(a) * r); q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6.28); sc.set(s, s * (0.9 + rnd() * 0.5), s);
    m4.compose(pp, q, sc);
    trunks.setMatrixAt(i, m4); cones.forEach((c) => c.setMatrixAt(i, m4));
  }
  [trunks, ...cones].forEach((m) => { m.castShadow = false; scene.add(m); });
  // 遠景の山
  const mtnMat = new THREE.MeshBasicMaterial({ color: 0x0b1322, fog: true });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + 0.2, r = 150 + (i % 3) * 20;
    const h = 40 + ((i * 37) % 30);
    const m = new THREE.Mesh(new THREE.ConeGeometry(36 + (i % 4) * 8, h, 7), mtnMat);
    m.position.set(Math.cos(a) * r, h / 2 - 2, Math.sin(a) * r); m.rotation.y = i; scene.add(m);
  }

  // ---- 桜の大木 ----
  const sakura = new THREE.Group();
  const barkM = new THREE.MeshStandardMaterial({ color: 0x2b1c17, roughness: 0.95 });
  const trunkCurve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.6, 2.2, 0.2), new THREE.Vector3(-0.3, 4.4, -0.2), new THREE.Vector3(0.5, 6.2, 0.4)]);
  const tr = new THREE.Mesh(new THREE.TubeGeometry(trunkCurve, 18, 0.62, 10, false), barkM); tr.castShadow = true; sakura.add(tr);
  const branches = [[[0.4, 4.6, 0], [3.2, 6.4, 1.0], [5.6, 7.0, 1.4]], [[-0.1, 5, 0], [-3.0, 6.8, -0.6], [-5.0, 7.4, -0.2]], [[0.4, 5.8, 0.3], [1.0, 8.0, -1.8], [2.2, 9.4, -2.4]], [[0.2, 4, 0], [2.2, 4.9, -2.0], [4.0, 5.9, -3.1]]];
  for (const b of branches) {
    const c = new THREE.CatmullRomCurve3(b.map((v) => new THREE.Vector3(...v)));
    const m = new THREE.Mesh(new THREE.TubeGeometry(c, 14, 0.2, 8, false), barkM); m.castShadow = true; sakura.add(m);
  }
  const bloomMat = new THREE.MeshStandardMaterial({ color: 0xffc3d6, emissive: 0xff7aa8, emissiveIntensity: 0.28, roughness: 0.8, flatShading: true });
  const nB = Q.blossoms;
  const bl = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.55, 0), bloomMat, nB);
  for (let i = 0; i < nB; i++) {
    const b = branches[i % branches.length];
    const t = rnd(); const a = new THREE.Vector3(...b[1]).lerp(new THREE.Vector3(...b[2]), t);
    pp.set(a.x + (rnd() - 0.5) * 3.6, a.y + (rnd() - 0.2) * 2.4, a.z + (rnd() - 0.5) * 3.6);
    const s = 0.7 + rnd() * 1.1; sc.set(s, s * 0.8, s);
    q.setFromEuler(new THREE.Euler(rnd() * 3, rnd() * 3, rnd() * 3)); m4.compose(pp, q, sc); bl.setMatrixAt(i, m4);
  }
  bl.castShadow = false; sakura.add(bl);
  sakura.position.set(23, 0, -19); sakura.scale.setScalar(1.7); scene.add(sakura);
  world.sakura = sakura;

  // ---- 霧 ----
  const mistTex = makeMist(256);
  world.mists = [];
  for (let i = 0; i < Q.mist; i++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(34, 34), new THREE.MeshBasicMaterial({ map: mistTex, color: 0x6f86b8, transparent: true, opacity: 0.20, depthWrite: false, fog: false }));
    m.rotation.x = -Math.PI / 2; m.position.set((rnd() - 0.5) * 30, 0.25 + i * 0.35, (rnd() - 0.5) * 26); m.userData = { sp: 0.15 + rnd() * 0.25, ph: rnd() * 6 };
    scene.add(m); world.mists.push(m);
  }

  // ---- 花びら ----
  const petalTex = makePetal(64);
  const nP = Q.petals;
  const petalGeo = new THREE.PlaneGeometry(0.16, 0.16);
  const petals = new THREE.InstancedMesh(petalGeo, new THREE.MeshBasicMaterial({ map: petalTex, transparent: true, side: THREE.DoubleSide, depthWrite: false, alphaTest: 0.02, fog: true }), nP);
  petals.frustumCulled = false;
  const pdata = [];
  for (let i = 0; i < nP; i++) pdata.push({ x: (rnd() - 0.2) * 40, y: rnd() * 12, z: (rnd() - 0.5) * 40, vx: -0.35 - rnd() * 0.6, vy: -(0.35 + rnd() * 0.5), ph: rnd() * 6, rs: 1 + rnd() * 3 });
  scene.add(petals);
  world.petals = { mesh: petals, data: pdata };

  // ---- 蛍・火の粉 ----
  const nF = Q.fireflies;
  const ffGeo = new THREE.BufferGeometry();
  const ffPos = new Float32Array(nF * 3), ffPh = new Float32Array(nF);
  for (let i = 0; i < nF; i++) { const a = rnd() * Math.PI * 2, rr = 9 + rnd() * 16; ffPos[i * 3] = Math.cos(a) * rr; ffPos[i * 3 + 1] = 0.4 + rnd() * 4; ffPos[i * 3 + 2] = Math.sin(a) * rr - 4; ffPh[i] = rnd() * 6; }
  ffGeo.setAttribute("position", new THREE.BufferAttribute(ffPos, 3));
  const ff = new THREE.Points(ffGeo, new THREE.PointsMaterial({ map: glowTex, color: 0xc8ff8a, size: 0.13, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true, opacity: 0.9 }));
  ff.frustumCulled = false; scene.add(ff);
  world.fireflies = { pts: ff, base: ffPos.slice(), ph: ffPh };

  world.update = function (dt, focus, camera) {
    this.t += dt;
    const t = this.t;
    skyMat.uniforms.uTime.value = t;
    // 月の影を注視点に追従
    moon.target.position.set(focus.x, 0, focus.z);
    moon.position.set(focus.x, 0, focus.z).addScaledVector(MOON_DIR, 40);
    if (camera) { this.fill.position.copy(camera.position).add(new THREE.Vector3(0, 4, 0)); this.fill.target.position.set(focus.x, 1, focus.z); }
    for (const f of this.flicker) {
      const k = 0.82 + 0.12 * Math.sin(t * 9 + f.ph * 3) + 0.08 * Math.sin(t * 23 + f.ph) + 0.05 * Math.sin(t * 41 + f.ph * 7);
      f.light.intensity = f.base * k; f.spr.material.opacity = 0.5 + 0.2 * k; f.spr.scale.setScalar(2.2 + 0.4 * k);
    }
    for (const m of this.mists) { m.position.x += Math.sin(t * 0.1 + m.userData.ph) * 0.004 + m.userData.sp * dt * 0.1; if (m.position.x > 20) m.position.x = -20; m.material.opacity = 0.14 + 0.08 * Math.sin(t * 0.3 + m.userData.ph); }
    // 花びら
    const P = this.petals;
    for (let i = 0; i < P.data.length; i++) {
      const d = P.data[i];
      d.x += (d.vx + Math.sin(t * 0.8 + d.ph) * 0.4) * dt; d.y += d.vy * dt; d.z += Math.cos(t * 0.6 + d.ph) * 0.3 * dt;
      if (d.y < 0.05) { d.y = 8 + Math.random() * 6; d.x = 10 + (Math.random() - 0.5) * 30; d.z = (Math.random() - 0.5) * 36; }
      if (d.x < -24) d.x = 24;
      q.setFromEuler(new THREE.Euler(t * d.rs + d.ph, t * d.rs * 0.7, t * d.rs * 0.4));
      pp.set(d.x, d.y, d.z); sc.setScalar(1); m4.compose(pp, q, sc); P.mesh.setMatrixAt(i, m4);
    }
    P.mesh.instanceMatrix.needsUpdate = true;
    const F = this.fireflies, pos = F.pts.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const ph = F.ph[i];
      pos.array[i * 3] = F.base[i * 3] + Math.sin(t * 0.4 + ph) * 1.2; pos.array[i * 3 + 1] = F.base[i * 3 + 1] + Math.sin(t * 0.7 + ph * 2) * 0.5; pos.array[i * 3 + 2] = F.base[i * 3 + 2] + Math.cos(t * 0.35 + ph) * 1.2;
    }
    pos.needsUpdate = true;
    F.pts.material.opacity = 0.6 + 0.3 * Math.sin(t * 1.3);
    void camera;
  };
  void bell; void makeSmoke; void makeWood;
  return world;
}
