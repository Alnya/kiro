// デッキ構築ローグライク(協力)のゲームデータ。カード・敵・レリック・ポーション・イベント。
// 効果関数は Game(engine.js) の API を受け取って実行する。名称・絵はすべてオリジナル。

export const CLASSES = {
  knight: { name: "ナイト", ic: "🛡️", hp: 80, relic: "core", start: ["strike", "strike", "strike", "strike", "strike", "defend", "defend", "defend", "defend", "shieldBash"], desc: "ブロックと筋力で戦う頑丈な戦士" },
  mage: { name: "メイジ", ic: "🔮", hp: 64, relic: "staff", start: ["strike", "strike", "strike", "strike", "strike", "defend", "defend", "defend", "defend", "venomBolt"], desc: "毒と呪文、ドローとエナジーを操る" },
  ranger: { name: "レンジャー", ic: "🏹", hp: 70, relic: "quiver", start: ["strike", "strike", "strike", "strike", "strike", "defend", "defend", "defend", "defend", "weakShot"], desc: "ナイフと手数で戦う素早い狩人" },
};

const same = (g, c) => g.hit(c.p, c.t, c.v.d);

// ---- カード ----
// tg: enemy(敵1体) / all(敵全体) / self / ally(味方1人) / allp(味方全員) / none
// fl: exhaust(使うと除外) ethereal(手札に残ると除外) innate(最初の手札) retain unplayable
export const CARDS = {
  // ===== 共通 =====
  strike: { name: "ストライク", cls: "any", rar: "basic", type: "attack", cost: 1, tg: "enemy", v: { d: 6 }, u: { d: 9 }, ic: "🗡️", text: "{d}ダメージ", play: same },
  defend: { name: "ディフェンド", cls: "any", rar: "basic", type: "skill", cost: 1, tg: "self", v: { b: 5 }, u: { b: 8 }, ic: "🛡️", text: "ブロック{b}", play: (g, c) => g.block(c.p, c.v.b) },

  // ===== ナイト =====
  shieldBash: { name: "盾打ち", cls: "knight", rar: "basic", type: "attack", cost: 2, tg: "enemy", v: { d: 8, s: 2 }, u: { d: 10, s: 3 }, ic: "🔨", text: "{d}ダメージ。弱点{s}", play: (g, c) => { g.hit(c.p, c.t, c.v.d); g.status(c.t, "vuln", c.v.s); } },
  twinSlash: { name: "二連斬", cls: "knight", rar: "common", type: "attack", cost: 1, tg: "enemy", v: { d: 5 }, u: { d: 7 }, ic: "⚔️", text: "{d}ダメージ×2", play: (g, c) => g.hit(c.p, c.t, c.v.d, 2) },
  sweep: { name: "なぎはらい", cls: "knight", rar: "common", type: "attack", cost: 1, tg: "all", v: { d: 8 }, u: { d: 11 }, ic: "🌀", text: "敵全体に{d}ダメージ", play: (g, c) => g.aoe(c.p, c.v.d) },
  parry: { name: "受け流し", cls: "knight", rar: "common", type: "skill", cost: 1, tg: "self", v: { b: 8, n: 1 }, u: { b: 11, n: 1 }, ic: "🤺", text: "ブロック{b}。{n}枚引く", play: (g, c) => { g.block(c.p, c.v.b); g.draw(c.p, c.v.n); } },
  bodySlam: { name: "体当たり", cls: "knight", rar: "common", type: "attack", cost: 1, uc: 0, tg: "enemy", v: {}, u: {}, ic: "💥", text: "現在のブロックと同じダメージ", play: (g, c) => g.hit(c.p, c.t, c.p.block) },
  ironWave: { name: "鉄の波", cls: "knight", rar: "common", type: "attack", cost: 1, tg: "enemy", v: { d: 5, b: 5 }, u: { d: 7, b: 7 }, ic: "🌊", text: "{d}ダメージ。ブロック{b}", play: (g, c) => { g.block(c.p, c.v.b); g.hit(c.p, c.t, c.v.d); } },
  flex: { name: "気合い", cls: "knight", rar: "common", type: "skill", cost: 0, tg: "self", v: { n: 2 }, u: { n: 4 }, ic: "💪", text: "このターン筋力+{n}", play: (g, c) => { g.status(c.p, "str", c.v.n); g.status(c.p, "strTmp", c.v.n); } },
  skullcrack: { name: "兜割り", cls: "knight", rar: "common", type: "attack", cost: 2, tg: "enemy", v: { d: 14, s: 1 }, u: { d: 18, s: 2 }, ic: "🪓", text: "{d}ダメージ。脱力{s}", play: (g, c) => { g.hit(c.p, c.t, c.v.d); g.status(c.t, "weak", c.v.s); } },
  ironwall: { name: "鉄壁", cls: "knight", rar: "uncommon", type: "power", cost: 1, tg: "self", v: { n: 3 }, u: { n: 4 }, ic: "🏰", text: "ターン終了時ブロック+{n}", play: (g, c) => g.status(c.p, "metal", c.v.n) },
  fury: { name: "闘気", cls: "knight", rar: "uncommon", type: "power", cost: 1, tg: "self", v: { n: 2 }, u: { n: 3 }, ic: "🔥", text: "筋力+{n}", play: (g, c) => g.status(c.p, "str", c.v.n) },
  entrench: { name: "堅陣", cls: "knight", rar: "uncommon", type: "skill", cost: 2, uc: 1, tg: "self", v: {}, u: {}, ic: "⛰️", text: "現在のブロックを2倍にする", play: (g, c) => g.rawBlock(c.p, c.p.block) },
  heavyBlade: { name: "重撃", cls: "knight", rar: "uncommon", type: "attack", cost: 2, tg: "enemy", v: { d: 14, m: 3 }, u: { d: 14, m: 5 }, ic: "🗡️", text: "{d}ダメージ。筋力の効果が{m}倍", play: (g, c) => g.hit(c.p, c.t, c.v.d + (c.p.st.str || 0) * (c.v.m - 1)) },
  reaper: { name: "刈り取り", cls: "knight", rar: "uncommon", type: "attack", cost: 2, tg: "all", v: { d: 4 }, u: { d: 5 }, fl: ["exhaust"], ic: "☠️", text: "敵全体に{d}ダメージ。与えたHPダメージ分回復。除外", play: (g, c) => { const n = g.aoe(c.p, c.v.d); g.heal(c.p, n); } },
  intimidate: { name: "威圧", cls: "knight", rar: "uncommon", type: "skill", cost: 0, tg: "all", v: { s: 1 }, u: { s: 2 }, fl: ["exhaust"], ic: "😤", text: "敵全体に脱力{s}。除外", play: (g, c) => g.enemies().forEach((e) => g.status(e, "weak", c.v.s)) },
  barricade: { name: "不屈の砦", cls: "knight", rar: "rare", type: "power", cost: 3, uc: 2, tg: "self", v: {}, u: {}, ic: "🏯", text: "ブロックがターン開始時に消えなくなる", play: (g, c) => g.status(c.p, "barricade", 1) },
  demonForm: { name: "鬼神化", cls: "knight", rar: "rare", type: "power", cost: 3, tg: "self", v: { n: 2 }, u: { n: 3 }, ic: "👹", text: "ターン開始時に筋力+{n}", play: (g, c) => g.status(c.p, "demon", c.v.n) },
  limitBreak: { name: "限界突破", cls: "knight", rar: "rare", type: "skill", cost: 1, tg: "self", v: {}, u: {}, fl: ["exhaust"], ufl: [], ic: "⚡", text: "筋力を2倍にする。除外", play: (g, c) => g.status(c.p, "str", c.p.st.str || 0) },
  guardianOath: { name: "守護の誓い", cls: "knight", rar: "uncommon", type: "skill", cost: 1, tg: "ally", coop: true, v: { b: 10, c: 5 }, u: { b: 14, c: 7 }, ic: "🤝", text: "【協力】味方にブロック{b}。自分にブロック{c}", play: (g, c) => { g.rawBlock(c.t, c.v.b); g.rawBlock(c.p, c.v.c); } },
  tauntRoar: { name: "挑発の咆哮", cls: "knight", rar: "uncommon", type: "skill", cost: 1, tg: "self", coop: true, v: { b: 12 }, u: { b: 16 }, ic: "📢", text: "【協力】このターン敵の攻撃を全て自分に集める。ブロック{b}", play: (g, c) => { g.status(c.p, "taunt", 1); g.block(c.p, c.v.b); } },
  shareMight: { name: "力の分与", cls: "knight", rar: "rare", type: "skill", cost: 1, tg: "ally", coop: true, v: { n: 2 }, u: { n: 3 }, fl: ["exhaust"], ic: "🎁", text: "【協力】味方の筋力+{n}。除外", play: (g, c) => g.status(c.t, "str", c.v.n) },

  // ===== メイジ =====
  venomBolt: { name: "毒の矢", cls: "mage", rar: "basic", type: "attack", cost: 1, tg: "enemy", v: { d: 5, s: 3 }, u: { d: 7, s: 5 }, ic: "🏹", text: "{d}ダメージ。毒{s}", play: (g, c) => { g.hit(c.p, c.t, c.v.d); g.status(c.t, "poison", c.v.s); } },
  frostBarrier: { name: "氷の障壁", cls: "mage", rar: "common", type: "skill", cost: 1, tg: "enemy", v: { b: 7, s: 1 }, u: { b: 10, s: 2 }, ic: "🧊", text: "ブロック{b}。敵に脱力{s}", play: (g, c) => { g.block(c.p, c.v.b); g.status(c.t, "weak", c.v.s); } },
  zap: { name: "火花", cls: "mage", rar: "common", type: "attack", cost: 1, tg: "enemy", v: { d: 9 }, u: { d: 12 }, ic: "✨", text: "{d}ダメージ", play: same },
  meteor: { name: "流星雨", cls: "mage", rar: "common", type: "attack", cost: 2, tg: "all", v: { d: 10 }, u: { d: 14 }, ic: "☄️", text: "敵全体に{d}ダメージ", play: (g, c) => g.aoe(c.p, c.v.d) },
  toxicCloud: { name: "毒霧", cls: "mage", rar: "common", type: "skill", cost: 1, tg: "all", v: { s: 4 }, u: { s: 6 }, ic: "☁️", text: "敵全体に毒{s}", play: (g, c) => g.enemies().forEach((e) => g.status(e, "poison", c.v.s)) },
  insight: { name: "ひらめき", cls: "mage", rar: "common", type: "skill", cost: 1, tg: "self", v: { n: 3 }, u: { n: 4 }, ic: "💡", text: "{n}枚引く", play: (g, c) => g.draw(c.p, c.v.n) },
  manaBurst: { name: "魔力解放", cls: "mage", rar: "uncommon", type: "skill", cost: 0, tg: "self", v: { n: 2 }, u: { n: 3 }, fl: ["exhaust"], ic: "💠", text: "エナジー+{n}。除外", play: (g, c) => g.addEnergy(c.p, c.v.n) },
  catalyst: { name: "触媒", cls: "mage", rar: "uncommon", type: "skill", cost: 1, tg: "enemy", v: { k: 2 }, u: { k: 3 }, fl: ["exhaust"], ic: "⚗️", text: "敵の毒を{k}倍にする。除外", play: (g, c) => { const p = c.t.st.poison || 0; if (p) g.status(c.t, "poison", p * (c.v.k - 1)); } },
  neurotoxin: { name: "致死の毒", cls: "mage", rar: "common", type: "skill", cost: 1, tg: "enemy", v: { s: 7 }, u: { s: 10 }, ic: "🐍", text: "毒{s}", play: (g, c) => g.status(c.t, "poison", c.v.s) },
  drain: { name: "吸魂", cls: "mage", rar: "uncommon", type: "attack", cost: 1, tg: "enemy", v: { d: 7, h: 3 }, u: { d: 9, h: 4 }, ic: "👻", text: "{d}ダメージ。HPダメージを与えたら{h}回復", play: (g, c) => { const n = g.hit(c.p, c.t, c.v.d); if (n > 0) g.heal(c.p, c.v.h); } },
  hex: { name: "呪縛", cls: "mage", rar: "uncommon", type: "skill", cost: 1, tg: "enemy", v: { s: 2 }, u: { s: 3 }, ic: "🔗", text: "敵に脱力{s}と弱点{s}", play: (g, c) => { g.status(c.t, "weak", c.v.s); g.status(c.t, "vuln", c.v.s); } },
  deepThought: { name: "深き思索", cls: "mage", rar: "rare", type: "power", cost: 1, uc: 0, tg: "self", v: { n: 1 }, u: { n: 1 }, ic: "📚", text: "毎ターン引く枚数+{n}", play: (g, c) => g.status(c.p, "drawUp", c.v.n) },
  manaReactor: { name: "魔力炉", cls: "mage", rar: "rare", type: "power", cost: 3, uc: 2, tg: "self", v: { n: 1 }, u: { n: 1 }, ic: "🔆", text: "毎ターンエナジー+{n}", play: (g, c) => g.status(c.p, "energyUp", c.v.n) },
  plagueAura: { name: "疫病のオーラ", cls: "mage", rar: "rare", type: "power", cost: 2, tg: "self", v: { n: 2 }, u: { n: 3 }, ic: "🦠", text: "ターン開始時、敵全体に毒{n}", play: (g, c) => g.status(c.p, "plague", c.v.n) },
  fireburst: { name: "爆炎", cls: "mage", rar: "uncommon", type: "attack", cost: "X", tg: "all", v: { d: 8 }, u: { d: 11 }, ic: "🔥", text: "敵全体に{d}ダメージをX回", play: (g, c) => g.aoe(c.p, c.v.d, c.x) },
  mirrorWard: { name: "鏡の加護", cls: "mage", rar: "uncommon", type: "skill", cost: 1, tg: "ally", coop: true, v: { b: 4 }, u: { b: 8 }, ic: "🪞", text: "【協力】味方に(自分の現在ブロック+{b})のブロック", play: (g, c) => g.rawBlock(c.t, c.p.block + c.v.b) },
  energySurge: { name: "エナジー供給", cls: "mage", rar: "rare", type: "skill", cost: 0, tg: "ally", coop: true, v: { n: 2 }, u: { n: 3 }, fl: ["exhaust"], ic: "🔋", text: "【協力】味方のエナジー+{n}。除外", play: (g, c) => g.addEnergy(c.t, c.v.n) },
  healingLight: { name: "癒しの光", cls: "mage", rar: "uncommon", type: "skill", cost: 2, tg: "ally", coop: true, v: { h: 12 }, u: { h: 18 }, fl: ["exhaust"], ic: "🌟", text: "【協力】味方のHPを{h}回復。除外", play: (g, c) => g.heal(c.t, c.v.h) },

  // ===== レンジャー =====
  weakShot: { name: "牽制射撃", cls: "ranger", rar: "basic", type: "attack", cost: 1, tg: "enemy", v: { d: 5, s: 1 }, u: { d: 7, s: 2 }, ic: "🎯", text: "{d}ダメージ。脱力{s}", play: (g, c) => { g.hit(c.p, c.t, c.v.d); g.status(c.t, "weak", c.v.s); } },
  shiv: { name: "ナイフ", cls: "token", rar: "token", type: "attack", cost: 0, tg: "enemy", v: { d: 4 }, u: { d: 6 }, fl: ["exhaust"], ic: "🔪", text: "{d}ダメージ。除外", play: (g, c) => g.hit(c.p, c.t, c.v.d + (c.p.st.accuracy || 0)) },
  bladeDance: { name: "ナイフの舞", cls: "ranger", rar: "common", type: "skill", cost: 1, tg: "self", v: { n: 3 }, u: { n: 4 }, ic: "💃", text: "ナイフを{n}枚手札に加える", play: (g, c) => g.addCard(c.p, "shiv", "hand", false, c.v.n) },
  flurry: { name: "連続射撃", cls: "ranger", rar: "common", type: "attack", cost: 1, tg: "enemy", v: { d: 3, m: 3 }, u: { d: 4, m: 3 }, ic: "🌠", text: "{d}ダメージ×{m}", play: (g, c) => g.hit(c.p, c.t, c.v.d, c.v.m) },
  backflip: { name: "後方宙返り", cls: "ranger", rar: "common", type: "skill", cost: 1, tg: "self", v: { b: 5, n: 2 }, u: { b: 8, n: 2 }, ic: "🤸", text: "ブロック{b}。{n}枚引く", play: (g, c) => { g.block(c.p, c.v.b); g.draw(c.p, c.v.n); } },
  roll: { name: "ローリング", cls: "ranger", rar: "common", type: "skill", cost: 0, tg: "self", v: { b: 3, n: 1 }, u: { b: 5, n: 1 }, ic: "🌀", text: "ブロック{b}。{n}枚引く", play: (g, c) => { g.block(c.p, c.v.b); g.draw(c.p, c.v.n); } },
  backstab: { name: "不意打ち", cls: "ranger", rar: "uncommon", type: "attack", cost: 0, tg: "enemy", v: { d: 11 }, u: { d: 15 }, fl: ["exhaust", "innate"], ic: "🥷", text: "{d}ダメージ。最初の手札に来る。除外", play: same },
  legSweep: { name: "足払い", cls: "ranger", rar: "uncommon", type: "skill", cost: 2, tg: "enemy", v: { b: 11, s: 2 }, u: { b: 14, s: 3 }, ic: "🦵", text: "ブロック{b}。敵に脱力{s}", play: (g, c) => { g.block(c.p, c.v.b); g.status(c.t, "weak", c.v.s); } },
  footwork: { name: "軽業", cls: "ranger", rar: "uncommon", type: "power", cost: 1, tg: "self", v: { n: 2 }, u: { n: 3 }, ic: "👟", text: "敏捷+{n}(カードのブロック増加)", play: (g, c) => g.status(c.p, "dex", c.v.n) },
  accuracy: { name: "精密射撃", cls: "ranger", rar: "uncommon", type: "power", cost: 1, tg: "self", v: { n: 3 }, u: { n: 5 }, ic: "🔭", text: "ナイフのダメージ+{n}", play: (g, c) => g.status(c.p, "accuracy", c.v.n) },
  daggerSpray: { name: "ナイフ乱れ撃ち", cls: "ranger", rar: "common", type: "attack", cost: 1, tg: "all", v: { d: 4, m: 2 }, u: { d: 6, m: 2 }, ic: "🌪️", text: "敵全体に{d}ダメージ×{m}", play: (g, c) => g.aoe(c.p, c.v.d, c.v.m) },
  stormOfSteel: { name: "刃の嵐", cls: "ranger", rar: "rare", type: "skill", cost: 1, tg: "self", v: {}, u: {}, fl: ["exhaust"], ic: "🌩️", text: "手札を全て捨て、捨てた枚数のナイフを手札に加える。除外", play: (g, c) => { const n = c.p.hand.length; g.discardHand(c.p); g.addCard(c.p, "shiv", "hand", !!c.up, n); } },
  infiniteBlades: { name: "無限の刃", cls: "ranger", rar: "rare", type: "power", cost: 1, uc: 0, tg: "self", v: { n: 1 }, u: { n: 1 }, ic: "♾️", text: "ターン開始時、ナイフを{n}枚手札に加える", play: (g, c) => g.status(c.p, "blades", c.v.n) },
  piercingArrow: { name: "貫通の矢", cls: "ranger", rar: "rare", type: "attack", cost: 2, tg: "enemy", v: { d: 22 }, u: { d: 30 }, fl: ["exhaust"], ic: "🏹", text: "{d}ダメージ。除外", play: same },
  smokeBomb: { name: "煙幕", cls: "ranger", rar: "uncommon", type: "skill", cost: 1, tg: "allp", coop: true, v: { b: 8 }, u: { b: 11 }, ic: "💨", text: "【協力】味方全員にブロック{b}", play: (g, c) => g.livingPlayers().forEach((q) => g.rawBlock(q, c.v.b)) },
  markTarget: { name: "標的の印", cls: "ranger", rar: "uncommon", type: "skill", cost: 1, tg: "enemy", coop: true, v: { n: 4 }, u: { n: 6 }, ic: "📍", text: "【協力】敵に印{n}(全員の攻撃のダメージ+{n}。毎ラウンド減る)", play: (g, c) => g.status(c.t, "marked", c.v.n) },
  tagTeam: { name: "連携行動", cls: "ranger", rar: "rare", type: "skill", cost: 1, uc: 0, tg: "ally", coop: true, v: { n: 2, e: 1 }, u: { n: 2, e: 1 }, ic: "🙌", text: "【協力】味方は{n}枚引き、エナジー+{e}", play: (g, c) => { g.draw(c.t, c.v.n); g.addEnergy(c.t, c.v.e); } },

  // ===== 無色(協力) =====
  unityStrike: { name: "総攻撃", cls: "colorless", rar: "uncommon", type: "attack", cost: 1, tg: "enemy", coop: true, v: { d: 7, e: 4 }, u: { d: 9, e: 6 }, ic: "🎌", text: "【協力】{d}ダメージ。味方が生きている間は+{e}", play: (g, c) => g.hit(c.p, c.t, c.v.d + (g.other(c.p) ? c.v.e : 0)) },
  patchUp: { name: "応急手当", cls: "colorless", rar: "uncommon", type: "skill", cost: 1, tg: "ally", coop: true, v: { h: 8 }, u: { h: 13 }, fl: ["exhaust"], ic: "🩹", text: "【協力】味方のHPを{h}回復。除外", play: (g, c) => g.heal(c.t, c.v.h) },
  aegisLink: { name: "守りの絆", cls: "colorless", rar: "rare", type: "power", cost: 2, uc: 1, tg: "self", coop: true, v: {}, u: {}, ic: "🔗", text: "【協力】カードで得たブロックの半分を味方も得る", play: (g, c) => g.status(c.p, "link", 1) },

  // ===== 状態カード =====
  wound: { name: "傷", cls: "status", rar: "status", type: "status", cost: 0, tg: "none", v: {}, u: {}, fl: ["unplayable"], ic: "🩸", text: "使用不可", play: () => {} },
  dazed: { name: "めまい", cls: "status", rar: "status", type: "status", cost: 0, tg: "none", v: {}, u: {}, fl: ["unplayable", "ethereal"], ic: "💫", text: "使用不可。手札に残ると除外", play: () => {} },
  slimed: { name: "粘液", cls: "status", rar: "status", type: "status", cost: 1, tg: "none", v: {}, u: {}, fl: ["exhaust"], ic: "🟢", text: "除外", play: () => {} },
};

