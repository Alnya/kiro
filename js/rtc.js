// WebRTC DataChannel を、手動(QR/コピー)シグナリングで接続する。
const ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];
const GATHER_TIMEOUT_MS = 4000;

// ---- 接続情報のエンコード/デコード(可能なら deflate 圧縮 + base64url) ----
const b64 = {
  enc(bytes) {
    let s = "";
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  },
  dec(str) {
    str = str.replace(/-/g, "+").replace(/_/g, "/");
    while (str.length % 4) str += "=";
    return Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
  },
};

async function pipe(bytes, stream) {
  const out = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

export async function encodeSignal(desc) {
  const raw = new TextEncoder().encode(JSON.stringify({ t: desc.type, s: desc.sdp }));
  if (typeof CompressionStream !== "undefined") {
    try {
      return "OT1." + b64.enc(await pipe(raw, new CompressionStream("deflate-raw")));
    } catch { /* フォールバック */ }
  }
  return "OT0." + b64.enc(raw);
}

export async function decodeSignal(text) {
  text = text.trim();
  const m = /^OT([01])\.([A-Za-z0-9_-]+)$/.exec(text);
  if (!m) throw new Error("接続コードの形式が正しくありません");
  let bytes = b64.dec(m[2]);
  if (m[1] === "1") {
    if (typeof DecompressionStream === "undefined") {
      throw new Error("このブラウザは圧縮された接続コードに対応していません");
    }
    bytes = await pipe(bytes, new DecompressionStream("deflate-raw"));
  }
  const o = JSON.parse(new TextDecoder().decode(bytes));
  return { type: o.t, sdp: o.s };
}

// ---- 接続クラス ----
export class Peer {
  constructor({ onMessage, onState }) {
    this.onMessage = onMessage;
    this.onState = onState;
    this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.channel = null;
    this.pc.addEventListener("connectionstatechange", () => this.onState(this.pc.connectionState));
  }

  _setupChannel(ch) {
    this.channel = ch;
    ch.addEventListener("open", () => this.onState("open"));
    ch.addEventListener("close", () => this.onState("closed"));
    ch.addEventListener("message", (e) => {
      try { this.onMessage(JSON.parse(e.data)); } catch { /* 不正メッセージは無視 */ }
    });
  }

  _gathered() {
    return new Promise((resolve) => {
      if (this.pc.iceGatheringState === "complete") return resolve();
      const done = () => { clearTimeout(t); this.pc.removeEventListener("icegatheringstatechange", check); resolve(); };
      const check = () => { if (this.pc.iceGatheringState === "complete") done(); };
      const t = setTimeout(done, GATHER_TIMEOUT_MS);
      this.pc.addEventListener("icegatheringstatechange", check);
    });
  }

  // ホスト: 招待コードを作る
  async createOffer() {
    this._setupChannel(this.pc.createDataChannel("othello"));
    await this.pc.setLocalDescription(await this.pc.createOffer());
    await this._gathered();
    return encodeSignal(this.pc.localDescription);
  }

  // ゲスト: 招待コードを受け取り、返信コードを作る
  async acceptOffer(code) {
    this.pc.addEventListener("datachannel", (e) => this._setupChannel(e.channel));
    await this.pc.setRemoteDescription(await decodeSignal(code));
    await this.pc.setLocalDescription(await this.pc.createAnswer());
    await this._gathered();
    return encodeSignal(this.pc.localDescription);
  }

  // ホスト: 返信コードを受け取って接続完了
  async acceptAnswer(code) {
    await this.pc.setRemoteDescription(await decodeSignal(code));
  }

  send(obj) {
    if (this.channel && this.channel.readyState === "open") this.channel.send(JSON.stringify(obj));
  }

  close() { try { this.pc.close(); } catch { /* noop */ } }
}
