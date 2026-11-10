import { games } from "./games/index.js";
import { Peer } from "./rtc.js";

const $ = (id) => document.getElementById(id);
const screens = ["menu", "host1", "host2", "join1", "join2", "lobby", "game"];
let peer = null;
let role = 0; // 0=作成側(ホスト) 1=参加側
let current = null; // { id, inst }
let scanner = null;

// ================= セッション層 =================
// 通信が切れてもゲームを続けられるように、アプリ側で「届いたかどうか」を管理する。
//  - ゲームなどのメッセージには通し番号(q)を付け、相手から受信確認(ack)が来るまで outbox に残す。
//  - つなぎ直したら hello で「どこまで受け取ったか」を伝え合い、届いていない分だけ送り直す。
//  - 相手が同じ人(同じページを開いたまま)のときだけ再開する。片方がページを開き直した場合は新しい接続として扱う。
// 生のメッセージ: { type: "hello" | "ack" | "bye" }。番号付き: { q, m }(m の中身は従来どおり type: select / lobby / game / name)
const OUTBOX_MAX = 40000;          // 60回/秒のゲームで約5分ぶん。超えたら再開をあきらめる
const SILENT_MS = 7000;            // これだけ何も届かなければ「途切れている」とみなす
const session = {
  sid: Math.random().toString(36).slice(2) + Date.now().toString(36), // このページを開いている間の自分のID
  peerSid: null,     // 接続中(または直前まで接続していた)相手のID
  sendSeq: 0, recvSeq: 0, outbox: [],
  live: false,       // hello の交換が済み、番号付きメッセージを送ってよい
  broken: false,     // outbox があふれて再開できない
  started: false,    // 一度でも接続できた(ロビーに入った)
  lastHeard: 0,
};
let peerName = "";
let lost = null;     // 再接続ダイアログの状態: null | "soft"(自動復帰待ち) | "hard"(つなぎ直しが必要) | "repair"(つなぎ直し中)

// ================= 名前 =================
const NAME_KEY = "playerName";
function cleanName(s) {
  // 制御文字を除き、前後の空白を取り、12文字(サロゲートペアも1文字)まで
  return Array.from(String(s || "").replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e]/g, "").trim()).slice(0, 12).join("");
}
let myName = cleanName(localStorage.getItem(NAME_KEY) || "");
function oppLabel() { return peerName || "相手"; }
// ゲームに渡す名前(ゲーム側は表示のたびに読む)
const names = {
  get me() { return myName || "あなた"; },
  get opp() { return oppLabel(); },
  get rawMe() { return myName; },
  get rawOpp() { return peerName; },
};
function setMyName(v, from) {
  const n = cleanName(v);
  if (n === myName) return;
  myName = n;
  localStorage.setItem(NAME_KEY, n);
  for (const el of [$("my-name"), $("lobby-name")]) if (el !== from) el.value = n;
  if (session.live) rsend({ type: "name", name: n });
}
for (const el of [$("my-name"), $("lobby-name")]) {
  el.value = myName;
  el.addEventListener("input", () => setMyName(el.value, el));
  el.addEventListener("change", () => { el.value = myName; });
}
function updatePeerLabels() {
  const t = peerName ? `${peerName} さんと接続中` : "相手と接続中";
  $("lobby-peer").textContent = t;
  $("game-vs").textContent = current ? `vs ${oppLabel()}` : "";
  if (current && current.inst.onNames) { try { current.inst.onNames(); } catch (e) { console.error(e); } }
}

function show(name) {
  stopScan();
  for (const s of screens) $("screen-" + s).classList.toggle("hidden", s !== name);
}

// ---------- QR 表示 / 読み取り ----------
function renderQR(el, text) {
  try {
    const qr = qrcode(0, "L");
    qr.addData(text);
    qr.make();
    el.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  } catch {
    el.textContent = "QRコードにできませんでした。下のコードをコピーして送ってください。";
  }
}

async function startScan(video, onCode) {
  stopScan();
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    alert("カメラを使えません(HTTPSで開いているか確認してください)。コードの貼り付けをご利用ください。");
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
    video.srcObject = stream;
    video.classList.add("active");
    await video.play();
  } catch {
    alert("カメラを起動できませんでした。コードの貼り付けをご利用ください。");
    return;
  }
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  let alive = true;
  const tick = () => {
    if (!alive) return;
    if (video.readyState >= 2 && video.videoWidth) {
      canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const r = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
      if (r && r.data) { stopScan(); onCode(r.data); return; }
    }
    setTimeout(tick, 150);
  };
  scanner = { video, stop: () => { alive = false; } };
  tick();
}

