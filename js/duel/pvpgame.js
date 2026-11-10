// 対人戦(2人)の描画・入力・HUD。DuelGame(ボス戦)の描画基盤を引き継ぐ。
// 通信はロックステップ: 毎フレームの入力を DELAY フレーム先の分として相手に送り、両者の入力がそろったフレームだけ進める。
// 両端末で PvpSim(決定論的)が同じ結果になるので、パリィや被弾の判定がずれない。
import * as THREE from "../../vendor/three/three.module.js";
import { DuelGame } from "./game.js";
import { PvpSim, PVP, encodeInput, NEUTRAL } from "./pvp.js";
import { Humanoid } from "./rig.js";
import { buildPlayer } from "./models.js";
import { Trail } from "./fx.js";
import { playerPose, basePose } from "./anim.js";

const STEP = 1000 / 60;
export const PVP_DELAY = 4;   // 入力遅延(フレーム)。PVP.grace と同じだけ遅れて押してもパリィになる
const HASH_EVERY = 120;
export const PAL = [
  { name: "藍", main: "#1d2745", dark: "#10141f", accent: "#a3262b", trail: 0xbfe0ff },
  { name: "緋", main: "#5c1a20", dark: "#1a0c0e", accent: "#d6b04a", trail: 0xffd6a0 },
];
const ROUND_NAMES = ["一本目", "二本目", "三本目", "四本目", "五本目"];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const damp = (k, dt) => 1 - Math.exp(-k * dt);

export class PvpGame extends DuelGame {
  // opts: { quality, me(0/1), sendNet(msg), onExit(), onEnd(result) }

  // ---------- DOM(ボス戦のHUDを対人戦用に組み替える) ----------
  buildDom() {
    super.buildDom();
    const r = this.root, me = this.opts.me | 0, op = 1 - me;
    r.querySelector(".dl-bname").textContent = `相手 ・ ${PAL[op].name}の剣士`;
    const pl = r.querySelector(".dl-pl");
    const nm = document.createElement("div");
    nm.className = "dl-pname"; nm.textContent = `あなた ・ ${PAL[me].name}の剣士`;
    pl.prepend(nm);
    const pm = document.createElement("div");
    pm.className = "dl-marks dl-pmarks"; pm.innerHTML = "<b></b><b></b>";
    pl.appendChild(pm);
    const th = document.createElement("button");
    th.className = "dl-b dl-thrust"; th.dataset.k = "thrust"; th.innerHTML = "突き<small>危</small>";
    r.querySelector(".dl-btns").appendChild(th);
    const pause = r.querySelector(".dl-pause");
    pause.textContent = "✕"; pause.setAttribute("aria-label", "対戦をやめる");
    this.el.pmarks = pm;
    this.el.bpost = r.querySelector(".dl-bpost");
  }

  // ---------- キャラクター(二人とも剣士。色で見分ける) ----------
  buildActors() {
    this.figs = [0, 1].map((i) => {
      const h = buildPlayer(new Humanoid(1), PAL[i]);
      this.scene.add(h.root);
      return h;
    });
    this.tgt = [basePose(), basePose()];
    this.trails = [0, 1].map((i) => new Trail(this.scene, 24, PAL[i].trail, 0.8));
    this._tr = [{}, {}];
    // ボス戦用のメソッドが参照しても壊れないように
    this.pl = this.figs[this.opts.me | 0]; this.boss = this.figs[1 - (this.opts.me | 0)];
  }

  // ---------- 試合の準備 ----------
  newDuel() {
    this.me = this.opts.me | 0; this.op = 1 - this.me;
    this.sim = new PvpSim();
    this.inp = [new Map(), new Map()];
    for (let i = 0; i < PVP_DELAY; i++) { this.inp[0].set(i, NEUTRAL); this.inp[1].set(i, NEUTRAL); }
    this.frameNo = 0; this.nextLocal = PVP_DELAY; this.acc = 0; this.stalledMs = 0;
    this.hashes = new Map(); this.rhashes = new Map(); this.desync = false;
    this.parryT = [99, 99]; this.endShown = false; this.left = false;
    this.cine = 0; this.finalCine = 0; this.camInit = false;
    this.pending = { attack: false, guardEdge: false, dodge: false, heal: false, thrust: false };
    this.placeFigs();
    this.el.end.classList.add("hidden"); this.el.end.innerHTML = "";
    this.sim.ev.splice(0);
    this.showTitle(0);
    for (let i = 0; i < 20; i++) this.updateVisuals(1 / 30, 1 / 30);
  }

