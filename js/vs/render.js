// Canvas 描画(見た目専用。ここでの状態はシミュレーションに影響しない)。
import { TILE, ROWS } from "./stages.js";

const T = TILE;
export const VIEW_H = ROWS * T; // 224

export const HERO = [
  { name: "アカ", main: "#e53935", dark: "#a8201d", over: "#2456c9" },
  { name: "ミドリ", main: "#2fb34a", dark: "#1d7a31", over: "#3b3fa8" },
];
const SKIN = "#ffcf9e", SKIN_D = "#e0a070", HAIR = "#5a3418", BOOT = "#5b3a1c";

const THEMES = {
  grass: { sky: ["#5aa9ff", "#c7ecff"], ground: "#8a5a2c", groundTop: "#4fbf4e", block: "#c47a2c" },
  bricks: { sky: ["#0d0d1c", "#1c1c33"], ground: "#3a4a74", groundTop: "#5a6ea0", block: "#b5652a" },
  ice: { sky: ["#9fd4ff", "#e8f7ff"], ground: "#8ccff2", groundTop: "#d9f4ff", block: "#c47a2c" },
};

export class Renderer {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext("2d");
    this.cam = 0; this.px = 0; this.lastCx = null;
    this.parts = []; this.seenFx = -1;
    this.bumps = new Map(); // "tx,ty" -> 開始フレーム
    this.shake = 0;
    this.vw = 320;
  }

  resize(vw) {
    this.vw = vw;
    this.cv.width = vw;
    this.cv.height = VIEW_H;
    this.ctx.imageSmoothingEnabled = false;
  }

  reset() { this.lastCx = null; this.parts = []; this.seenFx = -1; this.bumps.clear(); }

  // ---- イベント → パーティクル ----
  consumeFx(sim) {
    for (const e of sim.fx) {
      if (e.id <= this.seenFx) continue;
      this.seenFx = e.id;
      const burst = (n, color, spd, size = 2, life = 30, up = 1) => {
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + e.id;
          this.parts.push({ x: e.x, y: e.y, vx: Math.cos(a) * spd * (0.5 + ((i * 7) % 5) / 5), vy: Math.sin(a) * spd * up - 1, life, max: life, color, size, g: 0.12 });
        }
      };
      switch (e.k) {
        case "brick": burst(6, "#c47a2c", 2, 3, 40); break;
        case "block": case "bump": if (e.tx !== undefined) this.bumps.set(e.tx + "," + e.ty, sim.t); break;
        case "coin": burst(4, "#ffd700", 1.5, 2, 24); break;
        case "star": burst(14, "#fff27a", 3, 3, 40); this.shake = 6; break;
        case "starlost": burst(8, "#fff27a", 2.5, 2, 30); break;
        case "stomp": burst(6, "#ffffff", 2, 2, 20); break;
        case "pound": burst(10, "#e8d8b0", 2.5, 2, 24); this.shake = 6; break;
        case "hurt": burst(8, "#ff7a5a", 2.5, 2, 24); break;
        case "die": burst(14, "#ff4040", 3, 3, 40); this.shake = 8; break;
        case "item": case "bonus": burst(8, "#7affc8", 2, 2, 30); break;
        case "starspawn": burst(16, "#ffe96a", 2, 2, 50); break;
        case "respawn": burst(8, "#ffffff", 2, 2, 24); break;
        default: break;
      }
    }
  }

  // ---- メイン描画 ----
  draw(sim, me) {
    const ctx = this.ctx, vw = this.vw, W = sim.W;
    this.consumeFx(sim);
    const th = THEMES[sim.stage.theme] || THEMES.grass;

    // カメラ(ラップ対応: プレイヤーの移動量を累積)
    const p = sim.players[me];
    const cx = p.x + p.w / 2;
    if (this.lastCx === null) { this.px = cx; this.cam = cx - vw / 2; }
    else this.px += sim.wdx(this.lastCx, cx);
    this.lastCx = cx;
    let target = this.px - vw / 2;
    if (!sim.wrap) { target = Math.max(0, Math.min(W - vw, target)); if (W <= vw) target = (W - vw) / 2; }
    this.cam += (target - this.cam) * 0.18;
    let shx = 0, shy = 0;
    if (this.shake > 0) { shx = ((sim.t * 7) % 5) - 2; shy = ((sim.t * 11) % 5) - 2; this.shake--; }
    const cam = Math.round(this.cam) + shx;

    this.drawBackground(sim, th, cam);
    ctx.save();
    ctx.translate(0, shy);
    this.drawTiles(sim, th, cam);
    const offs = sim.wrap ? [-W, 0, W] : [0];
    for (const off of offs) {
      const ox = off - cam;
      const vis = (x, w) => x + ox + w > -40 && x + ox < vw + 40;
      for (const it of sim.items) if (vis(it.x, it.w)) this.drawItem(it, ox, sim.t);
      for (const s of sim.stars) if (vis(s.x, s.w)) this.drawBigStar(s, ox, sim.t);
      for (const e of sim.enemies) if (vis(e.x, e.w)) this.drawEnemy(e, ox, sim.t);
      for (const f of sim.fire) if (vis(f.x, f.w)) this.drawFire(f, ox, sim.t);
      for (let i = 0; i < 2; i++) {
        const q = sim.players[i];
        if (q.dead > 0 || q.out || !vis(q.x, q.w)) continue;
        this.drawHero(q, ox, sim.t, i === me);
      }
    }
    this.drawParticles(cam);
    ctx.restore();
    this.drawArrows(sim, cam);
    this.drawMinimap(sim, cam);
  }

  // ---- 背景 ----
  drawBackground(sim, th, cam) {
    const ctx = this.ctx, vw = this.vw;
    const g = ctx.createLinearGradient(0, 0, 0, VIEW_H);
    g.addColorStop(0, th.sky[0]); g.addColorStop(1, th.sky[1]);
    ctx.fillStyle = g; ctx.fillRect(0, 0, vw, VIEW_H);
    const theme = sim.stage.theme;
    if (theme === "grass") {
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      for (let i = -1; i < vw / 130 + 2; i++) {
        const x = i * 130 - mod(cam * 0.15, 130), y = 28 + ((i * 37) & 31);
        ctx.fillRect(x, y, 40, 10); ctx.fillRect(x + 8, y - 6, 24, 8); ctx.fillRect(x + 4, y + 8, 32, 4);
      }
      for (let i = -1; i < vw / 180 + 2; i++) {
        const x = i * 180 - mod(cam * 0.35, 180);
        ctx.fillStyle = "#3d9c4a"; ctx.beginPath(); ctx.arc(x + 60, 192, 56, Math.PI, 0); ctx.fill();
        ctx.fillStyle = "#4fb85a"; ctx.beginPath(); ctx.arc(x + 130, 192, 36, Math.PI, 0); ctx.fill();
      }
    } else if (theme === "bricks") {
      ctx.fillStyle = "rgba(255,255,255,0.05)";
      const off = mod(cam * 0.5, 32);
      for (let y = 0; y < VIEW_H; y += 16) {
        for (let x = -32; x < vw + 32; x += 32) ctx.fillRect(x - off + ((y / 16) & 1 ? 16 : 0), y, 31, 15);
      }
    } else {
      ctx.fillStyle = "#c4e4fa";
      for (let i = -1; i < vw / 150 + 2; i++) {
        const x = i * 150 - mod(cam * 0.25, 150);
        ctx.beginPath(); ctx.moveTo(x, 192); ctx.lineTo(x + 60, 80); ctx.lineTo(x + 120, 192); ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.beginPath(); ctx.moveTo(x + 48, 102); ctx.lineTo(x + 60, 80); ctx.lineTo(x + 72, 102); ctx.fill();
        ctx.fillStyle = "#c4e4fa";
      }
      ctx.fillStyle = "rgba(255,255,255,0.8)";
      for (let i = 0; i < 24; i++) {
        const x = mod(i * 53 + sim.t * (0.3 + (i % 3) * 0.15) - cam * 0.4, vw), y = mod(i * 29 + sim.t * 0.6, VIEW_H);
        ctx.fillRect(x, y, 2, 2);
      }
    }
  }

  // ---- タイル ----
  drawTiles(sim, th, camPx) {
    const ctx = this.ctx, vw = this.vw;
    const t0 = Math.floor(camPx / T), t1 = Math.floor((camPx + vw) / T);
    for (let ty = 0; ty < ROWS; ty++) {
      for (let tx = t0; tx <= t1; tx++) {
        const ch = sim.tileAt(tx, ty);
        if (ch === ".") continue;
        const x = tx * T - camPx, y0 = ty * T;
        let y = y0;
        const wtx = sim.wrap ? ((tx % sim.cols) + sim.cols) % sim.cols : tx;
        const bt = this.bumps.get(wtx + "," + ty);
        if (bt !== undefined) {
          const age = sim.t - bt;
          if (age < 10) y -= Math.round(Math.sin((age / 10) * Math.PI) * 5); else this.bumps.delete(wtx + "," + ty);
        }
        const above = sim.tileAt(tx, ty - 1);
        switch (ch) {
          case "#": case "I": this.tileGround(x, y, ch === "I", above, th, sim.stage.theme); break;
          case "B": this.tileBrick(x, y, th); break;
          case "?": case "Q": this.tileQ(x, y, sim.t); break;
          case "U": this.tileUsed(x, y); break;
          case "T": case "P": this.tilePipe(x, y, ch === "T", tx, sim); break;
          case "o": this.tileCoin(x, y, sim.t, tx); break;
          default: break;
        }
      }
    }
  }
  tileGround(x, y, isIce, above, th, theme) {
    const ctx = this.ctx;
    if (isIce) {
      ctx.fillStyle = "#8ccff2"; ctx.fillRect(x, y, T, T);
      ctx.fillStyle = "#b9e8ff"; ctx.fillRect(x, y, T, 4);
      ctx.fillStyle = "#e8fbff"; ctx.fillRect(x + 2, y + 1, 6, 2);
      ctx.fillStyle = "#6fb8e0"; ctx.fillRect(x, y + T - 2, T, 2); ctx.fillRect(x + T - 2, y, 2, T);
      return;
    }
    ctx.fillStyle = th.ground; ctx.fillRect(x, y, T, T);
    if (theme === "bricks") {
      ctx.fillStyle = th.groundTop; ctx.fillRect(x, y, T, 2);
      ctx.fillStyle = "rgba(0,0,0,0.25)"; ctx.fillRect(x, y + 7, T, 1); ctx.fillRect(x + 7, y, 1, 7); ctx.fillRect(x + 3, y + 8, 1, 8);
      return;
    }
    ctx.fillStyle = "rgba(0,0,0,0.18)"; ctx.fillRect(x + 3, y + 8, 3, 3); ctx.fillRect(x + 10, y + 4, 3, 3);
    if (above === "." || above === "o") {
      ctx.fillStyle = th.groundTop; ctx.fillRect(x, y, T, 5);
      ctx.fillStyle = "#7fe07a"; ctx.fillRect(x, y, T, 2);
      ctx.fillStyle = "#3a9a3a"; ctx.fillRect(x + 2, y + 5, 3, 2); ctx.fillRect(x + 9, y + 5, 3, 2);
    }
  }
  tileBrick(x, y, th) {
    const ctx = this.ctx;
    ctx.fillStyle = th.block; ctx.fillRect(x, y, T, T);
    ctx.fillStyle = "#7c4210";
    ctx.fillRect(x, y + 7, T, 1); ctx.fillRect(x, y + 15, T, 1);
    ctx.fillRect(x + 7, y, 1, 7); ctx.fillRect(x + 3, y + 8, 1, 7); ctx.fillRect(x + 11, y + 8, 1, 7);
    ctx.fillStyle = "#e29a4a"; ctx.fillRect(x, y, T, 1); ctx.fillRect(x, y + 8, 3, 1);
  }
  tileQ(x, y, t) {
    const ctx = this.ctx;
    ctx.fillStyle = "#e8a800"; ctx.fillRect(x, y, T, T);
    ctx.fillStyle = "#ffd84a"; ctx.fillRect(x + 1, y + 1, T - 2, T - 2);
    ctx.fillStyle = "#b87800"; ctx.fillRect(x + 1, y + 1, 1, 1); ctx.fillRect(x + T - 2, y + 1, 1, 1);
    ctx.fillRect(x + 1, y + T - 2, 1, 1); ctx.fillRect(x + T - 2, y + T - 2, 1, 1);
    const sh = (t >> 3) % 6 === 0 ? "#fff6c0" : "#8a5a00";
    ctx.fillStyle = sh;
    ctx.fillRect(x + 5, y + 3, 6, 2); ctx.fillRect(x + 9, y + 5, 2, 3);
    ctx.fillRect(x + 7, y + 8, 2, 2); ctx.fillRect(x + 7, y + 11, 2, 2);
  }
  tileUsed(x, y) {
    const ctx = this.ctx;
    ctx.fillStyle = "#6b5a4a"; ctx.fillRect(x, y, T, T);
    ctx.fillStyle = "#8a7664"; ctx.fillRect(x + 1, y + 1, T - 2, T - 2);
    ctx.fillStyle = "#4e4034"; ctx.fillRect(x + 2, y + 2, 2, 2); ctx.fillRect(x + T - 4, y + 2, 2, 2);
    ctx.fillRect(x + 2, y + T - 4, 2, 2); ctx.fillRect(x + T - 4, y + T - 4, 2, 2);
  }
  tilePipe(x, y, top, tx, sim) {
    const ctx = this.ctx;
    const left = sim.tileAt(tx - 1, Math.floor(y / T)) !== (top ? "T" : "P");
    ctx.fillStyle = "#1f9a3a"; ctx.fillRect(x, y, T, T);
    ctx.fillStyle = "#3fd05a"; ctx.fillRect(x + (left ? 2 : 0), y, 4, T);
    ctx.fillStyle = "#14702a"; ctx.fillRect(x + T - 3, y, 3, T);
    if (top) { ctx.fillStyle = "#0c4a1c"; ctx.fillRect(x, y, T, 1); ctx.fillRect(x, y + T - 1, T, 1); }
  }
  tileCoin(x, y, t, tx) {
    const ctx = this.ctx;
    const w = Math.abs(Math.cos(((t + tx * 5) % 60) / 60 * Math.PI)) * 4 + 1;
    ctx.fillStyle = "#b88a00"; ctx.fillRect(x + 8 - w - 1, y + 3, w * 2 + 2, 11);
    ctx.fillStyle = "#ffd700"; ctx.fillRect(x + 8 - w, y + 4, w * 2, 9);
    ctx.fillStyle = "#fff3a0"; ctx.fillRect(x + 8 - w + 1, y + 5, 1, 4);
  }

  // ---- 主人公 ----
  drawHero(p, ox, t, isMe) {
    const ctx = this.ctx;
    const hero = HERO[p.id];
    if (p.inv > 0 && p.stun === 0 && ((t >> 2) & 1)) return;
    ctx.save();
    ctx.translate(Math.round(p.x + ox), Math.round(p.y));

    if (p.mega > 0) { // オーラ
      ctx.fillStyle = "rgba(255,240,120," + (0.25 + 0.15 * Math.sin(t / 5)) + ")";
      ctx.beginPath(); ctx.ellipse(p.w / 2, p.h / 2, p.w * 0.8, p.h * 0.62, 0, 0, Math.PI * 2); ctx.fill();
    }
    if (p.spin) { // コウラ回転
      const r = p.w / 2;
      ctx.translate(r, p.h / 2);
      ctx.rotate(t * 0.5 * (p.face || 1));
      ctx.fillStyle = "#1f5fd0"; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#6fa8ff"; ctx.fillRect(-r + 2, -2, r * 2 - 4, 4);
      ctx.fillStyle = "#fff"; ctx.fillRect(-1, -r + 1, 2, r * 2 - 2);
      ctx.restore();
      return;
    }

    let shirt = hero.main, cap = hero.main, over = hero.over;
    if (p.form === "fire") { shirt = "#ffffff"; cap = "#ffffff"; over = hero.main; }
    if (p.star > 0) {
      const hue = (t * 14) % 360;
      shirt = cap = `hsl(${hue},95%,60%)`; over = `hsl(${(hue + 180) % 360},90%,55%)`;
    }
    const big = p.form !== "small" || p.mega > 0;
    const sw = 12, sh = big ? 26 : 14;
    const flip = p.face < 0;
    if (p.stun > 0) { ctx.translate(p.w / 2, p.h / 2); ctx.rotate(Math.sin(t * 0.8) * 0.2); ctx.translate(-p.w / 2, -p.h / 2); }
    ctx.scale(p.w / sw, p.h / sh);
    if (flip) { ctx.translate(sw, 0); ctx.scale(-1, 1); }

    // 背中のコウラ
    if (p.shell) { ctx.fillStyle = "#1f5fd0"; ctx.fillRect(-2, big ? 9 : 4, 4, big ? 9 : 6); ctx.fillStyle = "#6fa8ff"; ctx.fillRect(-2, big ? 10 : 5, 1, big ? 7 : 4); }
    const air = !p.ground;
    const step = Math.floor(p.anim / 4) % 2;
    const R = (c, x, y, w, h) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };
    if (big) {
      R(cap, 1, 0, 10, 4); R(cap, 6, 3, 6, 2); R(hero.dark, 1, 3, 10, 1);
      R(HAIR, 0, 4, 3, 5); R(SKIN, 2, 4, 9, 7); R(SKIN_D, 10, 8, 2, 2);
      R("#111", 8, 5, 1, 3); R(HAIR, 6, 9, 5, 1);
      R(shirt, 0, 12, 12, 5); R(over, 2, 13, 8, 9); R("#ffd84a", 3, 14, 1, 1); R("#ffd84a", 8, 14, 1, 1);
      R(SKIN, air ? 10 : 0, air ? 8 : 16, 2, 2);
      if (air) { R(BOOT, 1, 22, 5, 4); R(BOOT, 6, 20, 5, 4); }
      else if (Math.abs(p.vx) > 0.2 && step) { R(BOOT, 0, 23, 5, 3); R(BOOT, 7, 21, 5, 3); R(over, 2, 22, 3, 1); }
      else { R(BOOT, 1, 23, 5, 3); R(BOOT, 6, 23, 5, 3); }
    } else {
      R(cap, 1, 0, 10, 3); R(cap, 6, 2, 6, 2); R(HAIR, 0, 3, 2, 3);
      R(SKIN, 2, 3, 9, 4); R("#111", 8, 3, 1, 2); R(HAIR, 6, 6, 5, 1);
      R(shirt, 0, 7, 12, 3); R(over, 2, 8, 8, 4);
      if (air) { R(BOOT, 1, 11, 5, 3); R(BOOT, 7, 10, 5, 3); }
      else if (Math.abs(p.vx) > 0.2 && step) { R(BOOT, 0, 12, 5, 2); R(BOOT, 7, 11, 5, 3); }
      else { R(BOOT, 1, 12, 5, 2); R(BOOT, 6, 12, 5, 2); }
    }
    ctx.restore();

    if (p.stun > 0) { // 星が回る
      ctx.save(); ctx.translate(Math.round(p.x + ox + p.w / 2), Math.round(p.y - 4));
      ctx.fillStyle = "#ffe84a";
      for (let i = 0; i < 3; i++) { const a = t * 0.3 + i * 2.1; ctx.fillRect(Math.cos(a) * 7 - 1, Math.sin(a) * 2 - 1, 3, 3); }
      ctx.restore();
    }
    if (isMe && p.dead === 0) { // 自分マーカー
      ctx.fillStyle = hero.main;
      const mx = Math.round(p.x + ox + p.w / 2), my = Math.round(p.y) - 8 - (p.mega > 0 ? 4 : 0);
      ctx.beginPath(); ctx.moveTo(mx - 3, my); ctx.lineTo(mx + 3, my); ctx.lineTo(mx, my + 4); ctx.fill();
    }
  }

  // ---- 敵 ----
  drawEnemy(e, ox, t) {
    const ctx = this.ctx;
    const x = Math.round(e.x + ox), y = Math.round(e.y);
    const R = (c, a, b, w, h) => { ctx.fillStyle = c; ctx.fillRect(x + a, y + b, w, h); };
    const step = (t >> 3) & 1;
    if (e.k === "goomba") {
      if (e.dead) { R("#8a5a2c", 0, 8, 12, 4); R("#fff", 3, 9, 2, 1); R("#fff", 7, 9, 2, 1); return; }
      R("#9a6232", 1, 0, 10, 4); R("#b8793c", 0, 3, 12, 6); R("#e8c8a0", 3, 8, 6, 3);
      R("#fff", 2, 3, 3, 3); R("#fff", 7, 3, 3, 3); R("#111", 3, 4, 1, 2); R("#111", 8, 4, 1, 2);
      R("#5a3418", 2, 3, 4, 1); R("#5a3418", 6, 3, 4, 1);
      R("#3a2210", step ? 0 : 1, 10, 5, 2); R("#3a2210", step ? 7 : 6, 10, 5, 2);
    } else if (e.k === "koopa") {
      const f = e.vx > 0 ? 1 : -1;
      const hx = f > 0 ? 7 : 0;
      R("#e8c35a", hx, 0, 5, 6); R("#111", hx + (f > 0 ? 3 : 1), 2, 1, 2);
      R("#1f9a3a", f > 0 ? 0 : 3, 5, 9, 8); R("#3fd05a", f > 0 ? 1 : 4, 6, 7, 5); R("#14702a", f > 0 ? 2 : 5, 8, 5, 1);
      R("#e8c35a", 1, 13, 4, 3); R("#e8c35a", 7, 13, 4, 3);
    } else { // shell
      R("#1f9a3a", 1, 1, 10, 9); R("#3fd05a", 2, 2, 8, 7); R("#fff7c0", 0, 9, 12, 3);
      if (e.vx !== 0) R("#14702a", ((t >> 1) & 3) * 2 + 1, 3, 2, 5); else R("#14702a", 5, 3, 2, 5);
    }
  }

  drawItem(it, ox, t) {
    const ctx = this.ctx;
    const x = Math.round(it.x + ox), y = Math.round(it.y);
    const R = (c, a, b, w, h) => { ctx.fillStyle = c; ctx.fillRect(x + a, y + b, w, h); };
    switch (it.k) {
      case "mushroom": R("#f0e0c0", 3, 8, 8, 6); R("#e53935", 1, 1, 12, 8); R("#fff", 3, 3, 3, 3); R("#fff", 9, 3, 3, 3); R("#111", 5, 10, 1, 2); R("#111", 8, 10, 1, 2); break;
      case "flower": R("#2fb34a", 6, 7, 2, 7); R("#2fb34a", 3, 10, 4, 2); R("#ff6a1a", 2, 1, 10, 7); R("#ffd84a", 5, 3, 4, 3); R("#fff", 1, 3, 2, 2); R("#fff", 11, 3, 2, 2); break;
      case "star": { const c = (t >> 2) & 1 ? "#ffe84a" : "#ffb300"; this.starShape(x + 7, y + 7, 7, c, "#8a5a00"); R("#111", 5, 6, 1, 2); R("#111", 8, 6, 1, 2); break; }
      case "mega": R("#f0e0c0", 3, 8, 8, 6); R("#19a05a", 0, 0, 14, 9); R("#fff", 2, 2, 3, 3); R("#ffd84a", 8, 2, 4, 4); R("#111", 5, 10, 1, 2); R("#111", 8, 10, 1, 2); break;
      case "mini": R("#f0e0c0", 4, 9, 6, 5); R("#3b6fe8", 2, 4, 10, 6); R("#fff", 4, 5, 2, 2); R("#111", 5, 11, 1, 1); R("#111", 8, 11, 1, 1); break;
      case "shell": R("#1f5fd0", 1, 2, 12, 10); R("#6fa8ff", 3, 3, 8, 6); R("#fff7c0", 0, 11, 14, 3); R("#fff", 6, 3, 2, 8); break;
      default: break;
    }
  }

  starShape(cx, cy, r, fill, stroke) {
    const ctx = this.ctx;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.45 : r;
      const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = fill; ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = stroke; ctx.stroke();
  }

  drawBigStar(s, ox, t) {
    const ctx = this.ctx;
    if (!s.field && s.life < 120 && ((t >> 2) & 1)) return;
    const bob = s.field ? Math.round(Math.sin(t / 12) * 2) : 0;
    const x = Math.round(s.x + ox + 7), y = Math.round(s.y + 7 + bob);
    const g = ctx.createRadialGradient(x, y, 2, x, y, 18);
    g.addColorStop(0, "rgba(255,240,120,0.55)"); g.addColorStop(1, "rgba(255,240,120,0)");
    ctx.fillStyle = g; ctx.fillRect(x - 18, y - 18, 36, 36);
    this.starShape(x, y, 9, "#ffd400", "#a86a00");
    ctx.fillStyle = "#fff6b0"; ctx.fillRect(x - 3, y - 4, 2, 2);
    ctx.fillStyle = "#111"; ctx.fillRect(x - 3, y - 1, 1, 3); ctx.fillRect(x + 2, y - 1, 1, 3);
  }

  drawFire(f, ox, t) {
    const ctx = this.ctx;
    const x = Math.round(f.x + ox + 3), y = Math.round(f.y + 3);
    ctx.fillStyle = "#ff6a1a"; ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#ffe84a"; ctx.beginPath(); ctx.arc(x, y, 1.8, 0, Math.PI * 2); ctx.fill();
  }

  drawParticles(cam) {
    const ctx = this.ctx;
    for (const q of this.parts) {
      q.x += q.vx; q.y += q.vy; q.vy += q.g; q.life--;
      ctx.globalAlpha = Math.max(0, q.life / q.max);
      ctx.fillStyle = q.color;
      ctx.fillRect(Math.round(q.x - cam), Math.round(q.y), q.size, q.size);
    }
    ctx.globalAlpha = 1;
    this.parts = this.parts.filter((q) => q.life > 0);
    if (this.parts.length > 400) this.parts.splice(0, this.parts.length - 400);
  }

  // 画面外のビッグスターを矢印で知らせる
  drawArrows(sim, cam) {
    const s = sim.fieldStar;
    if (!s) return;
    const ctx = this.ctx, vw = this.vw;
    const center = cam + vw / 2;
    const sx = center + sim.wdx(center, s.x + 7) - cam; // 画面座標
    if (sx >= 0 && sx <= vw) return;
    const left = sx < 0;
    const y = Math.max(22, Math.min(VIEW_H - 22, s.y + 7));
    const x = left ? 8 : vw - 8;
    const pulse = 1 + 0.2 * Math.sin(sim.t / 6);
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = "rgba(0,0,0,0.35)"; ctx.beginPath(); ctx.arc(0, 0, 11, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#ffd400";
    ctx.scale(left ? -pulse : pulse, pulse);
    ctx.beginPath(); ctx.moveTo(3, 0); ctx.lineTo(-3, -5); ctx.lineTo(-3, 5); ctx.fill();
    ctx.restore();
  }

  // 全体マップ(ステージ全体のどこに誰/星がいるか)
  drawMinimap(sim, cam) {
    const ctx = this.ctx, vw = this.vw;
    const w = Math.min(120, vw - 120), h = 5, x = Math.round((vw - w) / 2), y = VIEW_H - 8;
    const mx = (wx) => x + ((wx % sim.W) + sim.W) % sim.W / sim.W * w;
    ctx.fillStyle = "rgba(0,0,0,0.4)"; ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = "rgba(255,255,255,0.18)"; ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = "rgba(255,255,255,0.7)";
    const vx0 = x + (((cam % sim.W) + sim.W) % sim.W) / sim.W * w;
    ctx.strokeRect(Math.round(vx0) + 0.5, y + 0.5, Math.max(2, (vw / sim.W) * w), h - 1);
    if (sim.fieldStar) { ctx.fillStyle = "#ffd400"; ctx.fillRect(Math.round(mx(sim.fieldStar.x)) - 1, y - 2, 3, h + 4); }
    for (let i = 0; i < 2; i++) {
      const q = sim.players[i];
      if (q.dead > 0) continue;
      ctx.fillStyle = HERO[i].main; ctx.fillRect(Math.round(mx(q.x + q.w / 2)) - 1, y, 3, h);
    }
  }
}

function mod(a, n) { return ((a % n) + n) % n; }