function stopScan() {
  if (!scanner) return;
  scanner.stop();
  const v = scanner.video;
  if (v.srcObject) v.srcObject.getTracks().forEach((t) => t.stop());
  v.srcObject = null;
  v.classList.remove("active");
  scanner = null;
}

// ================= 接続 =================
function newPeer() {
  closePeer();
  session.live = false;
  const p = new Peer({
    onMessage: (m) => { if (p === peer) onRaw(m); },
    onState: (s) => { if (p === peer) onPeerState(s); },
  });
  peer = p;
}

function closePeer() {
  const p = peer;
  peer = null;
  session.live = false;
  if (p) p.close();
}

function onPeerState(state) {
  if (state === "open") { sendHello(); return; }
  if (!session.started) {
    if (state === "failed") {
      const s = role === 0 ? $("host-status") : $("join-status");
      s.textContent = "接続に失敗しました。同じWi-Fiか確認して最初からやり直してください。";
    }
    return;
  }
  if (lost === "repair") {
    // つなぎ直しに失敗したら、もう一度やり直せるようにする
    if (state === "failed") { lost = null; showLost("hard"); $("rc-msg").textContent = "接続に失敗しました。同じWi-Fiか確認して、もう一度つなぎ直してください。"; }
    return;
  }
  if (state === "disconnected") showLost("soft");
  else if (state === "connected") { if (lost === "soft") hideLost(); }
  else if (state === "failed" || state === "closed") { session.live = false; showLost("hard"); }
}

// ---------- セッション層の送受信 ----------
function rawSend(o) { if (peer) peer.send(o); }

// 番号付きで送る(切れている間は貯めておき、つなぎ直したら送る)
function rsend(m) {
  const q = ++session.sendSeq;
  session.outbox.push({ q, m });
  if (session.outbox.length > OUTBOX_MAX) { session.outbox.shift(); session.broken = true; }
  if (session.live) rawSend({ q, m });
}

function sendHello() {
  rawSend({ type: "hello", v: 1, sid: session.sid, peer: session.peerSid, recv: session.recvSeq, resumable: !session.broken && session.started, name: myName });
}

function onRaw(o) {
  if (!o) return;
  session.lastHeard = performance.now();
  if (lost === "soft") hideLost();
  if (o.type === "hello") { onHello(o); return; }
  if (o.type === "ack") { pruneOutbox(o.r); return; }
  if (o.type === "bye") { onBye(); return; }
  if (!session.live || typeof o.q !== "number") return;
  if (o.q !== session.recvSeq + 1) return;   // 重複(送り直し)は捨てる
  session.recvSeq = o.q;
  onMessage(o.m);
}

function pruneOutbox(r) {
  if (typeof r !== "number") return;
  const ob = session.outbox;
  let i = 0;
  while (i < ob.length && ob[i].q <= r) i++;
  if (i) ob.splice(0, i);
}

function onHello(h) {
  peerName = cleanName(h.name);
  const resume = session.started && h.resumable && !session.broken &&
    session.peerSid === h.sid && h.peer === session.sid;
  if (resume) {
    // 相手が受け取っていない分だけ送り直す
    pruneOutbox(h.recv);
    session.live = true;
    for (const e of session.outbox) rawSend({ q: e.q, m: e.m });
    hideLost();
    flash(`${oppLabel()} さんと再接続しました`);
    updatePeerLabels();
    return;
  }
  // 新しい接続(初回、または相手がページを開き直した)
  const wasStarted = session.started;
  session.peerSid = h.sid;
  session.sendSeq = 0; session.recvSeq = 0; session.outbox = []; session.broken = false;
  session.live = true; session.started = true;
  hideLost();
  startLobby();
  if (wasStarted) flash("新しい接続になったため、ゲーム選択に戻りました");
}

function onBye() {
  endSession(`${oppLabel()} さんが接続を終了しました`);
}

// 受信確認(兼・生存確認)を1秒ごとに送る。長く何も届かなければ途切れているとみなす
setInterval(() => {
  if (!session.live) return;
  rawSend({ type: "ack", r: session.recvSeq });
  if (session.started && !lost && performance.now() - session.lastHeard > SILENT_MS) showLost("soft");
}, 1000);

