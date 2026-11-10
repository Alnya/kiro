// ボス一騎討ち: Three.js の描画・カメラ・入力・HUD・演出をまとめるコントローラ。
import * as THREE from "../../vendor/three/three.module.js";
import { EffectComposer } from "../../vendor/three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "../../vendor/three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "../../vendor/three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "../../vendor/three/examples/jsm/postprocessing/ShaderPass.js";
import { OutputPass } from "../../vendor/three/examples/jsm/postprocessing/OutputPass.js";
import { Duel, TUNE, B_ATTACKS } from "./combat.js";
import { Humanoid } from "./rig.js";
import { buildPlayer, buildBoss } from "./models.js";
import { buildWorld } from "./world.js";
import { Particles, Rings, Trail, Aura } from "./fx.js";
import { playerPose, bossPose, basePose } from "./anim.js";
import { DuelAudio } from "./audio.js";
import { makeGlow } from "./textures.js";

export const QUALITY = {
  high: { pr: 2, shadow: true, shadowSize: 2048, bloom: true, msaa: 4, trees: 90, blossoms: 260, mist: 7, petals: 260, fireflies: 70, texSize: 1024 },
  standard: { pr: 1.5, shadow: true, shadowSize: 1024, bloom: true, msaa: 0, trees: 55, blossoms: 140, mist: 4, petals: 140, fireflies: 40, texSize: 512 },
  low: { pr: 1, shadow: false, shadowSize: 512, bloom: false, msaa: 0, trees: 28, blossoms: 70, mist: 2, petals: 60, fireflies: 20, texSize: 256 },
};

