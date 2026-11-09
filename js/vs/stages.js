// ステージ定義。すべて高さ14タイル(224px)固定で、縦スクロールなし。
// タイル記号: . 空 / # 地面 / I 氷 / B レンガ / ? アイテムブロック / Q コインブロック / U 使用済み
//            T,P 土管(上部,胴体) / o コイン
export const TILE = 16;
export const ROWS = 14;
export const SOLID = new Set(["#", "I", "B", "?", "Q", "U", "T", "P"]);

function blank(cols) {
  return Array.from({ length: ROWS }, () => Array(cols).fill("."));
}
function fill(g, x1, y1, x2, y2, ch) {
  for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) g[y][x] = ch;
}
function pipe(g, x, topRow) {
  fill(g, x, topRow, x + 1, topRow, "T");
  fill(g, x, topRow + 1, x + 1, 11, "P");
}

// 立っている足場のタイル座標 (x, y) = 「その上に立つ空きタイル」
function grass() {
  const cols = 60;
  const g = blank(cols);
  fill(g, 0, 12, cols - 1, 13, "#");
  fill(g, 22, 12, 23, 13, "."); // 穴
  fill(g, 44, 12, 46, 13, ".");
  pipe(g, 14, 10);
  pipe(g, 50, 9);
  // 序盤のブロックとコイン
  g[8][7] = "B"; g[8][8] = "?"; g[8][9] = "B";
  fill(g, 6, 5, 10, 5, "o");
  // 山(階段)
  const heights = [1, 2, 3, 3, 3, 3, 2, 1];
  heights.forEach((h, i) => fill(g, 28 + i, 12 - h, 28 + i, 11, "#"));
  // 空中のレンガ
  fill(g, 38, 7, 42, 7, "B"); g[7][40] = "?";
  fill(g, 38, 4, 42, 4, "o");
  // 地上のコイン
  fill(g, 17, 10, 20, 10, "o");
  fill(g, 54, 10, 56, 10, "o");
  g[8][25] = "Q"; g[8][26] = "Q";
  return {
    id: "grass", name: "くさはら", cols, wrap: true, ice: false, theme: "grass", grid: g,
    spawns: [{ x: 3, y: 11 }, { x: 56, y: 11 }],
    starSpawns: [
      { x: 3, y: 10 }, { x: 14, y: 8 }, { x: 24, y: 10 }, { x: 32, y: 7 },
      { x: 40, y: 5 }, { x: 50, y: 7 }, { x: 57, y: 10 }, { x: 8, y: 6 },
    ],
    goombas: [{ x: 11, y: 11 }, { x: 26, y: 11 }, { x: 37, y: 11 }, { x: 54, y: 11 }],
    koopas: [{ x: 18, y: 11 }, { x: 40, y: 11 }],
  };
}

function bricks() {
  const cols = 40;
  const g = blank(cols);
  fill(g, 0, 0, cols - 1, 0, "#");       // 天井
  fill(g, 0, 12, cols - 1, 13, "#");     // 床
  // 3段の足場(レンガ)
  fill(g, 2, 9, 10, 9, "B"); fill(g, 29, 9, 37, 9, "B");
  fill(g, 8, 6, 16, 6, "B"); fill(g, 23, 6, 31, 6, "B");
  fill(g, 14, 3, 25, 3, "B");
  g[9][6] = "?"; g[9][33] = "?";
  g[6][12] = "Q"; g[6][27] = "Q";
  g[3][19] = "?"; g[3][20] = "Q";
  // コイン
  fill(g, 3, 7, 9, 7, "o"); fill(g, 30, 7, 36, 7, "o");
  fill(g, 17, 10, 22, 10, "o");
  fill(g, 15, 1, 24, 1, "o");
  return {
    id: "bricks", name: "ちかのレンガ", cols, wrap: true, ice: false, theme: "bricks", grid: g,
    spawns: [{ x: 3, y: 11 }, { x: 36, y: 11 }],
    starSpawns: [
      { x: 5, y: 10 }, { x: 20, y: 10 }, { x: 35, y: 10 }, { x: 4, y: 7 },
      { x: 34, y: 7 }, { x: 10, y: 4 }, { x: 28, y: 4 }, { x: 19, y: 1 },
    ],
    goombas: [{ x: 5, y: 8 }, { x: 14, y: 11 }, { x: 33, y: 8 }],
    koopas: [{ x: 25, y: 11 }],
  };
}

function ice() {
  const cols = 56;
  const g = blank(cols);
  fill(g, 0, 0, 0, 13, "#");             // 左右の壁(ループしない)
  fill(g, cols - 1, 0, cols - 1, 13, "#");
  fill(g, 1, 12, cols - 2, 13, "I");
  fill(g, 18, 12, 20, 13, "."); // 穴
  fill(g, 34, 12, 36, 13, ".");
  // 氷の足場
  fill(g, 6, 9, 12, 9, "I"); fill(g, 42, 9, 49, 9, "I");
  fill(g, 14, 6, 22, 6, "I"); fill(g, 33, 6, 41, 6, "I");
  fill(g, 24, 4, 31, 4, "I");
  g[6][17] = "?"; g[6][37] = "?"; g[4][27] = "Q"; g[4][28] = "Q";
  fill(g, 7, 7, 11, 7, "o"); fill(g, 43, 7, 48, 7, "o");
  fill(g, 25, 2, 30, 2, "o");
  fill(g, 26, 10, 29, 10, "o");
  return {
    id: "ice", name: "こおりのだいち", cols, wrap: false, ice: true, theme: "ice", grid: g,
    spawns: [{ x: 3, y: 11 }, { x: 52, y: 11 }],
    starSpawns: [
      { x: 3, y: 10 }, { x: 9, y: 7 }, { x: 19, y: 4 }, { x: 27, y: 2 },
      { x: 28, y: 10 }, { x: 37, y: 4 }, { x: 45, y: 7 }, { x: 52, y: 10 },
    ],
    goombas: [{ x: 10, y: 11 }, { x: 44, y: 8 }],
    koopas: [{ x: 16, y: 5 }, { x: 40, y: 5 }],
  };
}

export const STAGE_LIST = [grass(), bricks(), ice()].map((s) => s);
export const STAGE_IDS = STAGE_LIST.map((s) => s.id);
export function makeStage(id) {
  const f = { grass, bricks, ice }[id] || grass;
  return f(); // 毎回作り直すので書き換えても元データは汚れない
}
