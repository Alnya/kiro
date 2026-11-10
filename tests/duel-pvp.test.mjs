// 対人戦ロジック(js/duel/pvp.js)のテスト: node tests/duel-pvp.test.mjs
import { PvpSim, PVP, encodeInput, decodeInput, dsin, dcos, datan2, NEUTRAL } from "../js/duel/pvp.js";

let fails = 0;
const ok = (c, m) => { console.log((c ? "  ok: " : "  NG: ") + m); if (!c) fails++; };
const sec = (s) => console.log(`[${s}]`);
const N = NEUTRAL;
const I = (o) => encodeInput(o);

function toFight(sim) { while (sim.phase !== "fight") sim.step([N, N]); }
// 指定フレーム数進め、イベントを集める。fn(i) は [bits0, bits1] を返す
function run(sim, frames, fn = () => [N, N]) {
  const evs = [];
  for (let i = 0; i < frames; i++) for (const e of sim.step(fn(i))) evs.push({ ...e, fi: i });
  return evs;
}
// 二人を近づけて向かい合わせる
function close(sim, d = 2.0) {
  const [A, B] = sim.F;
  A.x = 0; A.z = d / 2; A.yaw = Math.PI; B.x = 0; B.z = -d / 2; B.yaw = 0;
}
// 1(B)が攻撃し、0(A)が「当たりのフレーム + offset」に防御を押す。hitFrame を返す
function attackAndGuard(offset, { hold = true } = {}) {
  const sim = new PvpSim(); toFight(sim); close(sim);
  // 当たりのフレームを先に調べる
  const probe = new PvpSim(); toFight(probe); close(probe);
  const pe = run(probe, 30, (i) => [N, i === 0 ? I({ attack: true }) : N]);
  const hitF = pe.find((e) => e.k === "strike").fi;
  const gf = hitF + offset;
  const evs = run(sim, 60, (i) => [I({ guard: hold ? i >= gf : i === gf, guardEdge: i === gf }), i === 0 ? I({ attack: true }) : N]);
  return { sim, evs, hitF };
}

sec("決定論的な三角関数");
{
  let e = 0;
  for (let i = 0; i < 20000; i++) {
    const x = (i / 20000 - 0.5) * 40;
    e = Math.max(e, Math.abs(dsin(x) - Math.sin(x)), Math.abs(dcos(x) - Math.cos(x)));
    const y = Math.sin(i * 1.7) * 5, z = Math.cos(i * 0.9) * 5;
    e = Math.max(e, Math.abs(datan2(y, z) - Math.atan2(y, z)));
  }
  ok(e < 1e-9, `誤差が小さい (${e.toExponential(2)})`);
  ok(datan2(0, -1) === Math.PI && datan2(0, 0) === 0 && datan2(1, 0) === Math.PI / 2, "特殊な値");
}

sec("入力のエンコード");
{
  const o = { mx: -1, mz: 0.5, guard: true, guardEdge: false, attack: true, dodge: false, heal: true, thrust: true };
  const d = decodeInput(encodeInput(o));
  ok(d.mx === -1 && Math.abs(d.mz - 4 / 7) < 1e-9 && d.guard && !d.guardEdge && d.attack && !d.dodge && d.heal && d.thrust, "往復で一致");
  ok(decodeInput(N).mx === 0 && decodeInput(N).mz === 0, "中立");
}

sec("決定論: 同じ入力列なら同じ結果");
{
  let seed = 7;
  const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296);
  const seq = [];
  for (let i = 0; i < 9000; i++) {
    const g = (k) => ({ mx: rnd() * 2 - 1, mz: rnd() * 2 - 1, guard: rnd() < 0.3, guardEdge: rnd() < 0.05, attack: rnd() < 0.06, dodge: rnd() < 0.02, heal: rnd() < 0.005, thrust: rnd() < 0.01, k });
    seq.push([I(g(0)), I(g(1))]);
  }
  const a = new PvpSim(), b = new PvpSim();
  let bad = 0, rounds = 0;
  for (const s of seq) {
    for (const e of a.step(s)) if (e.k === "roundEnd") rounds++;
    b.step(s);
    for (const F of a.F) if (![F.x, F.z, F.yaw, F.hp, F.posture].every(Number.isFinite)) bad++;
  }
  ok(a.hash() === b.hash(), `9000フレーム後のハッシュ一致 (${a.hash()})`);
  ok(bad === 0, "NaN や無限大が出ない");
  ok(rounds >= 1, `ランダム入力でも決着がつく (${rounds}本)`);
  ok(a.F.every((F) => Math.hypot(F.x, F.z) <= PVP.arena), "闘技場の外に出ない");
}