export function cardFlags(id, up) {
  const d = CARDS[id];
  return up && d.ufl ? d.ufl : d.fl || [];
}
export function cardVals(id, up) { const d = CARDS[id]; return up ? { ...d.v, ...d.u } : d.v; }
export function cardCost(id, up) { const d = CARDS[id]; return up && d.uc !== undefined ? d.uc : d.cost; }
export function cardText(id, up) {
  const d = CARDS[id], v = cardVals(id, up);
  return d.text.replace(/\{(\w)\}/g, (_, k) => (v[k] !== undefined ? v[k] : "?"));
}
export const statusNames = {
  str: "筋力", dex: "敏捷", vuln: "弱点", weak: "脱力", frail: "もろさ", poison: "毒", thorns: "とげ", metal: "鉄壁",
  ritual: "儀式", regen: "再生", barricade: "不屈", taunt: "挑発", demon: "鬼神", drawUp: "ドロー増", energyUp: "エナジー増",
  enrage: "激怒", curl: "丸まり", plague: "疫病", blades: "無限の刃", accuracy: "精密", link: "絆", marked: "印",
  strTmp: "一時筋力", plated: "装甲", sleep: "睡眠",
};
export const statusDesc = {
  str: "攻撃ダメージ+n", dex: "カードのブロック+n", vuln: "受けるダメージ1.5倍(nラウンド)", weak: "与えるダメージ0.75倍(nラウンド)",
  frail: "カードのブロック0.75倍(nラウンド)", poison: "ターン開始時にnダメージ(ブロック無視)。毎ターン1減る", thorns: "攻撃してきた相手にnダメージ",
  metal: "ターン終了時ブロック+n", ritual: "ターン終了時に筋力+n", regen: "ターン終了時にn回復", barricade: "ブロックが消えない",
  taunt: "敵の攻撃を引き受ける", demon: "ターン開始時に筋力+n", drawUp: "毎ターン+n枚引く", energyUp: "毎ターンエナジー+n",
  enrage: "スキルを使われるたび筋力+n", curl: "最初にダメージを受けるとブロック+n", plague: "ターン開始時に敵全体へ毒n", blades: "ターン開始時にナイフをn枚加える",
  accuracy: "ナイフのダメージ+n", link: "ブロックの半分を味方にも", marked: "全員の攻撃のダメージ+n(毎ラウンド減る)", strTmp: "ターン終了時に筋力-n", plated: "ターン開始時にブロックn",
  sleep: "眠っている。HPダメージを受けると起きる",
};
export const DEBUFFS = new Set(["vuln", "weak", "frail", "poison", "marked"]);

