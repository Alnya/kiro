// オセロのルール(純粋ロジック)。0=空, 1=黒(先手), 2=白(後手)
export const EMPTY = 0, BLACK = 1, WHITE = 2;
const DIRS = [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]];

export const opponent = (p) => (p === BLACK ? WHITE : BLACK);

export function initialBoard() {
  const b = Array.from({ length: 8 }, () => Array(8).fill(EMPTY));
  b[3][3] = WHITE; b[4][4] = WHITE;
  b[3][4] = BLACK; b[4][3] = BLACK;
  return b;
}

// 置いたときにひっくり返る座標一覧(置けなければ空配列)
export function flips(board, x, y, player) {
  if (x < 0 || x > 7 || y < 0 || y > 7 || board[y][x] !== EMPTY) return [];
  const result = [];
  for (const [dx, dy] of DIRS) {
    const line = [];
    let cx = x + dx, cy = y + dy;
    while (cx >= 0 && cx < 8 && cy >= 0 && cy < 8 && board[cy][cx] === opponent(player)) {
      line.push([cx, cy]);
      cx += dx; cy += dy;
    }
    if (line.length && cx >= 0 && cx < 8 && cy >= 0 && cy < 8 && board[cy][cx] === player) {
      result.push(...line);
    }
  }
  return result;
}

export function validMoves(board, player) {
  const moves = [];
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++)
      if (flips(board, x, y, player).length) moves.push([x, y]);
  return moves;
}

export function count(board) {
  let black = 0, white = 0;
  for (const row of board) for (const c of row) {
    if (c === BLACK) black++; else if (c === WHITE) white++;
  }
  return { black, white };
}

// ゲーム状態。{board, turn, over}
export function newGame() {
  return { board: initialBoard(), turn: BLACK, over: false };
}

// 着手を適用。不正なら null、成功なら {flipped, passed}
// passed: 次の手番が置けず、手番が元のプレイヤーに戻った場合 true
export function applyMove(game, x, y) {
  if (game.over) return null;
  const f = flips(game.board, x, y, game.turn);
  if (!f.length) return null;
  game.board[y][x] = game.turn;
  for (const [fx, fy] of f) game.board[fy][fx] = game.turn;
  const next = opponent(game.turn);
  let passed = false;
  if (validMoves(game.board, next).length) {
    game.turn = next;
  } else if (validMoves(game.board, game.turn).length) {
    passed = true; // 相手はパス、同じプレイヤーが続行
  } else {
    game.over = true;
  }
  return { flipped: f, passed };
}