sec("パリィ(弾き)");
{
  const { sim, evs } = attackAndGuard(-5);
  const p = evs.find((e) => e.k === "parry");
  ok(!!p && p.who === 0, "当たる5フレーム前の防御でパリィ");
  ok(!evs.some((e) => e.k === "hit"), "ダメージを受けない");
  ok(sim.F[1].posture > 15, `攻撃側の体幹が溜まる (${sim.F[1].posture.toFixed(1)})`);
  const r = attackAndGuard(-5);
  void r;
}
{
  // パリィ後の反撃が入る
  const sim = new PvpSim(); toFight(sim); close(sim);
  let parryAt = -1;
  const evs = [];
  for (let i = 0; i < 80; i++) {
    const a0 = parryAt >= 0 && i === parryAt + 1;
    const b0 = i === 0;
    const ev = sim.step([I({ guard: i >= 4 && parryAt < 0, guardEdge: i === 4, attack: a0 }), b0 ? I({ attack: true }) : N]);
    for (const e of ev) { evs.push(e); if (e.k === "parry" && parryAt < 0) parryAt = i; }
  }
  ok(parryAt >= 0, "パリィ発生");
  ok(evs.some((e) => e.k === "hit" && e.who === 1 && e.att === 0), "弾いた直後の反撃が当たる");
}

sec("遅延補償: 当たった直後(数フレーム以内)の防御もパリィ");
{
  const { evs } = attackAndGuard(2, { hold: true });
  ok(evs.some((e) => e.k === "parry"), "当たりの2フレーム後の入力でパリィ");
  const late = attackAndGuard(9, { hold: true });
  ok(late.evs.some((e) => e.k === "hit" && e.who === 0), "9フレーム後では被弾");
  const early = attackAndGuard(-20, { hold: true });
  ok(early.evs.some((e) => e.k === "block") && !early.evs.some((e) => e.k === "parry"), "早すぎる防御(押しっぱなし)は通常の防御");
  ok(early.sim.F[0].posture > 0, "通常の防御は体幹が溜まる");
}

sec("突き(危): 防御不可・回避でかわす・見切り");
{
  const mk = () => { const s = new PvpSim(); toFight(s); close(s, 2.4); return s; };
  // 防御しても当たる
  let sim = mk();
  let evs = run(sim, 120, (i) => [I({ guard: i >= 20, guardEdge: i === 20 }), i === 0 ? I({ thrust: true }) : N]);
  ok(evs.some((e) => e.k === "peril" && e.who === 1), "危マークが出る");
  ok(evs.some((e) => e.k === "hit" && e.who === 0 && e.perilous), "防御しても被弾する");
  ok(!evs.some((e) => e.k === "parry"), "パリィできない");
  // 当たりのフレーム
  const hitF = run(mk(), 80, (i) => [N, i === 0 ? I({ thrust: true }) : N]).find((e) => e.k === "thrustHit").fi;
  // 横に回避
  sim = mk();
  evs = run(sim, 120, (i) => [I({ mx: 1, dodge: i === hitF - 8 }), i === 0 ? I({ thrust: true }) : N]);
  ok(evs.some((e) => e.k === "dodged" || e.k === "whiff"), "横への回避でかわせる");
  ok(!evs.some((e) => e.k === "hit"), "被弾しない");
  // 相手に向かって回避 → 見切り
  sim = mk();
  evs = run(sim, 120, (i) => [I({ mz: 1, dodge: i === hitF - 6 }), i === 0 ? I({ thrust: true }) : N]);
  ok(evs.some((e) => e.k === "mikiri" && e.who === 0), "踏み込む回避で見切り");
  ok(sim.F[1].posture >= 50, `突いた側の体幹が大きく溜まる (${sim.F[1].posture.toFixed(0)})`);
}