// ビネット・色収差・粒状感・低HP時の彩度低下
const PostShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uAb: { value: 0 }, uVig: { value: 0.38 }, uDesat: { value: 0 }, uFlash: { value: 0 }, uRed: { value: 0 } },
  vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime, uAb, uVig, uDesat, uFlash, uRed; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec2 c = vUv - 0.5; float r = length(c);
      vec2 off = c * (0.0015 + uAb) * r * 2.0;
      vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      float l = dot(col, vec3(0.299,0.587,0.114));
      col = mix(col, vec3(l), uDesat);
      col = mix(col, col * vec3(1.15,0.55,0.5), uRed);
      col *= 1.0 - smoothstep(0.25, 0.95, r) * (uVig + uRed * 0.4);
      col += (h(vUv * 1000.0 + uTime) - 0.5) * 0.02;
      col += vec3(uFlash);
      gl_FragColor = vec4(col, 1.0);
    }`,
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const damp = (k, dt) => 1 - Math.exp(-k * dt);

export class DuelGame {
  constructor(container, opts = {}) {
    this.root = container;
    this.opts = opts;
    this.qname = QUALITY[opts.quality] ? opts.quality : "standard";
    this.q = QUALITY[this.qname];
    this.seed = opts.seed || 1;
    this.destroyed = false; this.paused = false;
    this.hitstop = 0; this.timeScale = 1; this.slowTarget = 1; this.slowUntil = 0;
    this.shake = 0; this.flash = 0; this.red = 0; this.ab = 0; this.cine = 0;
    this.pending = { attack: false, guardEdge: false, dodge: false, heal: false };
    this.keys = new Set(); this.stick = { x: 0, y: 0 }; this.btnGuard = false; this.mouseGuard = false;
    this.parryT = 99; this.t = 0; this.last = 0; this.progAcc = 0; this.endShown = false; this.deathShown = false;
    this.camPos = new THREE.Vector3(); this.camLook = new THREE.Vector3(); this.camInit = false;
    this.bossPrev = new THREE.Vector3(); this.bossVel = new THREE.Vector3();
    this.hint = 0;
    this.buildDom();
    this.initThree();
    this.bindInput();
    this.newDuel();
  }

  // ---------- DOM ----------
  buildDom() {
    this.root.innerHTML = `
      <canvas class="dl-canvas"></canvas>
      <div class="dl-hud">
        <div class="dl-boss"><div class="dl-bname">鬼面の武将 黒羽</div>
          <div class="dl-bbar"><i class="dl-bhp"></i></div><div class="dl-marks"><b></b><b></b></div>
          <div class="dl-bpost"><i class="l"></i><i class="r"></i></div></div>
        <div class="dl-rival"></div>
        <button class="dl-pause" aria-label="一時停止">‖</button>
      </div>
      <div class="dl-pl"><div class="dl-ppost"><i class="l"></i><i class="r"></i></div><div class="dl-php"><i></i></div><div class="dl-gourd"></div></div>
      <div class="dl-msg"></div><div class="dl-peril">危</div><div class="dl-prompt"></div><div class="dl-hint"></div>
      <div class="dl-controls">
        <div class="dl-stick"><div class="dl-knob"></div></div>
        <div class="dl-btns">
          <button class="dl-b dl-heal" data-k="heal">🍶<small>回復</small></button>
          <button class="dl-b dl-dodge" data-k="dodge">回避</button>
          <button class="dl-b dl-guard" data-k="guard">防御<small>パリィ</small></button>
          <button class="dl-b dl-atk" data-k="attack">攻撃</button>
        </div>
      </div>
      <div class="dl-end hidden"></div><div class="dl-pausebox hidden"></div><div class="dl-title"></div>`;
    const $ = (s) => this.root.querySelector(s);
    this.el = {
      canvas: $(".dl-canvas"), bhp: $(".dl-bhp"), marks: $(".dl-marks"), bpostL: $(".dl-bpost .l"), bpostR: $(".dl-bpost .r"), rival: $(".dl-rival"),
      pl: $(".dl-pl"), ppostL: $(".dl-ppost .l"), ppostR: $(".dl-ppost .r"), php: $(".dl-php i"), gourd: $(".dl-gourd"), msg: $(".dl-msg"), peril: $(".dl-peril"),
      prompt: $(".dl-prompt"), hint: $(".dl-hint"), end: $(".dl-end"), pausebox: $(".dl-pausebox"), title: $(".dl-title"), stick: $(".dl-stick"), knob: $(".dl-knob"),
    };
  }

  // ---------- Three.js ----------
  initThree() {
    const q = this.q, canvas = this.el.canvas;
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !q.bloom, powerPreference: "high-performance", alpha: false }));
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pr));
    r.shadowMap.enabled = q.shadow; r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.05;
    r.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(56, 1, 0.1, 600);
    this.world = buildWorld(r, this.scene, q);

    // キャラクター
    this.pl = buildPlayer(new Humanoid(1)); this.scene.add(this.pl.root);
    this.boss = buildBoss(new Humanoid(1.42)); this.scene.add(this.boss.root);
    this.plTarget = basePose(); this.bossTarget = basePose();

    // 演出
    this.sparks = new Particles(this.scene, 700, makeGlow(64), true);
    this.dust = new Particles(this.scene, 160, makeGlow(64), false);
    this.rings = new Rings(this.scene, 8);
    this.trailP = new Trail(this.scene, 24, 0xbfe0ff, 0.9);
    this.trailB = new Trail(this.scene, 24, 0xff8a60, 0.32);
    this.aura = new Aura(this.scene, 140);
    this.flashLight = new THREE.PointLight(0xffe0b0, 0, 14, 2); this.scene.add(this.flashLight);
    this.perilLight = new THREE.PointLight(0xff2010, 0, 7, 2); this.scene.add(this.perilLight);
    this.audio = new DuelAudio();

    // ポストプロセス
    if (q.bloom) {
      const w = canvas.clientWidth || 800, h = canvas.clientHeight || 450, pr = r.getPixelRatio();
      const rt = new THREE.WebGLRenderTarget(w * pr, h * pr, { type: THREE.HalfFloatType, samples: q.msaa });
      this.composer = new EffectComposer(r, rt);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(w / 2, h / 2), 0.5, 0.6, 0.9);
      this.composer.addPass(this.bloom);
      this.post = new ShaderPass(PostShader);
      this.composer.addPass(this.post);
      this.composer.addPass(new OutputPass());
    } else {
      this.post = null;
    }
    this.onResize = () => this.resize();
    window.addEventListener("resize", this.onResize);
    this.resize();
  }

  resize() {
    const w = this.root.clientWidth || window.innerWidth, h = this.root.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // 縦画面では少し広角に
    this.camera.fov = w / h < 1 ? 70 : 56;
    this.camera.updateProjectionMatrix();
    if (this.composer) { this.composer.setPixelRatio(this.renderer.getPixelRatio()); this.composer.setSize(w, h); this.bloom.resolution.set(w / 2, h / 2); }
  }

  // ---------- 入力 ----------
  bindInput() {
    const map = {
      KeyJ: "attack", KeyZ: "attack", Enter: "attack", KeyK: "guard", KeyX: "guard", ShiftLeft: "guard", ShiftRight: "guard",
      Space: "dodge", KeyL: "dodge", KeyC: "dodge", KeyE: "heal", KeyH: "heal",
    };
    this.onKeyDown = (e) => {
      if (e.code === "Escape") { this.togglePause(); return; }
      const a = map[e.code];
      if (a) { e.preventDefault(); if (e.repeat) return; this.press(a, true); }
      else if (["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) { e.preventDefault(); this.keys.add(e.code); }
    };
    this.onKeyUp = (e) => {
      const a = map[e.code];
      if (a) { e.preventDefault(); this.press(a, false); } else this.keys.delete(e.code);
    };
    this.onBlur = () => { this.keys.clear(); this.press("guard", false); };
    window.addEventListener("keydown", this.onKeyDown); window.addEventListener("keyup", this.onKeyUp); window.addEventListener("blur", this.onBlur);
    // マウス: 左クリック=攻撃 / 右クリック=防御
    const cv = this.el.canvas;
    this.onMouseDown = (e) => { this.audio.unlock(); if (e.button === 0) this.press("attack", true); else if (e.button === 2) { this.press("guard", true); } };
    this.onMouseUp = (e) => { if (e.button === 2) this.press("guard", false); };
    this.onCtx = (e) => e.preventDefault();
    cv.addEventListener("mousedown", this.onMouseDown); window.addEventListener("mouseup", this.onMouseUp); cv.addEventListener("contextmenu", this.onCtx);

    // タッチ: ボタン
    this.root.querySelectorAll(".dl-b").forEach((b) => {
      const k = b.dataset.k;
      const down = (e) => { e.preventDefault(); this.audio.unlock(); try { b.setPointerCapture(e.pointerId); } catch { /* noop */ } b.classList.add("on"); this.press(k, true); };
      const up = (e) => { e.preventDefault(); b.classList.remove("on"); this.press(k, false); };
      b.addEventListener("pointerdown", down); b.addEventListener("pointerup", up); b.addEventListener("pointercancel", up); b.addEventListener("lostpointercapture", up);
    });
    // タッチ: スティック(画面左半分のどこでも)
    const zone = this.el.stick, knob = this.el.knob;
    const R = 52;
    let pid = null, ox = 0, oy = 0;
    const setStick = (x, y) => {
      const l = Math.hypot(x, y), k = l > R ? R / l : 1;
      this.stick.x = (x * k) / R; this.stick.y = (y * k) / R;
      knob.style.transform = `translate(${x * k}px, ${y * k}px)`;
    };
    zone.addEventListener("pointerdown", (e) => { e.preventDefault(); this.audio.unlock(); pid = e.pointerId; zone.setPointerCapture(pid); const r = zone.getBoundingClientRect(); ox = r.left + r.width / 2; oy = r.top + r.height / 2; setStick(e.clientX - ox, e.clientY - oy); });
    zone.addEventListener("pointermove", (e) => { if (e.pointerId === pid) setStick(e.clientX - ox, e.clientY - oy); });
    const end = (e) => { if (e.pointerId === pid) { pid = null; setStick(0, 0); } };
    zone.addEventListener("pointerup", end); zone.addEventListener("pointercancel", end); zone.addEventListener("lostpointercapture", end);
    this.root.querySelector(".dl-pause").onclick = () => this.togglePause();
  }

  press(k, down) {
    if (k === "guard") {
      if (down && !this.btnGuard) this.pending.guardEdge = true;
      this.btnGuard = down;
    } else if (down) this.pending[k] = true;
  }

  gather() {
    const k = this.keys;
    let mx = (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0) - (k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0);
    let mz = (k.has("KeyW") || k.has("ArrowUp") ? 1 : 0) - (k.has("KeyS") || k.has("ArrowDown") ? 1 : 0);
    if (Math.abs(this.stick.x) > 0.12 || Math.abs(this.stick.y) > 0.12) { mx = this.stick.x; mz = -this.stick.y; }
    const inp = { mx, mz, guard: this.btnGuard, guardEdge: this.pending.guardEdge, attack: this.pending.attack, dodge: this.pending.dodge, heal: this.pending.heal };
    this.pending = { attack: false, guardEdge: false, dodge: false, heal: false };
    return inp;
  }

  // ---------- 開始・リスタート ----------
  newDuel() {
    this.duel = new Duel(this.seed++);
    this.duel.b.think = 2.6;
    this.parryT = 99; this.endShown = false; this.deathAt = 0; this.deathShown = false;
    this.timeScale = 1; this.slowTarget = 1; this.hitstop = 0; this.cine = 0; this.finalCine = 0;
    for (const h of [this.pl, this.boss]) { h.dead = 0; h.resetFeet(); }
    this.pl.pose = basePose(); this.boss.pose = basePose();
    this.camInit = false;
    this.bossPrev.set(this.duel.b.x, 0, this.duel.b.z);
    if (this.boss.runeMat) this.boss.runeMat.emissiveIntensity = 0;
    this.boss.blade.bladeMat.emissiveIntensity = 0;
    this.el.end.classList.add("hidden"); this.el.end.innerHTML = "";
    this.el.title.innerHTML = '<span>鬼面の武将</span><b>黒羽</b>';
    this.el.title.classList.remove("show"); void this.el.title.offsetWidth; this.el.title.classList.add("show");
    this.tipT = 0; this.tipIdx = 0;
    // 初期ポーズをなじませる
    for (let i = 0; i < 20; i++) this.updateVisuals(1 / 30, 1 / 30);
  }

  start() {
    this.last = performance.now();
    this.frame = (now) => this.loop(now);
    this.raf = requestAnimationFrame(this.frame);
  }

  restart() { this.newDuel(); }

  togglePause() {
    if (this.endShown || this.deathShown) return;
    this.paused = !this.paused;
    const box = this.el.pausebox;
    if (this.paused) {
      box.innerHTML = '<div class="dl-pbox"><h2>一時停止</h2><button class="dl-resume primary">再開</button><button class="dl-quit">やめる</button></div>';
      box.classList.remove("hidden");
      box.querySelector(".dl-resume").onclick = () => this.togglePause();
      box.querySelector(".dl-quit").onclick = () => this.opts.onExit && this.opts.onExit();
    } else { box.classList.add("hidden"); this.last = performance.now(); }
  }

  // ---------- メインループ ----------
  loop(now) {
    if (this.destroyed) return;
    this.raf = requestAnimationFrame(this.frame);
    const dt = clamp((now - this.last) / 1000, 0, 0.05);
    this.last = now;
    this.t += dt;
    if (this.paused) { this.flash *= Math.exp(-7 * dt); this.ab *= Math.exp(-6 * dt); if (this.post) { this.post.uniforms.uFlash.value = this.flash * 0.09; this.post.uniforms.uAb.value = this.ab; } this.render(dt); return; }

    let step = dt;
    if (this.hitstop > 0) { this.hitstop -= dt; step = 0; }
    if (this.slowUntil > 0) { this.slowUntil -= dt; if (this.slowUntil <= 0) this.slowTarget = 1; }
    this.timeScale += (this.slowTarget - this.timeScale) * damp(9, dt);
    const sdt = step * this.timeScale;
    const inp = this.gather();
    if (sdt > 0) {
      const n = Math.max(1, Math.ceil(sdt / (1 / 60))), hstep = sdt / n;
      for (let i = 0; i < n; i++) {
        const evs = this.duel.update(hstep, i === 0 ? inp : { mx: inp.mx, mz: inp.mz, guard: inp.guard });
        if (evs.length) this.handle(evs);
      }
    } else {
      // ヒットストップ中の入力は取りこぼさない
      if (inp.attack) this.pending.attack = true;
      if (inp.guardEdge) this.pending.guardEdge = true;
      if (inp.dodge) this.pending.dodge = true;
      if (inp.heal) this.pending.heal = true;
    }
    this.updateVisuals(dt, sdt);
    this.updateCamera(dt);
    this.updateHud(dt);
    this.render(dt);

    this.progAcc += dt;
    if (this.progAcc > 0.5 && this.opts.onProgress) { this.progAcc = 0; this.opts.onProgress(this.duel.snapshot()); }
  }

  // ---------- イベント → 演出 ----------
  bladeMid(h, k = 0.6) {
    const bd = h.blade;
    return h.weapon.localToWorld(new THREE.Vector3(0, bd.baseY + bd.len * k, 0));
  }
  light(pos, color, power) { this.flashLight.position.copy(pos); this.flashLight.color.set(color); this.flashLight.intensity = power; }
  slow(scale, secs) { this.slowTarget = scale; this.slowUntil = secs; }
  msg(text, cls = "", ms = 1600) {
    const m = this.el.msg;
    m.className = "dl-msg " + cls;
    m.textContent = text;
    void m.offsetWidth; m.classList.add("show");
    clearTimeout(this._msgT); this._msgT = setTimeout(() => m.classList.remove("show"), ms);
  }

  handle(evs) {
    const A = this.audio, d = this.duel;
    for (const e of evs) {
      switch (e.k) {
        case "swing": A.play("swing"); break;
        case "bossSwing": A.play("bossSwing"); break;
        case "peril":
          this.el.peril.classList.remove("on"); void this.el.peril.offsetWidth; this.el.peril.classList.add("on");
          A.play("peril"); break;
        case "parry": {
          const pos = this.bladeMid(this.pl, 0.55);
          this.sparks.burst(pos, 46, { speed: 8, color: 0xfff1c8, size: 0.16, life: 0.65, g: 6, drag: 0.8, up: 0.5 });
          this.sparks.burst(pos, 8, { speed: 2.5, color: 0xffffff, size: 0.16, life: 0.18, g: 0, drag: 2 });
          this.rings.spawn(pos, { size: 2.4, color: 0xfff2d0, life: 0.3 });
          this.hitstop = 0.08; this.shake = Math.max(this.shake, 0.3); this.flash = 0.5; this.ab = 0.01;
          this.light(pos, 0xffe8c0, 45); A.play("parry"); this.parryT = 0;
          this.pl.blade.edgeMat.emissiveIntensity = 4;
          break;
        }
        case "block": {
          const pos = this.bladeMid(this.pl, 0.5);
          this.sparks.burst(pos, 18, { speed: 5, color: 0xffa860, size: 0.1, life: 0.4, g: 8 });
          this.hitstop = 0.035; this.shake = Math.max(this.shake, 0.14); this.light(pos, 0xffb070, 35); A.play("block"); break;
        }
        case "bossHit": {
          const pos = new THREE.Vector3(d.b.x, 1.7, d.b.z);
          this.sparks.burst(pos, e.heavy ? 40 : 22, { speed: 6, color: 0xff5a3c, size: 0.12, life: 0.5, g: 9, dir: new THREE.Vector3(0, 0, 0) });
          this.sparks.burst(pos, 8, { speed: 3, color: 0xffffff, size: 0.2, life: 0.2, g: 0, drag: 2 });
          this.hitstop = e.heavy ? 0.085 : 0.05; this.shake = Math.max(this.shake, e.heavy ? 0.26 : 0.12);
          this.light(pos, 0xff7050, 40); A.play("bossHit"); break;
        }
        case "bossBlock": {
          const pos = new THREE.Vector3(d.b.x, 1.5, d.b.z);
          this.sparks.burst(pos, 16, { speed: 5, color: 0xffb070, size: 0.1, life: 0.4, g: 8 }); this.hitstop = 0.04; A.play("block"); break;
        }
        case "playerHit": {
          const pos = new THREE.Vector3(d.p.x, 1.2, d.p.z);
          this.sparks.burst(pos, 28, { speed: 6, color: 0xc01818, size: 0.13, life: 0.55, g: 10 });
          this.red = 1; this.shake = Math.max(this.shake, e.perilous ? 0.7 : 0.45); this.hitstop = e.perilous ? 0.12 : 0.085; this.ab = 0.018;
          this.light(pos, 0xff3020, 40); A.play("playerHit"); break;
        }
        case "dodgeStart": A.play("dodge"); break;
        case "dodged": this.slow(0.45, 0.28); this.msg("見切り", "dodge", 700); break;
        case "bossPostureBreak": {
          const pos = new THREE.Vector3(d.b.x, 1.6, d.b.z);
          this.rings.spawn(pos, { size: 3.4, color: 0xff6a3c, life: 0.5 });
          this.sparks.burst(pos, 26, { speed: 6, color: 0xffcf8a, size: 0.1, life: 0.6, g: 4 });
          this.slow(0.35, 0.55); this.hitstop = 0.1; this.flash = 0.4; this.shake = Math.max(this.shake, 0.4);
          this.msg("体幹崩し", "break", 1500); A.play("postureBreak"); break;
        }
        case "bossKneel": this.msg("致命の一撃を!", "break", 1500); A.play("kneel"); break;
        case "playerPostureBreak": this.msg("体幹崩し!", "bad", 1200); A.play("postureBreak"); this.red = Math.max(this.red, 0.5); break;
        case "deathblowStart": this.cine = 1; this.slow(0.55, 1.0); break;
        case "deathblow": {
          const pos = new THREE.Vector3(d.b.x, 1.5, d.b.z);
          this.sparks.burst(pos, 60, { speed: 8, color: 0xd01818, size: 0.12, life: 0.8, g: 9 });
          this.sparks.burst(pos, 12, { speed: 4, color: 0xffffff, size: 0.14, life: 0.25, g: 0, drag: 2 });
          this.rings.spawn(pos, { size: 4.2, color: 0xffd0c0, life: 0.5 });
          this.hitstop = 0.24; this.shake = 0.9; this.flash = 0.7; this.ab = 0.022; this.light(pos, 0xff5030, 60);
          this.msg("致命の一撃", "deathblow", 2000); A.play("deathblow");
          if (e.final) { this.slow(0.22, 2.4); this.finalCine = 3; }
          break;
        }
        case "phase2":
          A.play("roar"); this.msg("覚醒", "break", 2200); this.shake = Math.max(this.shake, 0.5);
          this.rings.spawn(new THREE.Vector3(d.b.x, 1.2, d.b.z), { size: 6, color: 0xff3b1f, life: 0.9 }); break;
        case "win": A.play("win"); this.slow(0.3, 2.6); break;
        case "lose": A.play("lose"); this.deathAt = this.t + 1.2; this.slow(0.5, 1.2); break;
        case "healStart": break;
        case "healed": A.play("heal"); this.sparks.burst(new THREE.Vector3(d.p.x, 1.0, d.p.z), 22, { speed: 1.6, color: 0x8aff9a, size: 0.12, life: 0.9, g: -1.5, up: 0.4 }); break;
        case "revive": this.deathShown = false; this.el.end.classList.add("hidden"); this.slow(1, 0.01); break;
        default: break;
      }
    }
  }

  // ---------- 見た目の更新 ----------
  updateVisuals(dt, sdt) {
    const d = this.duel, p = d.p, b = d.b;
    const extra = { t: this.t, dt: sdt, parryT: this.parryT };
    if (sdt > 0) {
      if (this.parryT < 90) this.parryT += sdt;
      this.pl.setRoot(p.x, p.z, p.yaw);
      const kp = playerPose(d, this.pl, this.plTarget, extra);
      this.pl.update(sdt, new THREE.Vector3(p.vx, 0, p.vz), this.plTarget, kp);

      this.boss.setRoot(b.x, b.z, b.yaw);
      this.bossVel.set((b.x - this.bossPrev.x) / sdt, 0, (b.z - this.bossPrev.z) / sdt);
      if (this.bossVel.length() > 9) this.bossVel.setLength(9);
      this.bossPrev.set(b.x, 0, b.z);
      const kb = bossPose(d, this.boss, this.bossTarget, extra);
      this.boss.update(sdt, this.bossVel, this.bossTarget, kb);
    }
    // 布のなびき
    const clothUpdate = (h, vel, yaw) => {
      const fwd = vel.x * Math.sin(yaw) + vel.z * Math.cos(yaw), left = vel.x * Math.cos(yaw) - vel.z * Math.sin(yaw);
      for (const c of h.cloths || []) c.update(this.t, new THREE.Vector3(c.flip ? -left : left, 0, c.flip ? -fwd : fwd), 1);
    };
    clothUpdate(this.pl, new THREE.Vector3(p.vx, 0, p.vz), p.yaw);
    clothUpdate(this.boss, this.bossVel, b.yaw);

    // ボスの刀: 危マークの予兆で赤く光る、第2形態では魔力の筋が燃える
    let tell = 0;
    if (b.state === "attack" && b.atk && b.atk.perilous) tell = clamp((b.atkClock - b.atk.tell[0]) / (b.atk.tell[1] - b.atk.tell[0]), 0, 1);
    const bb = this.boss.blade;
    bb.bladeMat.emissive.setHex(0xff2010);
    bb.bladeMat.emissiveIntensity += ((tell * 1.3 + (b.phase === 2 ? 0.3 : 0)) - bb.bladeMat.emissiveIntensity) * damp(18, dt);
    this.perilLight.position.set(b.x, 1.6, b.z);
    this.perilLight.intensity += ((tell * 30) - this.perilLight.intensity) * damp(14, dt);
    if (this.boss.runeMat) this.boss.runeMat.emissiveIntensity = b.phase === 2 ? 2.2 + Math.sin(this.t * 6) * 0.8 : 0;
    this.boss.glow.emissiveIntensity = 2.2 + (b.phase === 2 ? 2.5 : 0) + tell * 2;
    this.pl.blade.edgeMat.emissiveIntensity += (0.6 - this.pl.blade.edgeMat.emissiveIntensity) * damp(8, dt);

    // 軌跡: 剣先の速度が速いときだけ描く
    const trace = (h, trail, minSpeed, state, allow) => {
      const bd = h.blade;
      const base = h.weapon.localToWorld(new THREE.Vector3(0, bd.baseY + bd.len * 0.45, 0)), tip = h.weapon.localToWorld(new THREE.Vector3(0, bd.tipY, 0));
      if (state.last && sdt > 0) {
        const sp = tip.distanceTo(state.last) / sdt;
        trail.push(base, tip, allow && sp > minSpeed);
      } else trail.push(base, tip, false);
      state.last = tip;
    };
    this._tp = this._tp || {}; this._tb = this._tb || {};
    trace(this.pl, this.trailP, 7, this._tp, p.state === "attack" || p.state === "deathblow" || (p.state === "guard" && this.parryT < 0.25));
    trace(this.boss, this.trailB, 9, this._tb, b.state === "attack");
    this.trailP.update(dt); this.trailB.update(dt);

    this.sparks.update(dt, this.camera); this.dust.update(dt, this.camera); this.rings.update(dt, this.camera);
    this.aura.update(dt, this.camera, { x: b.x, z: b.z }, b.phase === 2 && b.state !== "dying", 0xff3a1c);
    this.flashLight.intensity *= Math.exp(-14 * dt);
    this.world.update(dt, { x: (p.x + b.x) / 2, z: (p.z + b.z) / 2 }, this.camera);
  }

  // ---------- カメラ ----------
  updateCamera(dt) {
    const d = this.duel, p = d.p, b = d.b;
    let dx = p.x - b.x, dz = p.z - b.z;
    const dist = Math.hypot(dx, dz) || 1; dx /= dist; dz /= dist;
    const rx = dz, rz = -dx; // 主人公から見て右
    const portrait = this.camera.aspect < 1;
    const back = 4.2 + clamp(dist * 0.24, 0, 2.4) + (portrait ? 2.2 : 0), height = 2.0 + clamp(dist * 0.07, 0, 0.7) + (portrait ? 0.9 : 0);
    const side = this.camera.aspect < 1 ? 0.7 : 1.35;
    let tp = new THREE.Vector3(p.x + dx * back + rx * side, height, p.z + dz * back + rz * side);
    let tl = new THREE.Vector3(p.x + (b.x - p.x) * 0.52 + rx * 0.35, 1.45, p.z + (b.z - p.z) * 0.52 + rz * 0.35);
    let fov = this.camera.aspect < 1 ? 70 : 56;
    const cinematic = p.state === "deathblow" || this.finalCine > 0;
    if (this.finalCine > 0) this.finalCine -= dt;
    if (cinematic) {
      const mx = (p.x + b.x) / 2, mz = (p.z + b.z) / 2;
      const k = this.finalCine > 0 ? this.t * 0.4 : 0.4;
      const sx = rx * Math.cos(k) - dx * Math.sin(k), sz = rz * Math.cos(k) - dz * Math.sin(k);
      tp = new THREE.Vector3(mx + sx * 3.4, 1.2, mz + sz * 3.4);
      tl = new THREE.Vector3(mx, 1.45, mz);
      fov = 40;
    }
    if (!this.camInit) { this.camPos.copy(tp); this.camLook.copy(tl); this.camInit = true; }
    const kp = cinematic ? 4 : 7.5;
    this.camPos.lerp(tp, damp(kp, dt)); this.camLook.lerp(tl, damp(11, dt));
    this.shake *= Math.exp(-6.5 * dt);
    if (d.b.state === "roar") this.shake = Math.max(this.shake, 0.14);
    const s = this.shake;
    this.camera.position.set(this.camPos.x + (Math.random() - 0.5) * s * 0.35, Math.max(0.5, this.camPos.y) + (Math.random() - 0.5) * s * 0.25, this.camPos.z + (Math.random() - 0.5) * s * 0.35);
    this.camera.lookAt(this.camLook);
    this.camera.fov += (fov - this.camera.fov) * damp(5, dt);
    this.camera.updateProjectionMatrix();
  }

  // ---------- HUD ----------
  updateHud(dt) {
    const d = this.duel, p = d.p, b = d.b, el = this.el;
    el.bhp.style.width = clamp((Math.max(0, b.hp) / TUNE.bossBarHp) * 100, 0, 100) + "%";
    [...el.marks.children].forEach((m, i) => m.classList.toggle("on", i < b.bars));
    const bp = clamp(b.posture / TUNE.bossPosture, 0, 1) * 50;
    el.bpostL.style.width = bp + "%"; el.bpostR.style.width = bp + "%";
    const pp = this.root.querySelector(".dl-bpost");
    pp.classList.toggle("hot", b.posture > 70); pp.classList.toggle("break", b.state === "stun");
    el.php.style.width = clamp((p.hp / TUNE.playerHp) * 100, 0, 100) + "%";
    el.pl.classList.toggle("low", p.hp < 30);
    const pw = clamp(p.posture / TUNE.playerPosture, 0, 1) * 50;
    el.ppostL.style.width = pw + "%"; el.ppostR.style.width = pw + "%";
    el.pl.classList.toggle("hot", p.posture > 70);
    el.gourd.textContent = "🍶".repeat(p.gourds) || "";
    // 致命の一撃の案内
    const vul = b.state === "stun" || b.state === "kneel";
    el.prompt.textContent = vul && p.state !== "deathblow" ? (d.bossDist < 4.4 ? "攻撃ボタンで 致命の一撃!" : "近づいて 致命の一撃!") : "";
    el.prompt.classList.toggle("on", vul && p.state !== "deathblow");
    // ダメージ演出
    this.flash *= Math.exp(-7 * dt); this.red *= Math.exp(-3.2 * dt); this.ab *= Math.exp(-6 * dt);
    if (this.post) {
      const u = this.post.uniforms;
      u.uTime.value = this.t; u.uFlash.value = this.flash * 0.09; u.uRed.value = Math.max(this.red * 0.4, p.hp < 30 ? 0.1 + 0.06 * Math.sin(this.t * 5) : 0);
      u.uAb.value = this.ab; u.uDesat.value = p.hp < 30 ? 0.35 : p.state === "dead" ? 0.8 : 0;
    }
    // チュートリアル
    if (this.tipIdx < TIPS.length) {
      this.tipT += dt;
      if (this.tipT > 3.2 && this.tipT < 3.2 + TIPS[this.tipIdx].len) { el.hint.textContent = TIPS[this.tipIdx].text; el.hint.classList.add("on"); }
      else if (this.tipT >= 3.2 + TIPS[this.tipIdx].len) { el.hint.classList.remove("on"); this.tipIdx++; this.tipT = 2.4; }
    } else el.hint.classList.remove("on");
    // 死亡・勝利
    if (!this.deathShown && p.dead && this.deathAt && this.t >= this.deathAt) this.showDeath();
    if (!this.endShown && d.over && d.over.win) this.showWin();
  }

  setRival(text) { this.el.rival.textContent = text || ""; this.el.rival.classList.toggle("on", !!text); }

  showDeath() {
    this.deathShown = true;
    const d = this.duel, el = this.el.end;
    const can = d.over && d.over.canRevive;
    el.innerHTML = `<div class="dl-death"><b>死</b><p>${can ? "一度だけ復活できる" : "もう復活できない"}</p>
      ${can ? '<button class="dl-revive primary">復活する</button>' : ""}<button class="dl-retry">最初から挑む</button><button class="dl-quit2">やめる</button></div>`;
    el.classList.remove("hidden");
    const rv = el.querySelector(".dl-revive");
    if (rv) rv.onclick = () => { d.revive(); this.handle(d.ev.splice(0)); this.deathShown = false; el.classList.add("hidden"); this.last = performance.now(); };
    el.querySelector(".dl-retry").onclick = () => this.restart();
    el.querySelector(".dl-quit2").onclick = () => this.opts.onExit && this.opts.onExit();
  }

  showWin() {
    this.endShown = true;
    const d = this.duel, el = this.el.end, s = d.over.stats || d.stats;
    const t = Math.round(d.over.time);
    const res = { win: true, time: t, parries: s.parries, deaths: s.deaths, blocks: s.blocks, dodges: s.dodges };
    el.innerHTML = `<div class="dl-win"><b>天誅</b><p>鬼面の武将を討ち取った</p>
      <div class="dl-stats"><span>時間 <b>${Math.floor(t / 60)}分${t % 60}秒</b></span><span>パリィ <b>${s.parries}</b></span><span>回避 <b>${s.dodges}</b></span><span>死亡 <b>${s.deaths}</b></span></div>
      <button class="dl-retry primary">もう一度挑む</button><button class="dl-quit2">やめる</button></div>`;
    el.classList.remove("hidden");
    el.querySelector(".dl-retry").onclick = () => this.restart();
    el.querySelector(".dl-quit2").onclick = () => this.opts.onExit && this.opts.onExit();
    if (this.opts.onFinish) this.opts.onFinish(res);
  }

  render(dt) {
    void dt;
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  // ---------- デバッグ/テスト用 ----------
  // 状態を直接指定して固定し、数フレームかけて姿勢をなじませる
  debugSnap(spec = {}) {
    const d = this.duel;
    if (spec.player) Object.assign(d.p, spec.player);
    if (spec.boss) Object.assign(d.b, spec.boss);
    if (spec.bossAtk) { d.b.state = "attack"; d.b.atkName = spec.bossAtk; d.b.atk = B_ATTACKS[spec.bossAtk] || null; }
    if (spec.cam) { this.camInit = false; }
    this.paused = true;
    for (let i = 0; i < (spec.frames || 24); i++) { this.updateVisuals(1 / 30, 1 / 30); this.updateCamera(1 / 30); if (spec.hud !== false) this.updateHud(1 / 30); }
    this.render(1 / 30);
  }

  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.onResize); window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp); window.removeEventListener("blur", this.onBlur); window.removeEventListener("mouseup", this.onMouseUp);
    this.audio.stop();
    try { this.renderer.dispose(); this.renderer.forceContextLoss(); } catch { /* noop */ }
    this.root.innerHTML = "";
  }
}

const TIPS = [
  { text: "左:移動 / 右:攻撃・防御・回避・回復", len: 3.2 },
  { text: "敵の攻撃の直前に「防御」でパリィ(弾き)!体幹が削れる", len: 4.5 },
  { text: "体幹が満タンになると「体幹崩し」→ 攻撃で致命の一撃", len: 4.5 },
  { text: "赤く光る「危」の攻撃は防げない。「回避」で避けよう", len: 4.5 },
];
