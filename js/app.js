import { games } from "./games/index.js";
import { Peer } from "./rtc.js";

const $ = (id) => document.getElementById(id);
const screens = ["menu", "host1", "host2", "join1", "join2", "lobby", "game"];
let peer = null;
let role = 0; // 0=作成側(ホスト) 1=参加側
let current = null; // { id, inst }
let scanner = null;
let connected = false;

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

// ---------- 接続の流れ ----------
function newPeer() {
  closePeer();
  connected = false;
  peer = new Peer({ onMessage: onMessage, onState: onPeerState });
}

function closePeer() {
  if (peer) peer.close();
  peer = null;
}

function onPeerState(state) {
  if (state === "open" && !connected) {
    connected = true;
    startLobby();
  } else if ((state === "closed" || state === "disconnected" || state === "failed") && connected) {
    setBanner("相手との接続が切れました。");
  } else if (state === "failed" && !connected) {
    const s = role === 0 ? $("host-status") : $("join-status");
    s.textContent = "接続に失敗しました。同じWi-Fiか確認して最初からやり直してください。";
  }
}

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

// ---------- ロビー / ゲーム切り替え ----------
function setBanner(t) {
  document.querySelectorAll(".conn-banner").forEach((el) => (el.textContent = t));
}

function destroyGame() {
  if (current) current.inst.destroy();
  current = null;
  $("game-root").innerHTML = "";
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
      b.onclick = () => { peer && peer.send({ type: "select", id: g.id }); launch(g.id); };
      list.appendChild(b);
    }
  }
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
      send: (data) => peer && peer.send({ type: "game", id, data }),
    }),
  };
}

function onMessage(msg) {
  if (!msg) return;
  if (msg.type === "select") launch(msg.id);
  else if (msg.type === "lobby") startLobby();
  else if (msg.type === "game" && current && current.id === msg.id) current.inst.onMessage(msg.data);
}

$("btn-to-lobby").onclick = () => { peer && peer.send({ type: "lobby" }); startLobby(); };
$("btn-disconnect").onclick = () => { closePeer(); destroyGame(); show("menu"); };

show("menu");