// ---- 敵 ----
// moves: k=intent種別 atk/def/buf/dbf/mix/zzz  d=ダメージ h=回数 all=全体攻撃  fx=追加効果
const pickNo3 = (e, g, keys, weights) => {
  const h = e.hist;
  const last = h[h.length - 1], last2 = h[h.length - 2];
  const ok = keys.filter((k) => !(last === k && last2 === k));
  const list = ok.length ? ok : keys;
  const w = list.map((k) => (weights ? weights[keys.indexOf(k)] : 1));
  let r = g.rnd() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < list.length; i++) { r -= w[i]; if (r <= 0) return list[i]; }
  return list[0];
};
const alt = (e, a, b) => (e.hist.length % 2 === 0 ? a : b);

export const ENEMIES = {
  slime: {
    name: "ジェリースライム", ic: "🟢", hp: [12, 15],
    moves: { tackle: { k: "atk", d: 5 }, lick: { k: "mix", d: 3, fx: (g, e, t) => g.status(t, "weak", 1) } },
    ai: (e, g) => pickNo3(e, g, ["tackle", "lick"]),
  },
  gnawer: {
    name: "かじりねずみ", ic: "🐀", hp: [10, 14], start: (g, e) => g.status(e, "curl", 4),
    moves: { bite: { k: "atk", d: 5 }, bite2: { k: "atk", d: 7 }, scurry: { k: "def", b: 5 } },
    ai: (e, g) => pickNo3(e, g, ["bite", "bite2", "scurry"], [3, 2, 1]),
  },
  cultist: {
    name: "カルト信者", ic: "🧙", hp: [28, 32],
    moves: { chant: { k: "buf", fx: (g, e) => g.status(e, "ritual", 3) }, strike: { k: "atk", d: 6 } },
    ai: (e) => (e.hist.length === 0 ? "chant" : "strike"),
  },
  goblin: {
    name: "ゴブリン", ic: "👺", hp: [18, 22],
    moves: { stab: { k: "atk", d: 7 }, guard: { k: "def", b: 6 }, jab: { k: "mix", d: 4, fx: (g, e, t) => g.status(t, "frail", 1) } },
    ai: (e, g) => pickNo3(e, g, ["stab", "guard", "jab"], [3, 1, 2]),
  },
  archer: {
    name: "ゴブリンの弓兵", ic: "🏹", hp: [16, 20],
    moves: { shoot: { k: "atk", d: 8 }, aim: { k: "dbf", fx: (g, e, t) => g.status(t, "vuln", 2) } },
    ai: (e) => (e.hist.length % 3 === 0 ? "aim" : "shoot"),
  },
  chomper: {
    name: "あごむし", ic: "🐛", hp: [40, 44],
    moves: {
      chomp: { k: "atk", d: 11 },
      thrash: { k: "mix", d: 7, b: 5 },
      bellow: { k: "buf", b: 6, fx: (g, e) => g.status(e, "str", 3) },
    },
    ai: (e) => ["chomp", "bellow", "thrash"][e.hist.length % 3],
  },
  fungus: {
    name: "キノコの獣", ic: "🍄", hp: [22, 28],
    moves: { bite: { k: "atk", d: 6 }, grow: { k: "buf", fx: (g, e) => g.status(e, "str", 3) } },
    ai: (e, g) => pickNo3(e, g, ["bite", "grow"], [2, 1]),
    onDeath: (g) => g.livingPlayers().forEach((p) => g.status(p, "vuln", 2)),
    note: "倒すと全員に弱点",
  },
  bandit: {
    name: "山賊", ic: "🥷", hp: [32, 36],
    moves: { slash: { k: "atk", d: 9 }, cross: { k: "mix", d: 7, fx: (g, e, t) => g.status(t, "frail", 1) }, guard: { k: "def", b: 9 } },
    ai: (e, g) => pickNo3(e, g, ["slash", "cross", "guard"], [3, 2, 1]),
  },
  brute: {
    name: "ブルート", ic: "👹", hp: [78, 84], elite: true, start: () => {},
    moves: {
      bellow: { k: "buf", fx: (g, e) => g.status(e, "enrage", 2) },
      rush: { k: "atk", d: 14 },
      skullBash: { k: "mix", d: 6, fx: (g, e, t) => g.status(t, "vuln", 2) },
    },
    ai: (e, g) => (e.hist.length === 0 ? "bellow" : pickNo3(e, g, ["rush", "skullBash"])),
    note: "スキルを使われるたび筋力アップ",
  },
  sleeper: {
    name: "ねむり番", ic: "😴", hp: [105, 112], elite: true,
    start: (g, e) => { g.status(e, "sleep", 1); e.wake = 3; },
    moves: {
      zzz: { k: "zzz" },
      heavy: { k: "atk", d: 16 },
      siphon: { k: "dbf", all: true, fx: (g, e) => g.livingPlayers().forEach((p) => { g.status(p, "str", -1); g.status(p, "dex", -1); }) },
    },
    ai: (e) => {
      if (e.st.sleep) return "zzz";
      const n = e.hist.filter((h) => h !== "zzz").length;
      return n % 3 === 2 ? "siphon" : "heavy";
    },
    note: "眠っている間は動かない。起きると強い",
  },
  colossus: {
    name: "巨像ゴーレム", ic: "🗿", hp: [210, 220], boss: true,
    start: (g, e) => { e.mode = "off"; e.shift = 30 * g.s.players.length; e.taken = 0; },
    moves: {
      charge: { k: "def", b: 9 }, bash: { k: "atk", d: 32 }, vent: { k: "dbf", all: true, fx: (g, e) => g.livingPlayers().forEach((p) => { g.status(p, "weak", 2); g.status(p, "vuln", 2); }) },
      whirl: { k: "atk", d: 5, h: 4, all: true },
      shield: { k: "def", b: 20 }, roll: { k: "atk", d: 9 }, twin: { k: "atk", d: 8, h: 2 },
    },
    ai: (e) => {
      if (e.mode === "def") {
        e.defStep = (e.defStep || 0);
        const m = ["shield", "roll", "twin"][e.defStep % 3];
        e.defStep++;
        if (e.defStep >= 3) { e.mode = "off"; e.defStep = 0; e.hist = []; delete e.st.thorns; }
        return m;
      }
      return ["charge", "bash", "vent", "whirl"][e.hist.length % 4];
    },
    onDamaged: (g, e, n) => {
      if (e.mode !== "off") return;
      e.taken += n;
      if (e.taken >= e.shift) {
        e.mode = "def"; e.defStep = 0; e.taken = 0; e.shift += 10 * g.s.players.length;
        g.status(e, "thorns", 3);
        g.ev("note", e, 0, { text: "守りの形態へ!" });
        g.rePlan(e);
      }
    },
    note: "ダメージを受け続けると守りの形態に変化",
  },
  sporeMother: {
    name: "胞子の母", ic: "🍄", hp: [190, 200], boss: true,
    moves: {
      spores: { k: "mix", d: 6, fx: (g, e, t) => { g.addCard(t, "slimed", "disc", false, 2); } },
      summon: { k: "buf", fx: (g) => { for (let i = 0; i < 2; i++) g.spawn("sporeling"); } },
      smash: { k: "atk", d: 14 },
      mist: { k: "dbf", all: true, fx: (g, e) => g.livingPlayers().forEach((p) => { g.status(p, "vuln", 2); g.status(p, "weak", 2); }) },
    },
    ai: (e, g) => {
      const n = e.hist.length;
      const alive = g.enemies().filter((x) => x !== e).length;
      if (n === 0) return "summon";
      if (n % 4 === 3 && alive < 3) return "summon";
      return ["spores", "smash", "mist"][(n - 1) % 3];
    },
    note: "胞子の子を呼び、粘液で手札を汚す",
  },
  sporeling: {
    name: "胞子の子", ic: "🟤", hp: [10, 12], minion: true,
    moves: { nibble: { k: "atk", d: 4 }, puff: { k: "mix", d: 3, fx: (g, e, t) => g.status(t, "weak", 1) } },
    ai: (e, g) => pickNo3(e, g, ["nibble", "puff"]),
  },
};

