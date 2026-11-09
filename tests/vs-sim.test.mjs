// 実行: node tests/vs-sim.test.mjs
import { Sim, BTN } from "../js/vs/sim.js";
import { STAGE_IDS, TILE } from "../js/vs/stages.js";

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log("  NG:", m); } else console.log("  ok:", m); };
const mk = (stage, o = {}) => new Sim(stage, { stars: 3, lives: 3, seed: 1234, ...o });
const run = (s, n, f = () => [0, 0]) => { for (let i = 0; i < n; i++) s.step(f(i)); };

for (const id of STAGE_IDS) {
  console.log(`[${id}] 初期化と着地`);
  const s = mk(id);
  run(s, 120);
  ok(s.players.every((p) => p.ground), "両プレイヤーが着地している");
  ok(s.stars.length === 1 && s.fieldStar, "開始時にビッグスターが1つある");
}

console.log("[決定論] ランダム入力を同じ列で2つのSimに与えて一致するか");
for (const id of STAGE_IDS) {
  const a = mk(id), b = mk(id);
  let seed = 99; const r = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const seq = Array.from({ length: 4000 }, () => [Math.floor(r() * 32), Math.floor(r() * 32)]);
  run(a, 4000, (i) => seq[i]); run(b, 4000, (i) => seq[i]);
  ok(a.hash() === b.hash(), `${id}: 4000フレーム後のハッシュ一致 (${a.hash()})`);
  const bad = a.players.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y));
  ok(!bad, `${id}: 座標が有限値`);
}

console.log("[星の取得とレベルリセット]");
{
  const s = mk("grass");
  const p = s.players[0], st = s.fieldStar;
  run(s, 30);
  p.x = st.x; p.y = st.y; p.vy = 0;
  s.step([0, 0]);
  ok(p.stars === 1, "星を取るとstars=1");
  ok(s.fieldStar === null && s.starTimer === 600, "10秒後に次の星(タイマー600)");
  run(s, 599);
  ok(!s.fieldStar, "599フレーム後はまだ星が出ない");
  run(s, 2);
  ok(!!s.fieldStar, "約10秒後に次の星が出現");
}

console.log("[踏みつけ/ヒップドロップ]");
{
  const s = mk("grass");
  run(s, 60);
  const a = s.players[0], b = s.players[1];
  b.stars = 2; a.stars = 0;
  b.x = 300; b.y = 192 - b.h; b.vx = 0;
  a.x = 300; a.y = b.y - a.h + 4; a.vy = 3; a.vx = 0; a.ground = false;
  s.step([0, 0]);
  ok(b.stars === 1, "踏まれて星-1 (stars=" + b.stars + ")");
  ok(s.stars.filter((x) => !x.field).length === 1, "落とした星が1つ出る");
  ok(b.stun > 0, "踏まれた側はスタン");
  // ヒップドロップは3つ
  const s2 = mk("grass");
  run(s2, 60);
  const c = s2.players[0], d = s2.players[1];
  d.stars = 5; d.x = 300; d.y = 192 - d.h; d.vx = 0;
  c.x = 300; c.y = 192 - d.h - c.h - 20; c.vy = 0; c.ground = false;
  s2.step([BTN.D, 0]); // ドロップ開始(↓エッジ)
  run(s2, 40);
  ok(d.stars === 2, "ヒップドロップで星-3 (stars=" + d.stars + ")");
}

console.log("[ライフ・勝敗]");
{
  const s = mk("bricks", { lives: 3 });
  const a = s.players[0];
  for (let i = 0; i < 3; i++) {
    s.kill(a, "test");
    run(s, 100);
  }
  ok(a.out && s.over && s.over.winner === 1, "ライフ0で相手の勝ち");
  const s2 = mk("bricks", { stars: 3 });
  s2.players[0].stars = 2;
  run(s2, 20);
  const st = s2.fieldStar; s2.players[0].x = st.x; s2.players[0].y = st.y; s2.step([0, 0]);
  ok(s2.over && s2.over.winner === 0, "目標スターで勝ち");
}

console.log("[コイン8枚でアイテム]");
{
  const s = mk("grass");
  run(s, 10);
  const p = s.players[0];
  s.addCoins(p, 8, 0, 0);
  ok(p.coins === 0 && s.items.length === 1 && s.items[0].y < 0, "アイテムが上から降る");
  run(s, 300);
  ok(s.items.length <= 1, "アイテムは落ちて存在 or 回収");
}

console.log("[ループ(ラップ)ステージを一周]");
{
  const s = mk("grass");
  run(s, 60);
  const p = s.players[0];
  p.x = s.W - 30; p.y = 192 - p.h;
  const startX = p.x;
  let moved = 0;
  for (let i = 0; i < 200; i++) { s.step([BTN.R | BTN.RUN, 0]); if (p.x < startX - 100) moved++; }
  ok(p.x >= 0 && p.x < s.W, "x が [0, W) に正規化されている x=" + p.x.toFixed(1));
  ok(moved > 0, "右端を越えて左端に出た");
}

console.log("[アイテム効果]");
{
  const s = mk("grass");
  run(s, 30);
  const p = s.players[0];
  s.applyItem(p, "mushroom"); run(s, 2);
  ok(p.form === "big" && p.h === 26, "スーパーキノコで大きくなる");
  s.applyItem(p, "flower"); ok(p.form === "fire", "ファイアフラワー");
  s.applyItem(p, "mega"); run(s, 2);
  ok(p.mega > 0 && p.h === 44, "巨大キノコで巨大化");
  s.applyItem(p, "mini");
  ok(p.mini > 0 && p.mega === 0, "ミニキノコで巨大化解除");
}

console.log(fails ? `\n失敗 ${fails} 件` : "\n全テスト成功");
process.exit(fails ? 1 : 0);