sec("体幹崩し → 致命の一撃 → 一本 → 二本先取で勝利");
{
  const sim = new PvpSim(); toFight(sim); close(sim);
  sim.F[1].posture = 99; sim.F[1].lastPost = sim.t;
  // 1の攻撃を0がパリィ → 1が体幹崩し
  const p = attackAndGuard(-5);
  void p;
  let evs = run(sim, 40, (i) => [I({ guard: i >= 4, guardEdge: i === 4 }), i === 0 ? I({ attack: true }) : N]);
  ok(evs.some((e) => e.k === "postureBreak" && e.who === 1), "パリィで体幹崩し");
  ok(sim.F[1].state === "stun", "崩された側は無防備");
  evs = run(sim, 200, (i) => [i === 0 ? I({ attack: true }) : N, N]);
  ok(evs.some((e) => e.k === "deathblow" && e.who === 0), "攻撃で致命の一撃");
  const re = evs.find((e) => e.k === "roundEnd");
  ok(re && re.winner === 0 && re.reason === "deathblow", "致命の一撃で一本");
  ok(sim.wins[0] === 1, "勝ち数 1");
  evs = run(sim, 400);
  ok(evs.some((e) => e.k === "roundStart") && sim.round === 1, "次の勝負が始まる");
  ok(sim.F[0].hp === PVP.hp && sim.F[1].hp === PVP.hp && sim.F[0].gourds === PVP.gourds, "体力・瓢箪が戻る");
  toFight(sim);
  sim.F[1].hp = 5;
  close(sim);
  evs = run(sim, 600, (i) => [i === 0 ? I({ attack: true }) : N, N]);
  ok(sim.wins[0] === 2 && sim.matchOver && sim.matchOver.winner === 0, "二本先取で勝利");
  ok(evs.some((e) => e.k === "matchEnd") && sim.phase === "over", "試合終了");
}

sec("時間切れ");
{
  const sim = new PvpSim(); toFight(sim);
  sim.F[0].hp = 50;
  const evs = run(sim, Math.ceil(PVP.roundTime * 60) + 5);
  const re = evs.find((e) => e.k === "roundEnd");
  ok(re && re.reason === "time" && re.winner === 1, "体力の多い方が一本");
}

sec("回復");
{
  const sim = new PvpSim(); toFight(sim);
  sim.F[0].hp = 40;
  run(sim, 90, (i) => [i === 0 ? I({ heal: true }) : N, N]);
  ok(sim.F[0].hp === 40 + PVP.heal && sim.F[0].gourds === PVP.gourds - 1, `回復 +${PVP.heal}`);
}

sec("ボット同士の対戦(上手い方が勝ちやすい)");
{
  // 上手いボット: 相手の振りに合わせてパリィ、突きは踏み込み回避、隙に攻撃
  function smart(sim, me, lv) {
    const F = sim.F[me], O = sim.F[1 - me];
    const d = Math.hypot(F.x - O.x, F.z - O.z);
    const o = { mz: d > 2.6 ? 1 : 0, mx: 0 };
    if (O.state === "attack" && !O.hitDone) {
      const w = [0.15, 0.13, 0.22][O.combo];
      const left = w - O.st;
      if (left < 0.1 && left > 0.0 && !F._g) { o.guard = true; o.guardEdge = Math.random() < lv; F._g = true; }
      else o.guard = F.state === "guard";
    } else F._g = false;
    if (O.state === "thrust" && O.st > 0.48 && O.st < 0.56 && F.state !== "dodge") { o.dodge = Math.random() < lv; o.mz = 1; }
    if ((O.state === "recoil" || O.state === "stun" || O.state === "heal" || O.state === "hit") && d < 3) o.attack = true;
    if (O.state === "idle" && d < 2.8 && Math.random() < 0.03) o.attack = true;
    if (F.state === "attack") o.attack = Math.random() < 0.5;
    if (F.hp < 40 && d > 4 && Math.random() < 0.05) o.heal = true;
    return I(o);
  }
  function masher(sim, me) {
    const F = sim.F[me], O = sim.F[1 - me];
    const d = Math.hypot(F.x - O.x, F.z - O.z);
    return I({ mz: d > 2.2 ? 1 : 0, attack: Math.random() < 0.25, thrust: Math.random() < 0.01 });
  }
  let w = 0, games = 12;
  for (let g = 0; g < games; g++) {
    const sim = new PvpSim();
    const sm = g % 2;
    let n = 0;
    while (sim.phase !== "over" && n++ < 60 * 60 * 8) sim.step(sm === 0 ? [smart(sim, 0, 0.9), masher(sim, 1)] : [masher(sim, 0), smart(sim, 1, 0.9)]);
    if (sim.matchOver && sim.matchOver.winner === sm) w++;
    if (g < 2) console.log(`  試合${g}: 勝ち数 ${sim.wins} / パリィ ${sim.total.map((t) => t.parries)} / 命中 ${sim.total.map((t) => t.hits)} / 見切り ${sim.total.map((t) => t.mikiri)} / 致命 ${sim.total.map((t) => t.deathblows)}`);
  }
  console.log(`  上手いボット vs 連打ボット: ${w}/${games} 勝`);
  ok(w >= games * 0.75, "パリィを使う方が勝ちやすい");
}

console.log(fails ? `\n${fails} 件失敗` : "\n全テスト成功");
process.exit(fails ? 1 : 0);
