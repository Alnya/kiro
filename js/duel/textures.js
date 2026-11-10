// 手続き生成テクスチャ(画像ファイル不要)。石畳・布・木目・光のスプライトなど。
import * as THREE from "../../vendor/three/three.module.js";

function hash2(x, y, s) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
// 値ノイズ(補間付き)
export function vnoise(x, y, s = 1) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x, y, s = 1, oct = 4) {
  let v = 0, amp = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { v += amp * vnoise(x * f, y * f, s + i * 17); amp *= 0.5; f *= 2; }
  return v;
}

function canvas(w, h) { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
function tex(c, { repeat = [1, 1], srgb = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = aniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

// ---- 石畳(カラー/バンプ/ラフネス) ----
export function makeStone(size = 1024, repeat = [5, 5]) {
  const cc = canvas(size, size), hc = canvas(size, size), rc = canvas(size, size);
  const cctx = cc.getContext("2d"), hctx = hc.getContext("2d"), rctx = rc.getContext("2d");
  const cd = cctx.createImageData(size, size), hd = hctx.createImageData(size, size), rd = rctx.createImageData(size, size);
  // 不規則な石の並び: 行ごとにずらした長方形
  const rows = 6, cols = 6;
  const cell = size / rows;
  const tileOf = (x, y) => {
    const r = Math.floor(y / cell);
    const off = (hash2(r, 3, 9) - 0.5) * cell * 0.9;
    const xx = x + off;
    const c = Math.floor(xx / cell);
    const lx = ((xx % cell) + cell) % cell, ly = y - r * cell;
    return { r, c, lx, ly };
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const t = tileOf(x, y);
      const id = hash2(t.r, ((t.c % cols) + cols) % cols, 5);
      const edge = Math.min(t.lx, cell - t.lx, t.ly, cell - t.ly);
      const gap = edge < 3.5 ? 1 : 0;
      const e = Math.min(1, edge / 14);
      const n = fbm(x / 28, y / 28, 3, 4), n2 = fbm(x / 6, y / 6, 11, 2);
      let tone = 0.34 + id * 0.12 + (n - 0.5) * 0.18 + (n2 - 0.5) * 0.08;
      // 苔
      const moss = Math.max(0, fbm(x / 90, y / 90, 21, 3) - 0.52) * 3.2 * (1 - e * 0.5);
      let r = tone * 0.95, g = tone, b = tone * 1.04;
      r = r * (1 - moss) + 0.16 * moss; g = g * (1 - moss) + 0.26 * moss; b = b * (1 - moss) + 0.1 * moss;
      if (gap) { r *= 0.35; g *= 0.35; b *= 0.35; }
      cd.data[i] = Math.min(255, r * 255); cd.data[i + 1] = Math.min(255, g * 255); cd.data[i + 2] = Math.min(255, b * 255); cd.data[i + 3] = 255;
      const hgt = gap ? 0 : 0.35 + e * 0.5 + (n - 0.5) * 0.25 + (n2 - 0.5) * 0.1;
      const hv = Math.max(0, Math.min(255, hgt * 255));
      hd.data[i] = hd.data[i + 1] = hd.data[i + 2] = hv; hd.data[i + 3] = 255;
      const rough = Math.min(255, (0.72 + (n2 - 0.5) * 0.3 + moss * 0.15) * 255);
      rd.data[i] = rd.data[i + 1] = rd.data[i + 2] = rough; rd.data[i + 3] = 255;
    }
  }
  cctx.putImageData(cd, 0, 0); hctx.putImageData(hd, 0, 0); rctx.putImageData(rd, 0, 0);
  // ひび割れ
  cctx.strokeStyle = "rgba(10,10,12,0.5)"; cctx.lineWidth = 1.2;
  for (let k = 0; k < 14; k++) {
    let x = hash2(k, 1, 77) * size, y = hash2(k, 2, 77) * size;
    cctx.beginPath(); cctx.moveTo(x, y);
    for (let s = 0; s < 9; s++) { x += (hash2(k, s, 78) - 0.5) * 60; y += (hash2(k, s, 79) - 0.3) * 50; cctx.lineTo(x, y); }
    cctx.stroke();
  }
  return { map: tex(cc, { repeat }), bump: tex(hc, { repeat, srgb: false }), rough: tex(rc, { repeat, srgb: false }) };
}

// ---- 布(織り目): 色・バンプ ----
export function makeFabric(hex, size = 256, repeat = [3, 3]) {
  const c = canvas(size, size), h = canvas(size, size);
  const x = c.getContext("2d"), hx = h.getContext("2d");
  const col = new THREE.Color(hex);
  x.fillStyle = "#" + col.getHexString(); x.fillRect(0, 0, size, size);
  const step = size / 32;
  for (let i = 0; i < 32; i++) for (let j = 0; j < 32; j++) {
    const warp = (i + j) % 2 === 0;
    const v = 0.78 + 0.28 * hash2(i, j, 4);
    x.fillStyle = `rgba(${warp ? 255 : 0},${warp ? 255 : 0},${warp ? 255 : 0},${warp ? 0.05 : 0.14})`;
    x.fillRect(i * step, j * step, step, step);
    hx.fillStyle = warp ? `rgb(${Math.floor(170 * v)},${Math.floor(170 * v)},${Math.floor(170 * v)})` : `rgb(${Math.floor(90 * v)},${Math.floor(90 * v)},${Math.floor(90 * v)})`;
    hx.fillRect(i * step, j * step, step, step);
  }
  return { map: tex(c, { repeat }), bump: tex(h, { repeat, srgb: false }) };
}

// ---- 木目 ----
export function makeWood(base = "#5a3a22", size = 256, repeat = [1, 3]) {
  const c = canvas(size, size), x = c.getContext("2d"), d = x.createImageData(size, size);
  const col = new THREE.Color(base);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const n = fbm(i / 60, j / 4, 8, 4);
    const ring = 0.5 + 0.5 * Math.sin(i / 7 + n * 9);
    const v = 0.55 + ring * 0.35 + (n - 0.5) * 0.3;
    const k = (j * size + i) * 4;
    d.data[k] = col.r * 255 * v; d.data[k + 1] = col.g * 255 * v; d.data[k + 2] = col.b * 255 * v; d.data[k + 3] = 255;
  }
  x.putImageData(d, 0, 0);
  return tex(c, { repeat });
}

// ---- 巻き柄(柄の菱巻き) ----
export function makeWrap(color = "#151525", size = 128) {
  const c = canvas(size, size), x = c.getContext("2d");
  x.fillStyle = color; x.fillRect(0, 0, size, size);
  x.strokeStyle = "rgba(255,255,255,0.18)"; x.lineWidth = 3;
  for (let i = -size; i < size * 2; i += 22) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i + size, size); x.stroke(); x.beginPath(); x.moveTo(i + size, 0); x.lineTo(i, size); x.stroke(); }
  return tex(c, { repeat: [1, 2] });
}

