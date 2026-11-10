import { BLACK, WHITE, newGame, applyMove, validMoves, count, flips } from "../othello.js";

function create({ root, role, send, names = { opp: "相手" } }) {
  const myColor = role === 0 ? BLACK : WHITE;
  let game = newGame();
  let lastMove = null;
  let message = "";

  root.innerHTML = `
    <div class="scorebar">
      <div class="score s-black"><span class="disc black"></span><b>2</b></div>
      <div class="turn-label">—</div>
      <div class="score s-white"><span class="disc white"></span><b>2</b></div>
    </div>
    <div class="you-label">あなたは ${myColor === BLACK ? "黒(先手)" : "白(後手)"}</div>
    <div class="board board-8" role="grid" aria-label="オセロ盤"></div>
    <p class="status" aria-live="polite"></p>
    <div class="row"><button class="restart">もう一度</button></div>`;
  const $ = (s) => root.querySelector(s);
  const board = $(".board");
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const c = document.createElement("div");
    c.className = "cell"; c.dataset.x = x; c.dataset.y = y;
    c.setAttribute("role", "gridcell");
    board.appendChild(c);
  }

  function render() {
    const hints = game.turn === myColor && !game.over ? validMoves(game.board, myColor) : [];
    for (const c of board.children) {
      const x = +c.dataset.x, y = +c.dataset.y, v = game.board[y][x];
      c.innerHTML = v ? `<div class="disc-lg ${v === BLACK ? "black" : "white"}"></div>` : "";
      c.classList.toggle("hint", hints.some(([hx, hy]) => hx === x && hy === y));
      c.classList.toggle("last", !!lastMove && lastMove[0] === x && lastMove[1] === y);
    }
    const n = count(game.board);
    $(".s-black b").textContent = n.black;
    $(".s-white b").textContent = n.white;
    $(".s-black").classList.toggle("active", !game.over && game.turn === BLACK);
    $(".s-white").classList.toggle("active", !game.over && game.turn === WHITE);
    $(".turn-label").textContent = game.over
      ? (n.black === n.white ? "引き分け" : ((n.black > n.white ? BLACK : WHITE) === myColor ? "あなたの勝ち!" : `${names.opp}の勝ち`))
      : (game.turn === myColor ? "あなたの番" : `${names.opp}の番`);
    $(".status").textContent = message;
  }

  function play(x, y, byMe) {
    const r = applyMove(game, x, y);
    if (!r) return false;
    lastMove = [x, y];
    message = r.passed ? (byMe ? `${names.opp}は置ける場所がないのでパスです。` : "あなたは置ける場所がないのでパスです。") : "";
    render();
    return true;
  }

  function reset(msg) {
    game = newGame(); lastMove = null; message = msg || "";
    render();
  }

  board.addEventListener("click", (e) => {
    const c = e.target.closest(".cell");
    if (!c || game.over || game.turn !== myColor) return;
    const x = +c.dataset.x, y = +c.dataset.y;
    if (!flips(game.board, x, y, myColor).length) return;
    if (play(x, y, true)) send({ t: "move", x, y });
  });
  $(".restart").onclick = () => { send({ t: "restart" }); reset(); };

  render();
  return {
    onMessage(m) {
      if (m.t === "move" && Number.isInteger(m.x) && Number.isInteger(m.y) && game.turn !== myColor) play(m.x, m.y, false);
      else if (m.t === "restart") reset(`${names.opp}がゲームを再開しました。`);
    },
    onNames() { render(); },
    destroy() {},
  };
}

export default { id: "othello", name: "オセロ", desc: "8×8の定番。黒(先手)は作成側", create };
