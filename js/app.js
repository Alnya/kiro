import { BLACK, WHITE, newGame, applyMove, validMoves, count, flips } from "./othello.js";
import { Peer } from "./rtc.js";

const $ = (id) => document.getElementById(id);
const screens = ["menu", "host1", "host2", "join1", "join2", "game"];
let peer = null;
let myColor = null;
let game = null;
let lastMove = null;
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
    startGame();
  } else if ((state === "closed" || state === "disconnected" || state === "failed") && connected) {
    setMessage("相手との接続が切れました。");
  } else if (state === "failed" && !connected) {
    const s = myColor === BLACK ? $("host-status") : $("join-status");
    s.textContent = "接続に失敗しました。同じWi-Fiか確認して最初からやり直してください。";
  }
}

// ホスト
$("btn-host").onclick = async () => {
  myColor = BLACK;
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
  myColor = WHITE;
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

// ---------- ゲーム ----------
function startGame() {
  game = newGame();
  lastMove = null;
  show("game");
  $("you-label").textContent = "あなたは " + (myColor === BLACK ? "黒(先手)" : "白(後手)");
  setMessage("");
  render();
}

function render() {
  const board = $("board");
  const hints = game.turn === myColor && !game.over ? validMoves(game.board, myColor) : [];
  if (!board.children.length) {
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const c = document.createElement("div");
      c.className = "cell"; c.dataset.x = x; c.dataset.y = y;
      c.setAttribute("role", "gridcell");
      board.appendChild(c);
    }
  }
  for (const c of board.children) {
    const x = +c.dataset.x, y = +c.dataset.y, v = game.board[y][x];
    c.innerHTML = v ? `<div class="disc-lg ${v === BLACK ? "black" : "white"}"></div>` : "";
    c.classList.toggle("hint", hints.some(([hx, hy]) => hx === x && hy === y));
    c.classList.toggle("last", !!lastMove && lastMove[0] === x && lastMove[1] === y);
  }
  const n = count(game.board);
  document.querySelector("#score-black b").textContent = n.black;
  document.querySelector("#score-white b").textContent = n.white;
  $("score-black").classList.toggle("active", !game.over && game.turn === BLACK);
  $("score-white").classList.toggle("active", !game.over && game.turn === WHITE);
  if (game.over) {
    $("turn-label").textContent = n.black === n.white ? "引き分け" :
      ((n.black > n.white ? BLACK : WHITE) === myColor ? "あなたの勝ち!" : "あなたの負け");
  } else {
    $("turn-label").textContent = game.turn === myColor ? "あなたの番" : "相手の番";
  }
}

function setMessage(t) { $("message").textContent = t; }

function play(x, y, byMe) {
  const r = applyMove(game, x, y);
  if (!r) return false;
  lastMove = [x, y];
  if (r.passed) setMessage(byMe ? "相手は置ける場所がないのでパスです。" : "あなたは置ける場所がないのでパスです。");
  else setMessage("");
  render();
  return true;
}

$("board").addEventListener("click", (e) => {
  const c = e.target.closest(".cell");
  if (!c || !game || game.over || game.turn !== myColor) return;
  const x = +c.dataset.x, y = +c.dataset.y;
  if (!flips(game.board, x, y, myColor).length) return;
  if (play(x, y, true)) peer.send({ type: "move", x, y });
});

function onMessage(msg) {
  if (!game || !msg) return;
  if (msg.type === "move") {
    const { x, y } = msg;
    if (Number.isInteger(x) && Number.isInteger(y) && game.turn !== myColor) play(x, y, false);
  } else if (msg.type === "restart") {
    startGame();
    setMessage("相手がゲームを再開しました。");
  } else if (msg.type === "leave") {
    setMessage("相手が退出しました。");
  }
}

$("btn-restart").onclick = () => {
  if (!peer) return;
  peer.send({ type: "restart" });
  startGame();
};
$("btn-leave").onclick = () => {
  if (peer) peer.send({ type: "leave" });
  closePeer();
  game = null;
  show("menu");
};

show("menu");
