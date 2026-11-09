// 甲虫じゃんけんバトルのルール(純粋ロジック・乱数なし)。
// 両端末が同じ入力(デッキ・出した手・ゲージ結果)から同じ結果を計算する。
//
// 【公開情報で確認できたルール】
//  - ムシ1匹 + グー/チョキ/パーのわざカード。じゃんけんに勝った側だけが攻撃。体力0で負け。
//  - あいこ: お互いに「最大体力の1/10」のダメージ(小数点以下切り捨て)。
//  - ムシの必殺わざの手で勝つと必殺わざ(ゲージなし)。同名の超必殺カードを付けていれば超必殺わざ。
//  - それ以外の手で勝つと通常攻撃。目押しゲージで威力が増減(攻撃パーフェクト > 攻撃UP > 防御UP > 防御パーフェクト)。
//  - つよさは 100/120/140/160/180/200。わざカードの攻撃ボーナス表、特殊わざの効果割合。
// 【推定値】基礎体力・基礎攻撃力・ダメージ倍率は非公開のため、上記の数値と矛盾しないよう設定。

export const HANDS = ["g", "c", "p"];
export const HAND_LABEL = { g: "グー", c: "チョキ", p: "パー" };
export const HAND_ICON = { g: "✊", c: "✌️", p: "🖐️" };
export const beats = (a, b) => (a === "g" && b === "c") || (a === "c" && b === "p") || (a === "p" && b === "g");

export const BUGS = [
  { id: "hercules", name: "ヘラクレスオオカブト", str: 200, hand: "g", move: "ツノぶん回し", ult: "ヘラクレス大旋風", hue: 20 },
  { id: "giraffa", name: "ギラファノコギリクワガタ", str: 200, hand: "c", move: "はさみ落とし", ult: "ギラファ断頭ばさみ", hue: 210 },
  { id: "caucasus", name: "コーカサスオオカブト", str: 180, hand: "p", move: "ツノすくい投げ", ult: "コーカサス突進砲", hue: 8 },
  { id: "palawan", name: "パラワンオオヒラタクワガタ", str: 180, hand: "g", move: "大あごバイス", ult: "パラワン万力固め", hue: 225 },
  { id: "neptune", name: "ネプチューンオオカブト", str: 160, hand: "c", move: "二本角はさみ", ult: "ネプチューン雷撃", hue: 35 },
  { id: "alcides", name: "アルキデスオオヒラタクワガタ", str: 160, hand: "p", move: "あご締め上げ", ult: "アルキデス大締め", hue: 245 },
  { id: "atlas", name: "アトラスオオカブト", str: 140, hand: "g", move: "ツノ突き上げ", ult: "アトラス岩砕き", hue: 50 },
  { id: "miyama", name: "ミヤマクワガタ", str: 140, hand: "p", move: "かぶと割り", ult: "ミヤマ山落とし", hue: 190 },
  { id: "okuwa", name: "オオクワガタ", str: 120, hand: "c", move: "黒ばさみ", ult: "オオクワ王の一撃", hue: 265 },
  { id: "kabuto", name: "カブトムシ", str: 120, hand: "p", move: "ツノ投げ", ult: "カブト大投げ", hue: 28 },
  { id: "hime", name: "ヒメカブト", str: 100, hand: "g", move: "ちびヅノ突撃", ult: "ヒメ連打", hue: 340 },
  { id: "kokuwa", name: "コクワガタ", str: 100, hand: "c", move: "ちびばさみ", ult: "コクワ高速ばさみ", hue: 160 },
];
export const BUG_BY_ID = Object.fromEntries(BUGS.map((b) => [b.id, b]));
export const NORMAL_MOVE = { g: "ぶつかり", c: "はさみ", p: "つきあげ" };

export const isSmall = (bug) => bug.str <= 120; // 小型(100/120) と 中大型