// 遭遇: 敵IDの配列
export const ENCOUNTERS = {
  weak: [["slime", "slime"], ["gnawer", "gnawer", "gnawer"], ["cultist"], ["goblin", "slime"]],
  normal: [["chomper"], ["goblin", "archer", "gnawer"], ["fungus", "fungus"], ["bandit", "slime"], ["cultist", "gnawer", "gnawer"], ["archer", "archer", "goblin"]],
  elite: [["brute"], ["sleeper"]],
  boss: [["colossus"], ["sporeMother"]],
};

// ---- レリック ----
export const RELICS = {
  core: { name: "再生の核", ic: "❤️‍🔥", rar: "class", desc: "戦闘に勝利するとHPを6回復", onWin: (g, p) => g.heal(p, 6) },
  staff: { name: "賢者の杖", ic: "🪄", rar: "class", desc: "戦闘開始時に2枚多く引く", onStart: (g, p) => { p.firstDraw += 2; } },
  quiver: { name: "狩人の矢筒", ic: "🎒", rar: "class", desc: "戦闘開始時にナイフを2枚手札に加える", onStart: (g, p) => g.addCard(p, "shiv", "hand", false, 2) },
  fruit: { name: "活力の果実", ic: "🍓", rar: "common", desc: "最大HP+7", onPick: (g, p) => { p.maxHp += 7; p.hp += 7; } },
  bracelet: { name: "戦士の腕輪", ic: "📿", rar: "common", desc: "戦闘開始時に筋力+1", onStart: (g, p) => g.status(p, "str", 1) },
  anchor: { name: "錨", ic: "⚓", rar: "common", desc: "戦闘開始時にブロック10", onStart: (g, p) => g.rawBlock(p, 10) },
  stone: { name: "すべすべの石", ic: "🪨", rar: "common", desc: "戦闘開始時に敏捷+1", onStart: (g, p) => g.status(p, "dex", 1) },
  lantern: { name: "提灯", ic: "🏮", rar: "common", desc: "最初のターンのエナジー+1", onStart: (g, p) => { p.firstEnergy += 1; } },
  prep: { name: "準備の鞄", ic: "👜", rar: "common", desc: "戦闘開始時に2枚多く引く", onStart: (g, p) => { p.firstDraw += 2; } },
  coin: { name: "古い金貨", ic: "🪙", rar: "common", desc: "取得時にゴールド+100", onPick: (g, p) => { p.gold += 100; } },
  orichalcum: { name: "金剛の盾", ic: "🔰", rar: "common", desc: "ターン終了時にブロックが0ならブロック6", onEnd: (g, p) => { if (p.block === 0) g.rawBlock(p, 6); } },
  vial: { name: "血の小瓶", ic: "🧪", rar: "common", desc: "戦闘開始時にHPを3回復", onStart: (g, p) => g.heal(p, 3) },
  thornmail: { name: "棘の鎧", ic: "🦔", rar: "common", desc: "戦闘開始時にとげ3", onStart: (g, p) => g.status(p, "thorns", 3) },
  belt: { name: "薬瓶ベルト", ic: "🎽", rar: "common", desc: "ポーション枠+1", onPick: (g, p) => { p.potions.push(null); } },
};