  placeFigs() {
    for (let i = 0; i < 2; i++) {
      const F = this.sim.F[i], h = this.figs[i];
      h.setRoot(F.x, F.z, F.yaw); h.resetFeet(); h.dead = 0; h.pose = basePose();
      this._tr[i].last = null;
    }
    this.camInit = false;
  }

  showTitle(round) {
    const t = this.el.title;
    t.innerHTML = `<span>${this.sim.wins[0] + this.sim.wins[1] === 0 && round === 0 ? "一騎討ち" : `${this.sim.wins[this.me]} - ${this.sim.wins[this.op]}`}</span><b>${ROUND_NAMES[round] || ""}</b>`;
    t.classList.remove("show"); void t.offsetWidth; t.classList.add("show");
  }

  // ---------- 通信 ----------
  remoteInput(f, b) {
    if (!Number.isInteger(f) || !Number.isInteger(b)) return;
    if (f < this.frameNo - 2) return;
    this.inp[this.op].set(f, b & 0x3fff);
  }
  remoteHash(f, h) { this.rhashes.set(f, h); this.compareHash(f); }
  compareHash(f) {
    const a = this.hashes.get(f), b = this.rhashes.get(f);
    if (a === undefined || b === undefined) return;
    if (a !== b) this.desync = true;
    this.hashes.delete(f); this.rhashes.delete(f);
  }
  opponentLeft() {
    if (this.left || this.endShown) return;
    this.left = true;
    this.showEnd(null, "相手が対戦をやめました");
  }

  gather() {
    const thrust = !!this.pending.thrust;   // super.gather() が pending を作り直すので先に読む
    const inp = super.gather();
    inp.thrust = thrust;
    return inp;
  }

  pumpLocal() {
    while (this.nextLocal <= this.frameNo + PVP_DELAY) {
      const b = encodeInput(this.gather());
      this.inp[this.me].set(this.nextLocal, b);
      this.opts.sendNet && this.opts.sendNet({ t: "pi", f: this.nextLocal, b });
      this.nextLocal++;
    }
  }

  // ---------- 一時停止の代わり(対戦は止められない) ----------
  togglePause() {
    if (this.endShown) return;
    const box = this.el.pausebox;
    if (!box.classList.contains("hidden")) { box.classList.add("hidden"); return; }
    box.innerHTML = '<div class="dl-pbox"><h2>対戦中</h2><p class="note">対戦は止まりません</p><button class="dl-resume primary">続ける</button><button class="dl-quit">降参してやめる</button></div>';
    box.classList.remove("hidden");
    box.querySelector(".dl-resume").onclick = () => box.classList.add("hidden");
    box.querySelector(".dl-quit").onclick = () => this.opts.onExit && this.opts.onExit();
  }

  // ---------- メインループ ----------
  loop(now) {
    if (this.destroyed) return;
    this.raf = requestAnimationFrame(this.frame);
    const dtms = clamp(now - this.last, 0, 100);
    this.last = now;
    const dt = dtms / 1000;
    this.t += dt;
    this.acc += dtms;
    let sdt = 0, steps = 0, stalled = false;
    if (this.sim.phase === "over" || this.left) {
      // 決着後は同期不要。余韻の演出だけ動かす
      while (this.acc >= STEP && steps < 4) { const ev = this.sim.step([NEUTRAL, NEUTRAL]); if (ev.length) this.handle(ev); if (!this.sim.frozen) sdt += STEP / 1000; this.acc -= STEP; steps++; }
    } else {
      this.pumpLocal();
      while (this.acc >= STEP && steps < 6) {
        const k = this.frameNo;
        if (!this.inp[0].has(k) || !this.inp[1].has(k)) { stalled = true; break; }
        const ev = this.sim.step([this.inp[0].get(k), this.inp[1].get(k)]);
        this.inp[0].delete(k - 2); this.inp[1].delete(k - 2);
        this.frameNo++;
        if (!this.sim.frozen) sdt += STEP / 1000;
        if (ev.length) this.handle(ev);
        if (this.frameNo % HASH_EVERY === 0) {
          const h = this.sim.hash();
          this.hashes.set(this.frameNo, h);
          this.opts.sendNet && this.opts.sendNet({ t: "ph", f: this.frameNo, h });
          this.compareHash(this.frameNo);
        }
        this.pumpLocal();
        this.acc -= STEP; steps++;
      }
    }
    if (this.acc > STEP * 4) this.acc = STEP * 4;
    this.stalledMs = stalled ? this.stalledMs + dtms : 0;
    this.updateVisuals(dt, sdt);
    this.updateCamera(dt);
    this.updateHud(dt);
    this.render(dt);
  }

