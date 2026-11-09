// 四目並べ(7列×6行)。縦・横・斜めに4つ並べたら勝ち。
const COLS = 7, ROWS = 6;

// 勝ち判定。揃っていれば座標4つ以上の配列、なければ null
export function findWin(b) {
  const dirs = [[1, 0], [0, 1], [1, 1], [1, -1]];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const p = b[r][c];
    if (!p) continue;
    for (const [dc, dr] of dirs) {
      const cells = [];
      for (let k = 0; k < 4; k++) {
        const rr = r + dr * k, cc = c + dc * k;
        if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS || b[rr][cc] !== p) break;
        cells.push([rr, cc]);
      }
      if (cells.length === 4) return cells;
    }
  }
  return null;
}

function create({ root, role, send }) {
  const me = role + 1; // 1=赤(先手) 2=黄
  let board, turn, win, over, round = 0, message = "";

  root.innerHTML = `
    <div class="scorebar">
      <div class="score s1"><span class="disc red"></span></div>
      <div class="turn-label">—</div>
      <div class="score s2"><span class="disc yellow"></span></div>
    </div>
    <div class="you-label">あなたは ${me === 1 ? "赤" : "黄"}</div>
    <div class="board board-c4" role="grid" aria-label="四目並べ"></div>
    <p class="status" aria-live="polite"></p>
    <div class="row"><button class="restart">もう一度</button></div>`;
  const $ = (s) => root.querySelector(s);
  const el = $(".board");
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const d = document.createElement("div");
    d.className = "c4cell"; d.dataset.r = r; d.dataset.c = c;
    d.setAttribute("role", "gridcell");
    el.appendChild(d);
  }

  function reset(msg) {
    board = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
    turn = round % 2 === 0 ? 1 : 2; // 先手は毎回交代
    round++;
    win = null; over = false; message = msg || "";
    render();
  }

  function render() {
    const winSet = new Set((win || []).map(([r, c]) => r * COLS + c));
    for (const d of el.children) {
      const r = +d.dataset.r, c = +d.dataset.c, v = board[r][c];
      d.innerHTML = v ? `<div class="disc-lg ${v === 1 ? "red" : "yellow"}"></div>` : "";
      d.classList.toggle("win", winSet.has(r * COLS + c));
    }
    $(".s1").classList.toggle("active", !over && turn === 1);
    $(".s2").classList.toggle("active", !over && turn === 2);
    $(".turn-label").textContent = over
      ? (win ? (board[win[0][0]][win[0][1]] === me ? "あなたの勝ち!" : "あなたの負け") : "引き分け")
      : (turn === me ? "あなたの番" : "相手の番");
    $(".status").textContent = message;
  }

  // 列 c にコマを落とす。成功すれば true
  function drop(c, p) {
    if (over || turn !== p || !(c >= 0 && c < COLS)) return false;
    for (let r = ROWS - 1; r >= 0; r--) {
      if (!board[r][c]) {
        board[r][c] = p;
        win = findWin(board);
        if (win || board[0].every(Boolean)) over = true; else turn = p === 1 ? 2 : 1;
        message = "";
        render();
        return true;
      }
    }
    return false;
  }

  el.addEventListener("click", (e) => {
    const d = e.target.closest(".c4cell");
    if (!d) return;
    const c = +d.dataset.c;
    if (drop(c, me)) send({ t: "drop", c });
  });
  $(".restart").onclick = () => { send({ t: "restart" }); reset(); };

  reset();
  return {
    onMessage(m) {
      if (m.t === "drop" && Number.isInteger(m.c)) drop(m.c, me === 1 ? 2 : 1);
      else if (m.t === "restart") reset("相手がゲームを再開しました。");
    },
    destroy() {},
  };
}

export default { id: "connect4", name: "四目並べ", desc: "縦・横・斜めに4つ並べよう。先手は毎回交代", create };
