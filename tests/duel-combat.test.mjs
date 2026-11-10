// 実行: node tests/duel-combat.test.mjs — ボス一騎討ちの戦闘ロジックの検証
import { Duel, B_ATTACKS, TUNE, P_ATTACKS } from "../js/duel/combat.js";

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log("  NG:", m); } else console.log("  ok:", m); };
const DT = 1 / 60;
const none = () => ({});

function run(d, secs, bot) {
  const evs = [];
  const n = Math.round(secs / DT);
  for (let i = 0; i < n && !d.over; i++) {
    const inp = bot(d, i) || {};
    for (const e of d.update(DT, inp)) evs.push(e);
  }
  return evs;
}
const count = (evs, k) => evs.filter((e) => e.k === k).length;

// 上手いボット: 通常攻撃はジャストでパリィ、危は回避、隙があれば攻撃、体幹崩しなら致命の一撃
function skilled(opts = {}) {
  let held = false;
  return (d) => {
    const p = d.p, b = d.b, inp = { mx: 0, mz: 0 };
    const dist = d.bossDist;
    inp.guard = held;
    // 間合い調整
    if (dist > 3.2) inp.mz = 1; else if (dist < 2.0) inp.mz = -0.5;
    if (b.state === "stun" || b.state === "kneel") { if (dist < 4.2) inp.attack = true; else inp.mz = 1; return inp; }
    if (b.state === "attack" && b.atk) {
      const a = b.atk, c = b.atkClock;
      const next = a.hits[b.hitIdx];
      if (next) {
        if (a.perilous) { if (c >= next.t - (opts.dodgeLead ?? 0.2) && c < next.t - 0.05 && p.state !== "dodge") { inp.dodge = true; inp.mx = 1; } }
        else {
          const lead = opts.parryLead ?? 0.1;
          const want = c >= next.t - lead && c < next.t + 0.05;
          if (want && !held) { inp.guardEdge = true; held = true; inp.guard = true; }
          if (!want && held && c > next.t + 0.1) { held = false; inp.guard = false; }
        }
      }
      return inp;
    }
    if (held && b.state !== "attack") { held = false; inp.guard = false; }
    // 隙: 攻撃
    if (b.state === "idle" && dist < 2.8 && p.state === "idle" && d.t % 0.6 < DT) inp.attack = true;
    if (p.state === "attack") inp.attack = Math.random() < 0.05;
    return inp;
  };
}

console.log("[基本: 何もしないと倒される]");
{
  const d = new Duel(3);
  run(d, 90, none);
  ok(d.over && d.over.win === false, "放置すると敗北する(HP " + Math.round(d.p.hp) + ")");
}

console.log("[パリィ: ジャスト防御で体幹が削れ、被ダメージなし]");
{
  const d = new Duel(5);
  // 最初の通常攻撃にだけジャストで合わせる
  let done = false, maxPost = 0;
  const evs = run(d, 40, (dd) => {
    maxPost = Math.max(maxPost, dd.b.posture);
    const b = dd.b, c = b.atkClock;
    if (b.state === "attack" && !b.atk.perilous && !done) {
      const next = b.atk.hits[b.hitIdx];
      if (next && c >= next.t - 0.08) { done = true; return { guardEdge: true, guard: true }; }
    }
    if (done) return { guard: true };
    return {};
  });
  ok(count(evs, "parry") >= 1, "パリィが発生した");
  ok(maxPost >= 16 || count(evs, "bossPostureBreak") > 0, "パリィでボスの体幹が増えた(最大" + Math.round(maxPost) + ")");
  ok(d.p.hp === TUNE.playerHp || count(evs, "playerHit") > 0, "パリィした攻撃でダメージを受けていない");
}

console.log("[パリィ判定の窓(早すぎ/遅すぎ)]");
{
  const test = (lead) => {
    const d = new Duel(5);
    let pressed = false;
    const evs = run(d, 40, (dd) => {
      const b = dd.b;
      if (b.state === "attack" && !b.atk.perilous && !pressed) {
        const next = b.atk.hits[b.hitIdx];
        if (next && b.atkClock >= next.t - lead) { pressed = true; return { guardEdge: true, guard: true }; }
      }
      return pressed ? { guard: true } : {};
    });
    return { parry: count(evs, "parry"), block: count(evs, "block"), hit: count(evs, "playerHit") };
  };
  const fine = test(0.1), early = test(0.5);
  ok(fine.parry >= 1, "ヒット0.1秒前の入力はパリィになる");
  ok(early.parry === 0 && early.block >= 1, "早すぎる入力は通常防御(体幹が溜まる)になる");
}