// わざカードの攻撃ボーナス表(2005ファースト基準)。[必殺, 通常] / 超必殺
export const BONUS = {
  100: { t80: [20, 10], t50: [12, 6], t20: [8, 4], ult: 25 },
  120: { t80: [16, 8], t50: [12, 6], t20: [8, 4], ult: 20 },
  140: { t80: [4, 2], t50: [12, 6], t20: [8, 4], ult: 15 },
  160: { t80: [2, 1], t50: [10, 5], t20: [8, 4], ult: 13 },
  180: { t80: [2, 1], t50: [4, 2], t20: [8, 4], ult: 10 },
  200: { t80: [2, 1], t50: [2, 1], t20: [6, 3], ult: 8 },
};

// 特殊わざ(効果の割合は公開情報。発動は「その手で勝ったとき」と解釈)
export const SPECIALS = {
  heal: { label: "かいふく", desc: "攻撃された次に勝つと、受けたダメージの20%回復" },
  counterHeal: { label: "反撃かいふく", desc: "必殺わざで攻撃された次に勝つと、ダメージの小型60%/中大型50%回復" },
  sutemi: { label: "すてみの一撃", desc: "自分の最大体力の7.5%を失い、相手の最大体力の10%ぶん強い攻撃" },
  aikoBreak: { label: "あいこやぶり", desc: "勝つとあいこダメージを防ぐ(小型2ターン/中大型1ターン)" },
  atkDown: { label: "こうげきダウン", desc: "勝つと相手の負けた手の攻撃力を下げる(小型20%/中大型10%)" },
  guardUp: { label: "まもりアップ", desc: "連続で勝つとほたる+1(最大4)。1匹ごとに受けるダメージ10%減。負けるとリセット" },
};
export const ATTACK_CARDS = ["t20", "t50", "t80"];
export const CARD_LABEL = { t20: "こうげきわざ T20", t50: "こうげきわざ T50", t80: "こうげきわざ T80", ult: "超必殺カード" };

// ---- 数値(推定) ----
export const maxHpOf = (bug) => 100 + Math.floor(bug.str / 2);
export const baseAtk = (bug) => Math.round(40 + 0.3 * bug.str);
const K = { normal: 0.22, hissatsu: 0.5, ult: 0.6 };
export const PERFECT = 0.9; // ゲージの近さがこれ以上でパーフェクト

export function allowedCards(bug, hand) {
  const cards = [null, ...ATTACK_CARDS];
  if (hand === bug.hand) cards.push("ult");
  else cards.push(...Object.keys(SPECIALS));
  return cards;
}

// デッキ検証。正しければ戦闘用オブジェクトを返す(不正なら null)
export function makeFighter(deck) {
  const bug = deck && BUG_BY_ID[deck.bug];
  if (!bug || !deck.slots) return null;
  const used = new Set();
  const slots = {};
  for (const h of HANDS) {
    const c = deck.slots[h] ?? null;
    if (!allowedCards(bug, h).includes(c)) return null;
    if (c && SPECIALS[c]) { if (used.has(c)) return null; used.add(c); }
    slots[h] = c;
  }
  const maxHp = maxHpOf(bug);
  return { bug, slots, hp: maxHp, maxHp, lastHit: null, fireflies: 0, shield: 0, atkDown: { g: 0, c: 0, p: 0 } };
}

export function kindOf(f, hand) {
  if (hand !== f.bug.hand) return "normal";
  return f.slots[hand] === "ult" ? "ult" : "hissatsu";
}

export function moveName(f, hand) {
  const k = kindOf(f, hand);
  return k === "ult" ? f.bug.ult : k === "hissatsu" ? f.bug.move : NORMAL_MOVE[hand];
}

export function attackPower(f, hand) {
  const kind = kindOf(f, hand);
  const card = f.slots[hand];
  const tbl = BONUS[f.bug.str];
  let bonus = 0;
  if (kind === "ult") bonus = tbl.ult;
  else if (ATTACK_CARDS.includes(card)) bonus = tbl[card][kind === "hissatsu" ? 0 : 1];
  return (baseAtk(f.bug) + bonus) * (1 - f.atkDown[hand]);
}