// ---- ポーション ----
// tg: 'friend'=自分か味方 / 'enemy'
export const POTIONS = {
  heal: { name: "回復薬", ic: "🧪", tg: "friend", desc: "最大HPの25%回復", use: (g, p, t) => g.heal(t, Math.ceil(t.maxHp * 0.25)) },
  energy: { name: "エナジー薬", ic: "⚡", tg: "friend", desc: "エナジー+2", use: (g, p, t) => g.addEnergy(t, 2) },
  strength: { name: "筋力薬", ic: "💪", tg: "friend", desc: "筋力+2", use: (g, p, t) => g.status(t, "str", 2) },
  block: { name: "守りの薬", ic: "🛡️", tg: "friend", desc: "ブロック12", use: (g, p, t) => g.rawBlock(t, 12) },
  fire: { name: "火炎薬", ic: "🔥", tg: "enemy", desc: "敵に20ダメージ", use: (g, p, t) => g.dealDamage(null, t, 20) },
  weak: { name: "弱体薬", ic: "💀", tg: "enemy", desc: "敵に脱力3、弱点3", use: (g, p, t) => { g.status(t, "weak", 3); g.status(t, "vuln", 3); } },
};

// ---- イベント ----
// 選択肢は各プレイヤーがそれぞれ選ぶ
export const EVENTS = {
  spring: {
    name: "癒しの泉", ic: "⛲", text: "澄んだ泉がある。水面がきらめいている。",
    choices: [
      { label: "水を飲む(HP25%回復)", apply: (g, p) => g.heal(p, Math.ceil(p.maxHp * 0.25)) },
      { label: "祈りをささげる(最大HP+5)", apply: (g, p) => { p.maxHp += 5; p.hp += 5; } },
    ],
  },
  altar: {
    name: "古びた祭壇", ic: "🗿", text: "血のあとが残る祭壇。捧げものを求めている。",
    choices: [
      { label: "血を捧げる(HP-8、ランダムなレリック)", apply: (g, p) => { g.loseHp(p, 8); g.giveRelic(p, g.randRelic(p)); } },
      { label: "金貨を捧げる(-60G、最大HP+6)", req: (p) => p.gold >= 60, apply: (g, p) => { p.gold -= 60; p.maxHp += 6; p.hp += 6; } },
      { label: "立ち去る", apply: () => {} },
    ],
  },
  ghost: {
    name: "商人の幽霊", ic: "👻", text: "透けた商人が囁く。「取引をしないか…」",
    choices: [
      { label: "取引する(HP-6、+70G)", apply: (g, p) => { g.loseHp(p, 6); p.gold += 70; } },
      { label: "ポーションを買う(-40G)", req: (p) => p.gold >= 40, apply: (g, p) => { p.gold -= 40; g.givePotion(p, g.randPotion()); } },
      { label: "断る", apply: () => {} },
    ],
  },
  tome: {
    name: "怪しい本", ic: "📖", text: "禁断の書が開かれている。読めば力を得られそうだ。",
    choices: [
      { label: "読む(ランダムな強いカード+傷1枚)", apply: (g, p) => { g.addToDeck(p, g.randCard(p, ["uncommon", "rare"])); g.addToDeck(p, "wound"); } },
      { label: "読まない", apply: () => {} },
    ],
  },
  smith: {
    name: "旅の鍛冶屋", ic: "⚒️", text: "旅の鍛冶屋が焚き火を囲んでいる。",
    choices: [
      { label: "鍛えてもらう(ランダムなカードを強化)", apply: (g, p) => g.upgradeRandom(p) },
      { label: "食事をいただく(HP12回復)", apply: (g, p) => g.heal(p, 12) },
    ],
  },
};