// ================= 再接続ダイアログ =================
function showLost(kind) {
  if (!session.started) return;
  if (lost === "repair") return;          // つなぎ直しの途中
  if (lost === "hard" && kind === "soft") return;
  lost = kind;
  const box = $("reconnect");
  box.classList.remove("hidden");
  $("rc-title").textContent = kind === "soft" ? "通信が途切れています" : "接続が切れました";
  $("rc-status").textContent = kind === "soft"
    ? "自動で復帰するのを待っています…(戻らないときは「つなぎ直す」)"
    : `もう一度つなぎ直せば、ゲームの続きから再開できます。${role === 0 ? "あなた(作成側)が新しい招待QRを出します。" : `${oppLabel()} さん(作成側)が新しい招待QRを出します。`}`;
  $("rc-start").classList.remove("hidden");
  $("rc-host").classList.add("hidden"); $("rc-guest").classList.add("hidden");
  $("rc-msg").textContent = "";
}
function hideLost() {
  if (!lost) return;
  lost = null;
  stopScan();
  $("reconnect").classList.add("hidden");
}
function flash(text) {
  setBanner(text);
  clearTimeout(flash.t);
  flash.t = setTimeout(() => setBanner(""), 3500);
}

// 「つなぎ直す」: 役割(作成側/参加側)はそのままで、接続情報だけ交換し直す
$("rc-start").onclick = async () => {
  lost = "repair";
  $("rc-start").classList.add("hidden");
  $("rc-title").textContent = "つなぎ直し";
  $("rc-status").textContent = role === 0 ? "" : `${oppLabel()} さん(作成側)の画面に新しい招待QRが出ます。`;
  $("rc-msg").textContent = "";
  newPeer();
  if (role === 0) {
    $("rc-host").classList.remove("hidden");
    $("rc-hqr").textContent = "作成中…"; $("rc-hcode").value = ""; $("rc-answer").value = "";
    try {
      const code = await peer.createOffer();
      $("rc-hcode").value = code;
      renderQR($("rc-hqr"), code);
    } catch (e) { $("rc-hqr").textContent = "作成に失敗しました: " + e.message; }
  } else {
    $("rc-guest").classList.remove("hidden");
    $("rc-greply").classList.add("hidden"); $("rc-offer").value = "";
  }
};
$("rc-hcopy").onclick = () => copyText($("rc-hcode"), $("rc-hcopy"));
$("rc-gcopy").onclick = () => copyText($("rc-gcode"), $("rc-gcopy"));
$("rc-hscan").onclick = () => startScan($("rc-hvideo"), (code) => { $("rc-answer").value = code; rcConnect(); });
$("rc-connect").onclick = rcConnect;
async function rcConnect() {
  $("rc-msg").textContent = "接続中…";
  try { await peer.acceptAnswer($("rc-answer").value); }
  catch (e) { $("rc-msg").textContent = "エラー: " + e.message; }
}
$("rc-gscan").onclick = () => startScan($("rc-gvideo"), (code) => { $("rc-offer").value = code; rcReply(); });
$("rc-reply").onclick = rcReply;
async function rcReply() {
  $("rc-msg").textContent = "返信コードを作成中…";
  try {
    if (peer.pc.remoteDescription) newPeer();   // 2回目の読み取りでは接続を作り直す
    const code = await peer.acceptOffer($("rc-offer").value);
    $("rc-gcode").value = code;
    renderQR($("rc-gqr"), code);
    $("rc-greply").classList.remove("hidden");
    $("rc-msg").textContent = "相手の接続を待っています…";
  } catch (e) { $("rc-msg").textContent = "エラー: " + e.message; }
}
$("rc-quit").onclick = () => endSession("");

// ================= 最初の接続 =================
// ホスト
$("btn-host").onclick = async () => {
  role = 0;
  newPeer();
  show("host1");
  $("host-next").disabled = true;
  $("host-qr").textContent = "作成中…";
  $("host-code").value = "";
  try {
    const code = await peer.createOffer();
    $("host-code").value = code;
    renderQR($("host-qr"), code);
    $("host-next").disabled = false;
  } catch (e) {
    $("host-qr").textContent = "作成に失敗しました: " + e.message;
  }
};
$("host-next").onclick = () => { $("host-status").textContent = ""; show("host2"); };
$("host-scan").onclick = () => startScan($("host-video"), (code) => { $("host-answer").value = code; connectHost(); });
$("host-connect").onclick = connectHost;
async function connectHost() {
  $("host-status").textContent = "接続中…";
  try {
    await peer.acceptAnswer($("host-answer").value);
  } catch (e) {
    $("host-status").textContent = "エラー: " + e.message;
  }
}