  // ---------- イベント → 演出 ----------
  handle(evs) {
    const A = this.audio, S = this.sim, me = this.me;
    const pos = (i, y = 1.2) => new THREE.Vector3(S.F[i].x, y, S.F[i].z);
    for (const e of evs) {
      switch (e.k) {
        case "swing": A.play("swing", e.who === me ? 1 : 0.8); break;
        case "thrustHit": A.play("bossSwing"); break;
        case "peril":
          A.play("peril");
          if (e.who !== me) { this.el.peril.classList.remove("on"); void this.el.peril.offsetWidth; this.el.peril.classList.add("on"); }
          break;
        case "parry": {
          const p = this.bladeMid(this.figs[e.who], 0.55);
          this.sparks.burst(p, 46, { speed: 8, color: 0xfff1c8, size: 0.16, life: 0.65, g: 6, drag: 0.8, up: 0.5 });
          this.sparks.burst(p, 8, { speed: 2.5, color: 0xffffff, size: 0.16, life: 0.18, g: 0, drag: 2 });
          this.rings.spawn(p, { size: 2.4, color: 0xfff2d0, life: 0.3 });
          this.shake = Math.max(this.shake, 0.3); this.flash = 0.5; this.ab = 0.01;
          this.light(p, 0xffe8c0, 45); A.play("parry"); this.parryT[e.who] = 0;
          this.figs[e.who].blade.edgeMat.emissiveIntensity = 4;
          if (e.att === me) this.msg("弾かれた", "bad", 700);
          break;
        }
        case "block": {
          const p = this.bladeMid(this.figs[e.who], 0.5);
          this.sparks.burst(p, 18, { speed: 5, color: 0xffa860, size: 0.1, life: 0.4, g: 8 });
          this.shake = Math.max(this.shake, 0.14); this.light(p, 0xffb070, 35); A.play("block"); break;
        }
        case "hit": {
          const p = pos(e.who, 1.3);
          const mine = e.who === me;
          this.sparks.burst(p, e.heavy ? 40 : 24, { speed: 6, color: mine ? 0xc01818 : 0xff5a3c, size: 0.12, life: 0.5, g: 9 });
          this.sparks.burst(p, 6, { speed: 3, color: 0xffffff, size: 0.18, life: 0.2, g: 0, drag: 2 });
          this.shake = Math.max(this.shake, mine ? (e.perilous ? 0.7 : 0.45) : e.heavy ? 0.26 : 0.12);
          if (mine) { this.red = 1; this.ab = 0.018; }
          this.light(p, mine ? 0xff3020 : 0xff7050, 40); A.play(mine ? "playerHit" : "bossHit"); break;
        }
        case "dodgeStart": A.play("dodge", e.who === me ? 1 : 0.6); break;
        case "dodged": if (e.who === me && e.perilous) this.msg("回避", "dodge", 600); break;
        case "mikiri": {
          const p = new THREE.Vector3(e.x, 1.2, e.z);
          this.sparks.burst(p, 30, { speed: 6, color: 0xbfe8ff, size: 0.12, life: 0.5, g: 5 });
          this.rings.spawn(p, { size: 2.8, color: 0xcfe8ff, life: 0.4 });
          this.shake = Math.max(this.shake, 0.35); this.flash = 0.35; A.play("parry"); A.play("postureBreak", 0.6);
          this.msg(e.who === me ? "見切り" : "見切られた", e.who === me ? "break" : "bad", 1200);
          break;
        }
        case "postureBreak": {
          const p = pos(e.who, 1.4);
          this.rings.spawn(p, { size: 3.0, color: 0xff6a3c, life: 0.5 });
          this.sparks.burst(p, 26, { speed: 6, color: 0xffcf8a, size: 0.1, life: 0.6, g: 4 });
          this.flash = 0.4; this.shake = Math.max(this.shake, 0.4);
          if (e.who === me) { this.msg("体幹崩し!", "bad", 1200); this.red = Math.max(this.red, 0.5); }
          else this.msg("体幹崩し", "break", 1400);
          A.play("postureBreak"); break;
        }
        case "deathblowStart": this.cine = 1; break;
        case "deathblow": {
          const p = pos(e.vic, 1.4);
          this.sparks.burst(p, 60, { speed: 8, color: 0xd01818, size: 0.12, life: 0.8, g: 9 });
          this.sparks.burst(p, 12, { speed: 4, color: 0xffffff, size: 0.14, life: 0.25, g: 0, drag: 2 });
          this.rings.spawn(p, { size: 4.2, color: 0xffd0c0, life: 0.5 });
          this.shake = 0.9; this.flash = 0.7; this.ab = 0.022; this.light(p, 0xff5030, 60);
          this.msg("致命の一撃", "deathblow", 2000); A.play("deathblow");
          this.finalCine = 3;
          break;
        }
        case "death": if (e.reason !== "deathblow") { this.shake = Math.max(this.shake, 0.5); this.finalCine = 2.4; } break;
        case "roundStart": this.placeFigs(); this.showTitle(e.round); A.play("gong"); break;
        case "fight": this.msg("始め", "break", 1100); A.play("gong"); break;
        case "roundEnd": {
          const w = e.winner, pre = e.reason === "time" ? "時間切れ — " : e.reason === "double" ? "相打ち — " : "";
          const text = w < 0 ? pre + "引き分け" : w === me ? pre + "一本!" : pre + "一本取られた";
          setTimeout(() => !this.destroyed && this.msg(text, w === me ? "break" : w < 0 ? "dodge" : "bad", 2000), e.reason === "deathblow" ? 1300 : 700);
          A.play(w === me ? "win" : w < 0 ? "kneel" : "lose", 0.7);
          break;
        }
        case "matchEnd": this.showEnd(e.winner); break;
        case "healed": A.play("heal"); this.sparks.burst(pos(e.who, 1.0), 22, { speed: 1.6, color: 0x8aff9a, size: 0.12, life: 0.9, g: -1.5, up: 0.4 }); break;
        default: break;
      }
    }
  }

