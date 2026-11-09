// 実行: node tests/spire-rules.test.mjs — 主要ルール(ダメージ計算・協力要素・復活など)の検証
import { Game } from "../js/spire/engine.js";
import { ENEMIES } from "../js/spire/data.js";

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log("  NG:", m); } else console.log("  ok:", m); };

function battle(c0 = "knight", c1 = "ranger", enemies = ["cultist"]) {
  const g = new Game({ seed: 321, classes: [c0, c1] });
  g.apply({ type: "vote", node: g.options()[0] }, 0);
  g.apply({ type: "vote", node: g.options()[0] }, 1);
  g.s.battle.enemies.length = 0;
  for (const id of enemies) g.spawn(id);
  g.apply({ type: "end" }, 0); g.apply({ type: "end" }, 0); // 状態を整える(無効でもよい)
  return g;
}
const hand = (g, pi, ...ids) => { const p = g.P(pi); p.hand = ids.map((c, i) => ({ c, u: 0, id: 9000 + pi * 100 + i })); p.energy = 9; return p.hand.map((c) => c.id); };

console.log("[ダメージ計算]");
{
  const g = battle(); const e = g.s.battle.enemies[0];
  e.hp = e.maxHp = 500;
  const [a] = hand(g, 0, "strike");
  g.apply({ type: "play", uid: a, target: { k: "e", i: 0 } }, 0);
  ok(e.hp === 494, "ストライクは6ダメージ");
  e.st.vuln = 2; const [b] = hand(g, 0, "strike");
  g.apply({ type: "play", uid: b, target: { k: "e", i: 0 } }, 0);
  ok(e.hp === 485, "弱点中は1.5倍(9)");
  g.P(0).st.str = 3; g.P(0).st.weak = 1; const [c] = hand(g, 0, "strike");
  g.apply({ type: "play", uid: c, target: { k: "e", i: 0 } }, 0);
  ok(e.hp === 485 - Math.floor((6 + 3) * 0.75 * 1.5), "筋力+3、脱力、弱点の合成");
}

console.log("[協力: 挑発・ブロック共有]");
{
  const g = battle("knight", "ranger", ["goblin", "goblin"]);
  const a = hand(g, 0, "tauntRoar")[0];
  g.apply({ type: "play", uid: a, target: null }, 0);
  ok(g.P(0).st.taunt === 1, "挑発の咆哮でtauntが付く");
  g.P(0).block = 0; g.P(1).block = 0;
  const hp1 = g.P(1).hp;
  for (const e of g.s.battle.enemies) { e.move = "stab"; e.tgt = 1; }
  g.apply({ type: "end" }, 0); g.apply({ type: "end" }, 1);
  ok(g.P(1).hp === hp1, "挑発中は味方が攻撃されない");

  const g2 = battle();
  const [s] = hand(g2, 1, "smokeBomb");
  g2.apply({ type: "play", uid: s, target: null }, 1);
  ok(g2.P(0).block === 8 && g2.P(1).block === 8, "煙幕で味方全員にブロック8");
  const [l, d] = hand(g2, 0, "aegisLink", "defend");
  g2.P(0).block = 0; g2.P(1).block = 0;
  g2.apply({ type: "play", uid: l, target: null }, 0);
  g2.apply({ type: "play", uid: d, target: null }, 0);
  ok(g2.P(0).block === 5 && g2.P(1).block === 2, "守りの絆: 自分5、味方2");
  const [m] = hand(g2, 0, "guardianOath");
  g2.apply({ type: "play", uid: m, target: { k: "p", i: 0 } }, 0);
  ok(g2.P(0).block === 5, "味方カードは自分を対象にできない");
}

console.log("[敵のHPスケール(2人 ×2.2)]");
{
  const g = battle("knight", "mage", []);
  const e = g.spawn("chomper");
  ok(e.maxHp >= Math.round(40 * 2.2) && e.maxHp <= Math.round(44 * 2.2), `あごむしHP ${e.maxHp} (88〜97)`);
}