// ---- 光のスプライト ----
export function makeGlow(size = 128, inner = 0.0) {
  const c = canvas(size, size), x = c.getContext("2d");
  const g = x.createRadialGradient(size / 2, size / 2, size * inner, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.25, "rgba(255,255,255,0.55)"); g.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = g; x.fillRect(0, 0, size, size);
  return tex(c, { srgb: true });
}
export function makeRing(size = 256) {
  const c = canvas(size, size), x = c.getContext("2d");
  const g = x.createRadialGradient(size / 2, size / 2, size * 0.30, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,0)"); g.addColorStop(0.72, "rgba(255,255,255,0.9)"); g.addColorStop(0.8, "rgba(255,255,255,1)"); g.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = g; x.fillRect(0, 0, size, size);
  return tex(c);
}
export function makeStreak(size = 128) { // 火花(細長い光)
  const c = canvas(size, size), x = c.getContext("2d");
  const g = x.createLinearGradient(0, size / 2, size, size / 2);
  g.addColorStop(0, "rgba(255,255,255,0)"); g.addColorStop(0.6, "rgba(255,255,255,0.7)"); g.addColorStop(1, "rgba(255,255,255,1)");
  x.fillStyle = g; x.beginPath(); x.moveTo(0, size / 2); x.lineTo(size, size / 2 - 6); x.lineTo(size, size / 2 + 6); x.closePath(); x.fill();
  return tex(c);
}
export function makePetal(size = 64) {
  const c = canvas(size, size), x = c.getContext("2d");
  const g = x.createRadialGradient(size * 0.5, size * 0.65, 2, size * 0.5, size * 0.5, size * 0.5);
  g.addColorStop(0, "#ffe6ef"); g.addColorStop(1, "#f4a3be");
  x.fillStyle = g;
  x.beginPath();
  x.moveTo(size * 0.5, size * 0.95);
  x.bezierCurveTo(size * 0.05, size * 0.6, size * 0.15, size * 0.1, size * 0.5, size * 0.18);
  x.bezierCurveTo(size * 0.85, size * 0.1, size * 0.95, size * 0.6, size * 0.5, size * 0.95);
  x.fill();
  x.strokeStyle = "rgba(255,255,255,0.35)"; x.lineWidth = 1; x.beginPath(); x.moveTo(size * 0.5, size * 0.9); x.lineTo(size * 0.5, size * 0.25); x.stroke();
  return tex(c);
}
export function makeSmoke(size = 128) {
  const c = canvas(size, size), x = c.getContext("2d"), d = x.createImageData(size, size);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const dx = (i - size / 2) / (size / 2), dy = (j - size / 2) / (size / 2);
    const r = Math.sqrt(dx * dx + dy * dy);
    const n = fbm(i / 18, j / 18, 31, 4);
    const a = Math.max(0, 1 - r) * (0.35 + n * 0.9);
    const k = (j * size + i) * 4;
    d.data[k] = d.data[k + 1] = d.data[k + 2] = 255; d.data[k + 3] = Math.min(255, a * a * 420);
  }
  x.putImageData(d, 0, 0);
  return tex(c);
}
// 地面の霧(大きな板に貼る)
export function makeMist(size = 256) {
  const c = canvas(size, size), x = c.getContext("2d"), d = x.createImageData(size, size);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const dx = (i - size / 2) / (size / 2), dy = (j - size / 2) / (size / 2);
    const r = Math.sqrt(dx * dx + dy * dy);
    const n = fbm(i / 40, j / 40, 55, 4);
    const a = Math.max(0, 1 - r * r) * n * 1.6;
    const k = (j * size + i) * 4;
    d.data[k] = d.data[k + 1] = d.data[k + 2] = 255; d.data[k + 3] = Math.min(255, a * 190);
  }
  x.putImageData(d, 0, 0);
  return tex(c);
}
// 刃文入りの刀身
export function makeBlade(size = 256) {
  const c = canvas(size, 64), x = c.getContext("2d");
  const g = x.createLinearGradient(0, 0, 0, 64);
  g.addColorStop(0, "#9aa4b4"); g.addColorStop(0.35, "#e8eef8"); g.addColorStop(0.5, "#c3ccda"); g.addColorStop(1, "#f6fbff");
  x.fillStyle = g; x.fillRect(0, 0, size, 64);
  x.strokeStyle = "rgba(255,255,255,0.7)"; x.lineWidth = 2; x.beginPath();
  for (let i = 0; i <= size; i += 8) { const y = 40 + Math.sin(i / 13) * 3 + Math.sin(i / 5) * 1.5; if (i === 0) x.moveTo(i, y); else x.lineTo(i, y); }
  x.stroke();
  return tex(c, { repeat: [1, 1] });
}
