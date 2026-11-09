// 入力: キーボード + タッチ操作(左: 十字パッド/↓、右: ダッシュ・ジャンプ)
import { BTN } from "./sim.js";

export class Controls {
  constructor(host) {
    this.keys = 0;   // キーボード由来
    this.touch = 0;  // タッチ由来
    this.host = host;
    this.ptr = new Map(); // pointerId -> bit(s)
    host.insertAdjacentHTML("beforeend", `
      <div class="vs-pad">
        <div class="vs-left">
          <button class="vs-btn vs-down" data-bit="${BTN.D}" aria-label="しゃがむ・ヒップドロップ">▼</button>
          <div class="vs-dpad" aria-label="十字パッド"><span>◀</span><span>▶</span></div>
        </div>
        <div class="vs-right">
          <button class="vs-btn vs-run" data-bit="${BTN.RUN}" aria-label="ダッシュ・ファイア">ダッシュ</button>
          <button class="vs-btn vs-jump" data-bit="${BTN.J}" aria-label="ジャンプ">ジャンプ</button>
        </div>
      </div>`);
    this.pad = host.querySelector(".vs-pad");
    const bindBtn = (el) => {
      const bit = +el.dataset.bit;
      const down = (e) => { e.preventDefault(); el.setPointerCapture(e.pointerId); this.ptr.set(e.pointerId, bit); el.classList.add("on"); this.recalc(); };
      const up = (e) => { this.ptr.delete(e.pointerId); el.classList.remove("on"); this.recalc(); };
      el.addEventListener("pointerdown", down);
      el.addEventListener("pointerup", up);
      el.addEventListener("pointercancel", up);
      el.addEventListener("lostpointercapture", up);
    };
    this.pad.querySelectorAll(".vs-btn").forEach(bindBtn);

    const dpad = this.pad.querySelector(".vs-dpad");
    const dir = (e) => {
      const r = dpad.getBoundingClientRect();
      const rel = (e.clientX - r.left) / r.width;
      return rel < 0.42 ? BTN.L : rel > 0.58 ? BTN.R : 0;
    };
    dpad.addEventListener("pointerdown", (e) => { e.preventDefault(); dpad.setPointerCapture(e.pointerId); this.ptr.set(e.pointerId, dir(e)); this.recalc(); });
    dpad.addEventListener("pointermove", (e) => { if (this.ptr.has(e.pointerId)) { this.ptr.set(e.pointerId, dir(e)); this.recalc(); } });
    const dup = (e) => { this.ptr.delete(e.pointerId); this.recalc(); };
    dpad.addEventListener("pointerup", dup);
    dpad.addEventListener("pointercancel", dup);
    dpad.addEventListener("lostpointercapture", dup);

    const map = {
      ArrowLeft: BTN.L, KeyA: BTN.L, ArrowRight: BTN.R, KeyD: BTN.R,
      ArrowUp: BTN.J, KeyW: BTN.J, Space: BTN.J, KeyZ: BTN.J,
      ShiftLeft: BTN.RUN, ShiftRight: BTN.RUN, KeyX: BTN.RUN, KeyJ: BTN.RUN,
      ArrowDown: BTN.D, KeyS: BTN.D,
    };
    this.onKeyDown = (e) => { const b = map[e.code]; if (b) { e.preventDefault(); this.keys |= b; } };
    this.onKeyUp = (e) => { const b = map[e.code]; if (b) { e.preventDefault(); this.keys &= ~b; } };
    this.onBlur = () => { this.keys = 0; this.ptr.clear(); this.recalc(); };
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
  }

  recalc() {
    let b = 0;
    for (const v of this.ptr.values()) b |= v;
    this.touch = b;
    const dp = this.pad.querySelector(".vs-dpad");
    dp.classList.toggle("l", !!(b & BTN.L)); dp.classList.toggle("r", !!(b & BTN.R));
  }

  get bits() {
    let b = this.keys | this.touch;
    if ((b & BTN.L) && (b & BTN.R)) b &= ~(BTN.L | BTN.R);
    return b;
  }

  destroy() {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
  }
}