  // ---------- 見た目 ----------
  updateVisuals(dt, sdt) {
    const S = this.sim;
    let peril = 0;
    for (let i = 0; i < 2; i++) {
      const F = S.F[i], h = this.figs[i];
      const vel = new THREE.Vector3(F.vx, 0, F.vz);
      if (sdt > 0) {
        if (this.parryT[i] < 90) this.parryT[i] += sdt;
        h.setRoot(F.x, F.z, F.yaw);
        const kp = playerPose({ p: F }, h, this.tgt[i], { t: this.t, dt: sdt, parryT: this.parryT[i] });
        h.update(sdt, vel, this.tgt[i], kp);
      }
      const fwd = vel.x * Math.sin(F.yaw) + vel.z * Math.cos(F.yaw), left = vel.x * Math.cos(F.yaw) - vel.z * Math.sin(F.yaw);
      for (const c of h.cloths || []) c.update(this.t, new THREE.Vector3(c.flip ? -left : left, 0, c.flip ? -fwd : fwd), 1);
      // 突きの予兆: 刀が赤く光る
      let tell = 0;
      if (F.state === "thrust") tell = clamp((F.st - PVP.thrust.tell) / (PVP.thrust.w - PVP.thrust.tell), 0, 1) * (F.st < PVP.thrust.w + 0.15 ? 1 : 0);
      const bd = h.blade;
      bd.bladeMat.emissive.setHex(0xff2010);
      bd.bladeMat.emissiveIntensity += (tell * 1.4 - bd.bladeMat.emissiveIntensity) * damp(18, dt);
      bd.edgeMat.emissiveIntensity += (0.6 - bd.edgeMat.emissiveIntensity) * damp(8, dt);
      if (tell > peril) { peril = tell; this.perilLight.position.set(F.x, 1.4, F.z); }
      // 剣の軌跡
      const base = h.weapon.localToWorld(new THREE.Vector3(0, bd.baseY + bd.len * 0.45, 0)), tip = h.weapon.localToWorld(new THREE.Vector3(0, bd.tipY, 0));
      const st = this._tr[i];
      const allow = F.state === "attack" || F.state === "thrust" || F.state === "deathblow" || (F.state === "guard" && this.parryT[i] < 0.25);
      if (st.last && sdt > 0) this.trails[i].push(base, tip, allow && tip.distanceTo(st.last) / sdt > 7);
      else this.trails[i].push(base, tip, false);
      st.last = tip;
      this.trails[i].update(dt);
    }
    this.perilLight.intensity += (peril * 26 - this.perilLight.intensity) * damp(14, dt);
    this.sparks.update(dt, this.camera); this.dust.update(dt, this.camera); this.rings.update(dt, this.camera);
    this.aura.update(dt, this.camera, { x: 0, z: 0 }, false, 0xff3a1c);
    this.flashLight.intensity *= Math.exp(-14 * dt);
    const [A, B] = S.F;
    this.world.update(dt, { x: (A.x + B.x) / 2, z: (A.z + B.z) / 2 }, this.camera);
  }