// 目押しゲージ: a=攻撃側の近さ(0..1), d=防御側の近さ(0..1)。攻撃側が同等以上なら攻撃側有利
export function gaugeMult(a, d) {
  if (a >= d) return a >= PERFECT ? 1.2 : 1.0; // 攻撃パーフェクト / 攻撃UP
  return d >= PERFECT ? 0.5 : 0.8;              // 防御パーフェクト / 防御UP
}
export const gaugeLabel = (m) => (m === 1.2 ? "攻撃パーフェクト!" : m === 1.0 ? "攻撃UP" : m === 0.8 ? "防御UP" : "防御パーフェクト!");

// 手の威力の目安(ゲージ=攻撃UP のとき)
export function previewDamage(f, hand) {
  const kind = kindOf(f, hand);
  return Math.floor(attackPower(f, hand) * K[kind]);
}

// 1ラウンドを解決。F=[fighter0, fighter1], hands=[h0,h1], gauge=[近さ0, 近さ1]
// 返り値 { events, over, winner }  winner: 0|1|null(引き分け) ※over のときのみ有効
export function resolveRound(F, hands, gauge = []) {
  const ev = [];
  const shieldBefore = F.map((f) => f.shield);

  if (hands[0] === hands[1]) {
    F.forEach((f, i) => {
      if (f.shield > 0) ev.push({ t: "aikoBlock", who: i });
      else { const d = Math.floor(f.maxHp / 10); f.hp -= d; ev.push({ t: "aiko", who: i, dmg: d }); }
      f.lastHit = null;
    });
  } else {
    const w = beats(hands[0], hands[1]) ? 0 : 1, l = 1 - w;
    const f = F[w], e = F[l], hand = hands[w], card = f.slots[hand];
    const kind = kindOf(f, hand);
    const prev = f.lastHit;
    let mult = 1;
    if (kind === "normal") mult = gaugeMult(gauge[w] ?? 0, gauge[l] ?? 0);

    let dmg = Math.floor(attackPower(f, hand) * K[kind] * mult);
    if (card === "sutemi") {
      dmg += Math.floor(e.maxHp * 0.1);
      const self = Math.floor(f.maxHp * 0.075);
      f.hp = Math.max(1, f.hp - self);
      ev.push({ t: "self", who: w, amount: self });
    }
    const guard = Object.values(e.slots).includes("guardUp") ? e.fireflies : 0;
    if (guard) dmg = Math.floor(dmg * (1 - 0.1 * guard));
    e.hp -= dmg;
    ev.push({ t: "attack", who: w, hand, kind, move: moveName(f, hand), dmg, mult: kind === "normal" ? mult : null, guard });

    // 連続勝利のほたる
    if (Object.values(e.slots).includes("guardUp")) e.fireflies = 0;
    if (Object.values(f.slots).includes("guardUp")) f.fireflies = Math.min(4, f.fireflies + 1);

    const heal = (amt, by) => {
      amt = Math.min(amt, f.maxHp - f.hp);
      if (amt > 0) { f.hp += amt; ev.push({ t: "heal", who: w, amount: amt, by }); }
    };
    if (card === "heal" && prev) heal(Math.floor(prev.dmg * 0.2), "heal");
    if (card === "counterHeal" && prev && prev.kind !== "normal") {
      heal(Math.floor(prev.dmg * (isSmall(f.bug) ? 0.6 : 0.5)), "counterHeal");
    }
    if (card === "aikoBreak") { f.shield = isSmall(f.bug) ? 2 : 1; ev.push({ t: "shield", who: w }); }
    if (card === "atkDown") {
      const lost = hands[l];
      e.atkDown[lost] = Math.min(0.5, e.atkDown[lost] + (isSmall(f.bug) ? 0.2 : 0.1));
      ev.push({ t: "atkDown", who: l, hand: lost });
    }
    e.lastHit = { dmg, kind };
    f.lastHit = null;
  }

  // あいこやぶりのターン消費(今ラウンドに付いた分は消費しない)
  F.forEach((f, i) => { if (shieldBefore[i] > 0) f.shield = Math.max(0, f.shield - 1); });

  F.forEach((f) => { f.hp = Math.max(0, f.hp); });
  const dead = F.map((f) => f.hp <= 0);
  const over = dead[0] || dead[1];
  const winner = !over ? null : dead[0] && dead[1] ? null : dead[0] ? 1 : 0;
  return { events: ev, over, winner };
}