console.log("[危(perilous)攻撃: 防御不可・回避で避けられる]");
{
  const d = new Duel(2);
  d.b.state = "idle"; d.b.think = 0;
  d.startBossAttack("thrust");
  // 防御しても当たる
  d.p.x = 0; d.p.z = d.b.z + 3.5;
  const evs = run(d, 3, () => ({ guardEdge: d.b.atkClock > 0.8 && d.p.state !== "guard", guard: d.b.atkClock > 0.8 }));
  ok(count(evs, "playerHit") === 1 && d.p.hp < TUNE.playerHp, "突きは防御できず被弾する(HP " + d.p.hp + ")");
  const d2 = new Duel(2);
  d2.b.state = "idle"; d2.startBossAttack("thrust"); d2.p.x = 0; d2.p.z = d2.b.z + 3.5;
  const evs2 = run(d2, 3, () => ({ dodge: d2.b.atkClock > 0.7 && d2.b.atkClock < 0.72, mx: 1 }));
  ok(d2.p.hp === TUNE.playerHp && count(evs2, "playerHit") === 0, "回避すれば避けられる(射線から外れて空振りになる)");
  const d3 = new Duel(2);
  d3.b.state = "idle"; d3.startBossAttack("sweep"); d3.p.x = 0; d3.p.z = d3.b.z + 3.0;
  const evs3 = run(d3, 3, () => ({ dodge: d3.b.atkClock > 0.7 && d3.b.atkClock < 0.72, mx: 1 }));
  ok(count(evs3, "dodged") === 1, "足払いも回避で避けられる");
}

console.log("[体幹崩し→致命の一撃→第2形態→撃破]");
{
  let wins = 0, phase2 = 0, breaks = 0, deaths = 0, times = [], parries = [];
  for (let s = 1; s <= 20; s++) {
    const d = new Duel(s);
    const evs = run(d, 240, skilled());
    if (d.over && d.over.win) { wins++; times.push(d.over.time); }
    else if (d.over) deaths++;
    phase2 += count(evs, "phase2") > 0 ? 1 : 0;
    breaks += count(evs, "bossPostureBreak");
    parries.push(d.stats.parries);
  }
  console.log(`  上手いボット20戦: 勝利${wins} / 敗北${deaths} / 第2形態到達${phase2} / 体幹崩し計${breaks} / 平均撃破${times.length ? Math.round(times.reduce((a, b) => a + b) / times.length) : "-"}秒 / 平均パリィ${Math.round(parries.reduce((a, b) => a + b) / parries.length)}回`);
  ok(wins >= 15, "ジャストパリィと回避を使えば勝てる (" + wins + "/20)");
  ok(phase2 >= 15, "第2形態へ移行する");
}

console.log("[ボタン連打だけだと負ける(防御しないと厳しい)]");
{
  let wins = 0;
  for (let s = 1; s <= 10; s++) {
    const d = new Duel(s);
    run(d, 240, (dd) => ({ attack: dd.p.state === "idle" || dd.p.state === "attack", mz: dd.bossDist > 2.6 ? 1 : 0 }));
    if (d.over && d.over.win) wins++;
  }
  ok(wins <= 1, "攻撃連打のみの勝率が低い (" + wins + "/10)");
}

console.log("[回復・復活]");
{
  const d = new Duel(4);
  d.p.hp = 40; d.b.think = 99;
  const evs = run(d, 2, (dd, i) => ({ heal: i === 0 }));
  ok(d.p.hp === 85 && d.p.gourds === TUNE.gourds - 1 && count(evs, "healed") === 1, "回復で+45、ひょうたん-1");
  d.p.hp = 1; d.hurtPlayer(10, 0, d.b);
  ok(d.over && d.over.canRevive, "死亡時に復活可能");
  ok(d.revive() && d.p.hp === 60 && !d.over, "復活でHP60%");
  d.hurtPlayer(999, 0, d.b);
  ok(d.over && !d.over.canRevive, "2度目の死亡では復活不可");
}

console.log("[致命の一撃の条件]");
{
  const d = new Duel(6);
  d.b.state = "stun"; d.b.st = 0; d.b.x = 0; d.b.z = 0; d.p.x = 0; d.p.z = 3;
  const evs = run(d, 3, (dd, i) => ({ attack: i === 2 }));
  ok(count(evs, "deathblow") === 1 && d.b.bars === 1 && d.b.phase === 2, "体幹崩し中に攻撃すると致命の一撃が入り第2形態へ");
  const d2 = new Duel(6);
  d2.b.bars = 1; d2.b.state = "kneel"; d2.b.st = 0; d2.b.hp = 0; d2.p.x = d2.b.x; d2.p.z = d2.b.z + 3;
  run(d2, 7, (dd, i) => ({ attack: i === 2 }));
  ok(d2.over && d2.over.win, "最後の致命の一撃で撃破");
}

console.log("[安定性: ランダム入力で NaN や範囲外が出ない]");
{
  let bad = 0;
  for (let s = 1; s <= 30; s++) {
    const d = new Duel(s);
    let seed = s * 77;
    const r = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < 60 * 60 && !d.over; i++) {
      d.update(DT, { mx: Math.round(r() * 2 - 1), mz: Math.round(r() * 2 - 1), attack: r() < 0.05, guard: r() < 0.4, guardEdge: r() < 0.03, dodge: r() < 0.02, heal: r() < 0.005 });
      for (const v of [d.p.x, d.p.z, d.b.x, d.b.z, d.p.hp, d.b.hp, d.p.posture, d.b.posture]) if (!Number.isFinite(v)) bad++;
      if (Math.hypot(d.p.x, d.p.z) > TUNE.arena + 0.5 || Math.hypot(d.b.x, d.b.z) > TUNE.arena + 0.5) bad++;
    }
  }
  ok(bad === 0, "不正な値なし (" + bad + ")");
}

void B_ATTACKS; void P_ATTACKS;
console.log(fails ? `\n失敗 ${fails} 件` : "\n全テスト成功");
process.exit(fails ? 1 : 0);