console.log("[毒・ターン経過]");
{
  const g = battle("mage", "mage", ["brute"]);
  const e = g.s.battle.enemies[0]; e.hp = e.maxHp = 300;
  const [v] = hand(g, 0, "neurotoxin");
  g.apply({ type: "play", uid: v, target: { k: "e", i: 0 } }, 0);
  ok(e.st.poison === 7, "毒7");
  g.apply({ type: "end" }, 0); g.apply({ type: "end" }, 1);
  ok(e.hp === 293 && e.st.poison === 6, `敵ターンで毒ダメージ(hp ${e.hp}, 毒 ${e.st.poison})`);
  ok(g.s.battle.turn === 2 && g.P(0).hand.length > 0 && g.P(0).energy === 3 && g.P(0).block === 0, "次のターンに進み、エナジー3・手札が配られる");
}

console.log("[倒れた味方は戦闘後HP1で復活]");
{
  const g = battle("knight", "ranger", ["slime"]);
  g.P(1).hp = 1; g.dealDamage(null, g.P(1), 50);
  ok(g.P(1).dead, "HP0で戦闘不能");
  const e = g.s.battle.enemies[0]; e.hp = 1;
  const [s] = hand(g, 0, "strike");
  const st = g.apply({ type: "play", uid: s, target: { k: "e", i: 0 } }, 0);
  ok(g.s.phase === "reward", "敵を倒して報酬画面へ");
  ok(!g.P(1).dead && g.P(1).hp === 1, "倒れた味方がHP1で復活");
  ok(g.s.rew[0].cards.length === 3 && g.s.rew[1].cards.length === 3, "報酬カードは各自3枚");
  g.apply({ type: "pickCard", idx: 0 }, 0); g.apply({ type: "skipCard" }, 1);
  ok(g.s.phase === "map", "全員選ぶとマップへ");
}

console.log("[生き残りが全員終了済みで残る1人が倒れたらターンが進む]");
{
  const g = battle("knight", "knight", ["bandit"]);
  g.apply({ type: "end" }, 1);
  ok(g.P(1).ended, "味方がターン終了");
  g.dealDamage(null, g.P(0), 999);
  g.apply({ type: "end" }, 1); g.apply({ type: "end" }, 1); // ダミー(反応なしでもよい)
  ok(g.s.phase !== "battle" || g.s.battle.turn >= 2 || g.s.phase === "over", "詰まらない");
}

console.log("[宝箱: 選択が被ったら別のレリックに]");
{
  const g = new Game({ seed: 5, classes: ["knight", "mage"] });
  g.openTreasure();
  g.apply({ type: "treasure", idx: 0 }, 0);
  const before = [g.P(0).relics.length, g.P(1).relics.length];
  g.apply({ type: "treasure", idx: 0 }, 1);
  ok(g.s.phase === "map", "両者選択後にマップへ");
  ok(g.P(0).relics.length === before[0] + 1 && g.P(1).relics.length === before[1] + 1, "各自1つ獲得");
  const a = g.P(0).relics.at(-1), b = g.P(1).relics.at(-1);
  ok(a !== b, `被っても同じレリックにならない (${a} / ${b})`);
}

console.log("[休憩所の治療・強化]");
{
  const g = new Game({ seed: 5, classes: ["knight", "mage"] });
  g.s.phase = "rest"; g.s.rest = [{ done: false }, { done: false }];
  g.P(1).hp = 10;
  g.apply({ type: "rest", mode: "mend" }, 0);
  ok(g.P(1).hp === 10 + Math.ceil(g.P(1).maxHp * 0.3), "味方を30%治療");
  const c = g.P(1).deck.find((x) => g.upgradable(x));
  g.apply({ type: "rest", mode: "smith", uid: c.id }, 1);
  ok(c.u === 1 && g.s.phase === "map", "鍛冶で強化してマップへ");
}

console.log("[マップ投票]");
{
  const g = new Game({ seed: 11, classes: ["knight", "mage"] });
  const o = g.options();
  g.apply({ type: "vote", node: o[0] }, 0);
  ok(g.s.phase === "map", "片方だけでは進まない");
  g.apply({ type: "vote", node: o[o.length - 1] }, 1);
  ok(g.s.phase !== "map", "両者が投票すると進む(割れたら抽選)");
}

console.log(fails ? `\n失敗 ${fails} 件` : "\n全テスト成功");
process.exit(fails ? 1 : 0);