  // ---------- カメラ(自分の背中越しに相手を見る) ----------
  updateCamera(dt) {
    const S = this.sim, p = S.F[this.me], b = S.F[this.op];
    let dx = p.x - b.x, dz = p.z - b.z;
    const dist = Math.hypot(dx, dz) || 1; dx /= dist; dz /= dist;
    const rx = dz, rz = -dx;
    const portrait = this.camera.aspect < 1;
    const back = 3.8 + clamp(dist * 0.28, 0, 2.6) + (portrait ? 2.2 : 0), height = 1.9 + clamp(dist * 0.08, 0, 0.8) + (portrait ? 0.9 : 0);
    const side = portrait ? 0.7 : 1.25;
    let tp = new THREE.Vector3(p.x + dx * back + rx * side, height, p.z + dz * back + rz * side);
    let tl = new THREE.Vector3(p.x + (b.x - p.x) * 0.52 + rx * 0.3, 1.3, p.z + (b.z - p.z) * 0.52 + rz * 0.3);
    let fov = portrait ? 70 : 56;
    if (this.finalCine > 0) this.finalCine -= dt;
    const intro = S.phase === "intro";
    const cinematic = intro || p.state === "deathblow" || b.state === "deathblow" || this.finalCine > 0;
    if (cinematic) {
      const mx = (p.x + b.x) / 2, mz = (p.z + b.z) / 2;
      const k = intro ? 1.2 - S.pt * 0.45 : this.finalCine > 0 ? this.t * 0.4 : 0.4;
      const sx = rx * Math.cos(k) - dx * Math.sin(k), sz = rz * Math.cos(k) - dz * Math.sin(k);
      const r = intro ? 6.5 - S.pt * 0.8 : 3.4;
      tp = new THREE.Vector3(mx + sx * r, intro ? 1.6 : 1.2, mz + sz * r);
      tl = new THREE.Vector3(mx, 1.35, mz);
      fov = intro ? 46 : 40;
    }
    if (!this.camInit) { this.camPos.copy(tp); this.camLook.copy(tl); this.camInit = true; }
    this.camPos.lerp(tp, damp(cinematic ? 4 : 7.5, dt)); this.camLook.lerp(tl, damp(11, dt));
    this.shake *= Math.exp(-6.5 * dt);
    const s = this.shake;
    this.camera.position.set(this.camPos.x + (Math.random() - 0.5) * s * 0.35, Math.max(0.5, this.camPos.y) + (Math.random() - 0.5) * s * 0.25, this.camPos.z + (Math.random() - 0.5) * s * 0.35);
    this.camera.lookAt(this.camLook);
    this.camera.fov += (fov - this.camera.fov) * damp(5, dt);
    this.camera.updateProjectionMatrix();
  }

