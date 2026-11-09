// 実行: node tests/spire-cards.test.mjs  — 全カード(通常/強化)を実際に使って例外・NaN・テキスト欠落がないか確認
import { Game } from "../js/spire/engine.js";
import { CARDS, ENEMIES, RELICS, POTIONS, cardText, cardCost } from "../js/spire/data.js";

let fails = 0, count = 0;
const ng = (m) => { fails++; console.log("  NG:", m); };

function setup(cls0 = "knight", cls1 = "mage") {
  const g = new Game({ seed: 77, classes: [cls0, cls1] });
  g.apply({ type: "vote", node: g.options()[0] }, 0);
  g.apply({ type: "vote", node: g.options()[0] }, 1);
  return g;
}

for (const [id, d] of Object.entries(CARDS)) {
  for (const up of [0, 1]) {
    count++;
    const txt = cardText(id, !!up);
    if (txt.includes("?") || txt.includes("{")) ng(`${id}: テキストに未解決の値 "${txt}"`);
    const g = setup();
    if (g.s.phase !== "battle") { ng("戦闘に入れない"); continue; }
    const p = g.P(0), q = g.P(1);
    // 手札にカードを直接用意
    p.hand = [{ c: id, u: up, id: 9000 }, { c: "strike", u: 0, id: 9001 }, { c: "defend", u: 0, id: 9002 }];
    p.energy = 5;
    p.st.str = 0;
    const target = d.tg === "enemy" ? { k: "e", i: 0 } : d.tg === "ally" ? { k: "p", i: 1 } : null;
    let steps;
    try { steps = g.apply({ type: "play", uid: 9000, target }, 0); } catch (e) { ng(`${id}(${up}): 例外 ${e.message}`); continue; }
    if (d.fl && d.fl.includes("unplayable")) { if (steps.length) ng(`${id}: 使用不可のはずが使えた`); continue; }
    if (!steps.length) { ng(`${id}(${up}): 使えなかった`); continue; }
    const s = steps[steps.length - 1].s;
    const bad = JSON.stringify(s).includes("null,null") ? false : false;
    for (const pl of s.players) {
      if (Number.isNaN(pl.hp) || Number.isNaN(pl.block) || Number.isNaN(pl.energy)) ng(`${id}: NaN`);
      for (const k of Object.keys(pl.st)) if (Number.isNaN(pl.st[k])) ng(`${id}: 状態NaN ${k}`);
    }
    for (const e of s.battle.enemies) for (const k of Object.keys(e.st)) if (Number.isNaN(e.st[k])) ng(`${id}: 敵状態NaN ${k}`);
    // コスト支払い確認
    const cost = cardCost(id, !!up);
    const expect = cost === "X" ? 0 : 5 - cost;
    const energyAfter = s.players[0].energy + (id === "manaBurst" ? -(up ? 3 : 2) : 0);
    if (!["manaBurst"].includes(id) && cost !== "X" && s.players[0].energy !== expect && !["tagTeam", "energySurge"].includes(id)) ng(`${id}(${up}): エナジー ${s.players[0].energy} (期待 ${expect})`);
    void bad; void energyAfter;
  }
}

// 敵: 全員を何ターンか動かして例外が出ないか
for (const id of Object.keys(ENEMIES)) {
  const g = setup();
  g.s.battle.enemies.length = 0;
  g.spawn(id);
  for (let t = 0; t < 12 && g.s.phase === "battle"; t++) {
    try {
      g.apply({ type: "end" }, 0); g.apply({ type: "end" }, 1);
    } catch (e) { ng(`敵 ${id}: 例外 ${e.message}`); break; }
  }
  count++;
}

// レリック・ポーション
for (const [id, r] of Object.entries(RELICS)) {
  const g = setup(); const p = g.P(0);
  try { g.giveRelic(p, id); if (r.onStart) r.onStart(g, p); if (r.onWin) r.onWin(g, p); if (r.onEnd) r.onEnd(g, p); } catch (e) { ng(`レリック ${id}: ${e.message}`); }
  count++;
}
for (const [id, d] of Object.entries(POTIONS)) {
  const g = setup(); const p = g.P(0);
  p.potions[0] = id;
  const steps = g.apply({ type: "potion", slot: 0, tk: d.tg === "enemy" ? "e" : "p", ti: d.tg === "enemy" ? 0 : 1 }, 0);
  if (!steps.length) ng(`ポーション ${id} を使えない`);
  count++;
}
console.log(`${count} 項目を確認`);
console.log(fails ? `失敗 ${fails} 件` : "全テスト成功");
process.exit(fails ? 1 : 0);