// ゲスト
$("btn-join").onclick = () => {
  role = 1;
  newPeer();
  $("join-offer").value = "";
  $("join-status").textContent = "";
  show("join1");
};
$("join-scan").onclick = () => startScan($("join-video"), (code) => { $("join-offer").value = code; makeAnswer(); });
$("join-next").onclick = makeAnswer;
async function makeAnswer() {
  $("join-status").textContent = "返信コードを作成中…";
  try {
    const code = await peer.acceptOffer($("join-offer").value);
    $("join-code").value = code;
    renderQR($("join-qr"), code);
    $("join-status").textContent = "";
    show("join2");
  } catch (e) {
    $("join-status").textContent = "エラー: " + e.message;
  }
}

// コピー
async function copyText(textarea, btn) {
  try { await navigator.clipboard.writeText(textarea.value); }
  catch { textarea.select(); document.execCommand("copy"); }
  const old = btn.textContent;
  btn.textContent = "コピーしました";
  setTimeout(() => (btn.textContent = old), 1200);
}
$("host-copy").onclick = () => copyText($("host-code"), $("host-copy"));
$("join-copy").onclick = () => copyText($("join-code"), $("join-copy"));

// 戻る
document.querySelectorAll(".back").forEach((b) => (b.onclick = () => { closePeer(); show("menu"); }));

// ================= ロビー / ゲーム切り替え =================
function setBanner(t) {
  document.querySelectorAll(".conn-banner").forEach((el) => (el.textContent = t));
}

function destroyGame() {
  if (current) current.inst.destroy();
  current = null;
  $("game-root").innerHTML = "";
  $("game-vs").textContent = "";
}

function startLobby() {
  destroyGame();
  setBanner("");
  const list = $("game-list");
  if (!list.children.length) {
    for (const g of games) {
      const b = document.createElement("button");
      b.className = "game-card";
      b.innerHTML = `<b></b><span></span>`;
      b.firstChild.textContent = g.name;
      b.lastChild.textContent = g.desc;
      b.onclick = () => { rsend({ type: "select", id: g.id }); launch(g.id); };
      list.appendChild(b);
    }
  }
  $("lobby-name").value = myName;
  updatePeerLabels();
  show("lobby");
}

function launch(id) {
  const def = games.find((g) => g.id === id);
  if (!def) return;
  destroyGame();
  show("game");
  $("game-title").textContent = def.name;
  current = {
    id,
    inst: def.create({
      root: $("game-root"),
      role,
      names,
      send: (data) => rsend({ type: "game", id, data }),
    }),
  };
  updatePeerLabels();
}

function onMessage(msg) {
  if (!msg) return;
  if (msg.type === "select") launch(msg.id);
  else if (msg.type === "lobby") startLobby();
  else if (msg.type === "name") { peerName = cleanName(msg.name); updatePeerLabels(); }
  else if (msg.type === "game" && current && current.id === msg.id) current.inst.onMessage(msg.data);
}

// 接続を完全に終える(相手にも伝える)
function endSession(note) {
  if (session.live) rawSend({ type: "bye" });
  const p = peer;
  peer = null;
  // bye が届くよう少し待ってから閉じる
  if (p) setTimeout(() => p.close(), 300);
  session.live = false; session.started = false; session.peerSid = null;
  session.outbox = []; session.sendSeq = 0; session.recvSeq = 0; session.broken = false;
  peerName = "";
  lost = null; stopScan(); $("reconnect").classList.add("hidden");
  destroyGame();
  show("menu");
  $("my-name").value = myName;
  $("menu-msg").textContent = note || "";
}

$("btn-to-lobby").onclick = () => { rsend({ type: "lobby" }); startLobby(); };
$("btn-disconnect").onclick = () => endSession("");

// テスト用(?debug を付けたときだけ)
if (new URLSearchParams(location.search).has("debug")) window.__app = { get peer() { return peer; }, session, names, get lost() { return lost; } };

show("menu");