  // ---------- HUD ----------
  updateHud(dt) {
    const S = this.sim, p = S.F[this.me], o = S.F[this.op], el = this.el;
    el.bhp.style.width = clamp((o.hp / PVP.hp) * 100, 0, 100) + "%";
    [...el.marks.children].forEach((m, i) => m.classList.toggle("on", i < S.wins[this.op]));
    [...el.pmarks.children].forEach((m, i) => m.classList.toggle("on", i < S.wins[this.me]));
    const bp = clamp(o.posture / PVP.posture, 0, 1) * 50;
    el.bpostL.style.width = bp + "%"; el.bpostR.style.width = bp + "%";
    el.bpost.classList.toggle("hot", o.posture > 70); el.bpost.classList.toggle("break", o.state === "stun");
    el.php.style.width = clamp((p.hp / PVP.hp) * 100, 0, 100) + "%";
    el.pl.classList.toggle("low", p.hp < 30);
    const pw = clamp(p.posture / PVP.posture, 0, 1) * 50;
    el.ppostL.style.width = pw + "%"; el.ppostR.style.width = pw + "%";
    el.pl.classList.toggle("hot", p.posture > 70);
    el.gourd.textContent = "🍶".repeat(p.gourds);
    // 状況表示
    const left = Math.max(0, Math.ceil(PVP.roundTime - S.roundT));
    let info = `${ROUND_NAMES[S.round] || ""}  ${S.wins[this.me]} - ${S.wins[this.op]}`;
    if (S.phase === "fight") info += `  残り${left}秒`;
    if (this.desync) info = "⚠ 同期ずれ(通信を確認)";
    this.setRival(info);
    el.rival.classList.toggle("warn", this.desync || (S.phase === "fight" && left <= 10));
    // 通信待ち
    const waiting = this.stalledMs > 600 && !this.left;
    el.hint.textContent = waiting ? (this.frameNo < 10 ? "相手の準備を待っています…" : "相手の通信を待っています…") : "";
    el.hint.classList.toggle("on", waiting);
    // 致命の一撃の案内
    const vul = o.state === "stun" && S.phase === "fight" && p.state !== "deathblow";
    const d = Math.hypot(p.x - o.x, p.z - o.z);
    el.prompt.textContent = vul ? (d < PVP.dbRange ? "攻撃ボタンで 致命の一撃!" : "近づいて 致命の一撃!") : "";
    el.prompt.classList.toggle("on", vul);
    // 画面効果
    this.flash *= Math.exp(-7 * dt); this.red *= Math.exp(-3.2 * dt); this.ab *= Math.exp(-6 * dt);
    if (this.post) {
      const u = this.post.uniforms;
      u.uTime.value = this.t; u.uFlash.value = this.flash * 0.09;
      u.uRed.value = Math.max(this.red * 0.4, p.hp < 30 && !p.dead ? 0.1 + 0.06 * Math.sin(this.t * 5) : 0);
      u.uAb.value = this.ab; u.uDesat.value = p.dead ? 0.7 : p.hp < 30 ? 0.3 : 0;
    }
  }

  showEnd(winner, note) {
    if (this.endShown) return;
    this.endShown = true;
    const S = this.sim, me = this.me, op = this.op, el = this.el.end;
    this.el.pausebox.classList.add("hidden");
    const tot = S.total;
    let head;
    if (note) head = `<div class="dl-death"><b style="font-size:clamp(40px,10vw,80px)">終</b><p>${note}</p>`;
    else if (winner === me) head = '<div class="dl-win"><b>勝利</b><p>一騎討ちを制した</p>';
    else if (winner === op) head = '<div class="dl-death"><b>敗北</b><p>一騎討ちに敗れた</p>';
    else head = '<div class="dl-win"><b style="color:#cfd6e6">引分</b><p>勝負つかず</p>';
    const row = (k, label) => `<span>${label} <b>${tot[me][k]}</b> - ${tot[op][k]}</span>`;
    el.innerHTML = `${head}
      <div class="dl-stats"><span>本数 <b>${S.wins[me]}</b> - ${S.wins[op]}</span>${row("parries", "パリィ")}${row("mikiri", "見切り")}${row("deathblows", "致命")}</div>
      <button class="dl-quit2 primary">モード選択へ戻る</button></div>`;
    el.classList.remove("hidden");
    el.querySelector(".dl-quit2").onclick = () => this.opts.onExit && this.opts.onExit();
    if (!note && this.opts.onEnd) this.opts.onEnd({ winner, wins: [...S.wins] });
  }

  restart() { /* 対人戦では使わない */ }
}
