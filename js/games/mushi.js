import {
  HANDS, HAND_LABEL, HAND_ICON, BUGS, BUG_BY_ID, SPECIALS, ATTACK_CARDS, CARD_LABEL, BONUS,
  allowedCards, makeFighter, kindOf, moveName, previewDamage, resolveRound, gaugeLabel,
  maxHpOf, beats, isSmall,
} from "../mushi.js";

const KIND_LABEL = { normal: "通常わざ", hissatsu: "必殺わざ", ult: "超必殺わざ" };
const GAUGE_PERIOD_MS = 1400;
const GAUGE_LIMIT_MS = 5000;
const RESULT_MS = 3200;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function create({ root, role, send }) {
  const me = role, opp = 1 - role;
  let phase;          // build | waiting | choose | locked | gauge | gaugeWait | result | over
  let deck;           // 自分の編成 {bug, slots}
  let theirDeck;      // 相手の編成
  let F;              // [fighter0, fighter1]
  let round, picks, gauges, lastLog, banner;
  let timer, raf, gaugeStart, destroyed = false;

  root.innerHTML = `<div class="mk"></div>`;
  const view = root.firstChild;

  // ---------- 編成 ----------
  function resetAll(msg) {
    clearTimeout(timer); cancelAnimationFrame(raf);
    deck = { bug: null, slots: { g: null, c: null, p: null } };
    theirDeck = null; F = null; round = 0; picks = {}; gauges = {}; lastLog = []; banner = msg || "";
    phase = "build";
    render();
  }

  function cardText(bug, hand, c) {
    if (c === null) return "なし";
    if (c === "ult") return `超必殺カード「${bug.ult}」(ボーナス+${BONUS[bug.str].ult})`;
    if (ATTACK_CARDS.includes(c)) {
      const [hi, no] = BONUS[bug.str][c];
      return `${CARD_LABEL[c]} (${hand === bug.hand ? "必殺" : "通常"}+${hand === bug.hand ? hi : no})`;
    }
    return `${SPECIALS[c].label}`;
  }

  function renderBuild() {
    const bug = deck.bug && BUG_BY_ID[deck.bug];
    let h = `<p class="note">ムシを1匹選び、グー・チョキ・パーにわざカードを付けて対戦しよう。体力を先に0にした方の勝ち!</p>
      <div class="mk-bugs">` +
      BUGS.map((b) => `<button class="mk-bug${bug && bug.id === b.id ? " sel" : ""}" data-bug="${b.id}" style="--hue:${b.hue}">
        <span class="mk-ic">🪲</span><b>${esc(b.name)}</b>
        <span>つよさ ${b.str}</span><span>${HAND_ICON[b.hand]} ${esc(b.move)}</span></button>`).join("") + `</div>`;
    if (bug) {
      h += `<div class="mk-info">体力 ${maxHpOf(bug)} / あいこダメージ ${Math.floor(maxHpOf(bug) / 10)} / ${isSmall(bug) ? "小型" : "中大型"}</div>`;
      const f = makeFighter(deck);
      for (const hand of HANDS) {
        const opts = allowedCards(bug, hand);
        h += `<label class="mk-slot">${HAND_ICON[hand]} ${HAND_LABEL[hand]}${hand === bug.hand ? "(必殺の手)" : ""}
          <select data-hand="${hand}">` +
          opts.map((c) => `<option value="${c ?? ""}"${deck.slots[hand] === c ? " selected" : ""}>${esc(cardText(bug, hand, c))}</option>`).join("") +
          `</select>
          <span class="mk-prev">${f ? `${KIND_LABEL[kindOf(f, hand)]}「${esc(moveName(f, hand))}」 ダメージ目安 ${previewDamage(f, hand)}` : "同じ特殊わざは1枚まで"}
          ${SPECIALS[deck.slots[hand]] ? `<br>${esc(SPECIALS[deck.slots[hand]].desc)}` : ""}</span></label>`;
      }
    }
    h += `<button class="primary mk-go"${bug && makeFighter(deck) ? "" : " disabled"}>この編成でバトル!</button>`;
    view.innerHTML = h;
    view.querySelectorAll(".mk-bug").forEach((el) => (el.onclick = () => {
      deck = { bug: el.dataset.bug, slots: { g: null, c: null, p: null } }; render();
    }));
    view.querySelectorAll(".mk-slot select").forEach((el) => (el.onchange = () => {
      deck.slots[el.dataset.hand] = el.value || null; render();
    }));
    view.querySelector(".mk-go").onclick = () => {
      if (!makeFighter(deck)) return;
      send({ t: "deck", bug: deck.bug, slots: deck.slots });
      phase = "waiting"; render(); maybeStart();
    };
  }

  function maybeStart() {
    if (phase !== "waiting" || !theirDeck) return;
    const mine = makeFighter(deck), theirs = makeFighter(theirDeck);
    if (!mine || !theirs) return;
    F = me === 0 ? [mine, theirs] : [theirs, mine];
    round = 1; picks = {}; gauges = {}; lastLog = []; banner = "";
    phase = "choose";
    render();
  }

  // ---------- 対戦画面 ----------
  const hpBar = (f, label, mine) => {
    const pct = Math.round((f.hp / f.maxHp) * 100);
    const chips = [
      f.fireflies ? `<span class="chip">ほたる×${f.fireflies}</span>` : "",
      f.shield ? `<span class="chip">あいこやぶり(${f.shield})</span>` : "",
      ...HANDS.filter((h) => f.atkDown[h] > 0).map((h) => `<span class="chip">${HAND_ICON[h]}攻撃ダウン</span>`),
    ].join("");
    return `<div class="mk-fighter${mine ? " mine" : ""}" style="--hue:${f.bug.hue}">
      <div class="mk-fname"><b>${label}</b> ${esc(f.bug.name)} <small>つよさ${f.bug.str}</small></div>
      <div class="mk-hp"><div class="mk-hp-fill${pct <= 30 ? " low" : ""}" style="width:${pct}%"></div><span>${f.hp} / ${f.maxHp}</span></div>
      <div class="mk-chips">${chips}</div></div>`;
  };

  function eventText(e) {
    const nm = (i) => (i === me ? "あなた" : "相手");
    switch (e.t) {
      case "aiko": return `あいこ!${nm(e.who)}に${e.dmg}ダメージ`;
      case "aikoBlock": return `${nm(e.who)}はあいこダメージを防いだ!`;
      case "attack": {
        const who = F[e.who].bug.name;
        const g = e.mult ? `(${gaugeLabel(e.mult)})` : "";
        const gd = e.guard ? `(ほたるで軽減)` : "";
        return `${nm(e.who)}の${who}の${KIND_LABEL[e.kind]}「${e.move}」${g}!${nm(1 - e.who)}に${e.dmg}ダメージ${gd}`;
      }
      case "heal": return `${nm(e.who)}は${SPECIALS[e.by].label}で${e.amount}回復`;
      case "self": return `${nm(e.who)}はすてみで${e.amount}ダメージ`;
      case "shield": return `${nm(e.who)}はあいこやぶりを発動`;
      case "atkDown": return `${nm(e.who)}の${HAND_LABEL[e.hand]}の攻撃力ダウン`;
      default: return "";
    }
  }

  function renderBattle() {
    let h = `<div class="mk-field">${hpBar(F[opp], "相手", false)}<div class="mk-vs">VS</div>${hpBar(F[me], "あなた", true)}</div>`;
    h += `<div class="mk-log" aria-live="polite">${lastLog.map((l) => `<div>${esc(l)}</div>`).join("") || "<div>じゃんけんで勝った方が攻撃!</div>"}</div>`;
    if (phase === "choose" || phase === "locked") {
      const f = F[me];
      h += `<p class="status">第${round}ラウンド ${phase === "choose" ? "手を選ぼう!" : "相手を待っています…"}</p><div class="mk-hands">` +
        HANDS.map((hd) => {
          const k = kindOf(f, hd);
          const sp = SPECIALS[f.slots[hd]];
          return `<button class="mk-hand${picks[round]?.[me] === hd ? " sel" : ""}" data-h="${hd}"${phase !== "choose" ? " disabled" : ""}>
            <span class="mk-hi">${HAND_ICON[hd]}</span><b>${HAND_LABEL[hd]}</b>
            <small>${KIND_LABEL[k]}</small><small>${esc(sp ? sp.label : moveName(f, hd))}</small></button>`;
        }).join("") + `</div>`;
    } else if (phase === "gauge" || phase === "gaugeWait") {
      const attacker = revealWinner() === me;
      h += `<p class="status">${attacker ? "攻撃ゲージ!真ん中でストップ!" : "防御ゲージ!真ん中でストップ!"}</p>
        <div class="mk-gauge"><div class="mk-zone"></div><div class="mk-cursor"></div></div>
        <button class="primary mk-stop"${phase === "gauge" ? "" : " disabled"}>${phase === "gauge" ? "ストップ!" : "相手を待っています…"}</button>`;
    } else if (phase === "waiting") {
      h += `<p class="status">相手の編成を待っています…</p>`;
    } else if (phase === "result") {
      h += `<p class="status">次のラウンドへ…</p>`;
    } else if (phase === "over") {
      h += `<p class="status mk-end">${banner}</p>`;
    }
    h += `<button class="restart">もう一度(編成からやり直し)</button>`;
    view.innerHTML = h;
    view.querySelectorAll(".mk-hand").forEach((el) => (el.onclick = () => pickHand(el.dataset.h)));
    const stop = view.querySelector(".mk-stop");
    if (stop && phase === "gauge") stop.addEventListener("pointerdown", (e) => { e.preventDefault(); stopGauge(); });
    if (phase === "gauge") animateGauge();
  }

  function render() {
    if (phase === "build") {
      renderBuild();
      view.insertAdjacentHTML("beforeend", `<p class="status">${esc(banner)}</p>`);
    } else if (phase === "waiting" && !F) {
      view.innerHTML = `<p class="status">相手の編成を待っています…</p><button class="restart">編成からやり直し</button>`;
    } else {
      renderBattle();
    }
    const r = view.querySelector(".restart");
    if (r) r.onclick = () => { send({ t: "restart" }); resetAll(); };
  }

  // ---------- ラウンド進行 ----------
  function pickHand(hd) {
    if (phase !== "choose") return;
    (picks[round] ||= [])[me] = hd;
    send({ t: "hand", round, h: hd });
    phase = "locked";
    render();
    tryReveal();
  }

  function revealWinner() {
    const p = picks[round];
    if (!p || p[0] === p[1]) return null;
    return beats(p[0], p[1]) ? 0 : 1;
  }

  function tryReveal() {
    const p = picks[round];
    if (phase !== "locked" || !p || !p[0] || !p[1]) return;
    const w = revealWinner();
    if (w !== null && kindOf(F[w], p[w]) === "normal") {
      phase = "gauge"; gaugeStart = performance.now();
      render();
      clearTimeout(timer);
      timer = setTimeout(() => stopGauge(), GAUGE_LIMIT_MS);
      tryResolve();
    } else {
      resolve();
    }
  }

  function gaugePos(now) {
    const t = ((now - gaugeStart) % GAUGE_PERIOD_MS) / GAUGE_PERIOD_MS;
    return t < 0.5 ? t * 2 : 2 - t * 2; // 0→1→0
  }

  function animateGauge() {
    cancelAnimationFrame(raf);
    const cur = view.querySelector(".mk-cursor");
    const loop = () => {
      if (destroyed || phase !== "gauge" || !cur.isConnected) return;
      cur.style.left = gaugePos(performance.now()) * 100 + "%";
      raf = requestAnimationFrame(loop);
    };
    loop();
  }

  function stopGauge() {
    if (phase !== "gauge") return;
    clearTimeout(timer);
    const pos = gaugePos(performance.now());
    const v = Math.round((1 - Math.abs(pos - 0.5) * 2) * 1000) / 1000;
    (gauges[round] ||= [])[me] = v;
    send({ t: "gauge", round, v });
    phase = "gaugeWait";
    render();
    tryResolve();
  }

  function tryResolve() {
    const g = gauges[round];
    if (phase !== "gaugeWait" && phase !== "gauge") return;
    if (phase === "gauge" || !g || g[0] === undefined || g[1] === undefined) return;
    resolve();
  }

  function resolve() {
    cancelAnimationFrame(raf);
    const p = picks[round];
    const res = resolveRound(F, [p[0], p[1]], gauges[round] || []);
    const head = `${HAND_ICON[p[me]]} あなた vs 相手 ${HAND_ICON[p[opp]]}`;
    lastLog = [head, ...res.events.map(eventText).filter(Boolean)];
    if (res.over) {
      phase = "over";
      banner = res.winner === null ? "引き分け!" : res.winner === me ? "あなたの勝ち!" : "あなたの負け…";
      render();
    } else {
      phase = "result";
      render();
      timer = setTimeout(() => { if (destroyed) return; round++; phase = "choose"; render(); }, RESULT_MS);
    }
  }

  resetAll();
  return {
    onMessage(m) {
      if (m.t === "deck") {
        if (!makeFighter(m)) return;
        theirDeck = { bug: m.bug, slots: m.slots };
        maybeStart();
      } else if (m.t === "hand" && F && HANDS.includes(m.h) && Number.isInteger(m.round)) {
        (picks[m.round] ||= [])[opp] = m.h;
        if (m.round === round) tryReveal();
      } else if (m.t === "gauge" && F && Number.isInteger(m.round) && m.v >= 0 && m.v <= 1) {
        (gauges[m.round] ||= [])[opp] = m.v;
        if (m.round === round) tryResolve();
      } else if (m.t === "restart") {
        resetAll("相手が編成からやり直しました。");
      }
    },
    destroy() { destroyed = true; clearTimeout(timer); cancelAnimationFrame(raf); },
  };
}

export default {
  id: "mushi",
  name: "甲虫じゃんけんバトル",
  desc: "ムシとわざカードを編成して、じゃんけんで攻撃しあい体力を0に!目押しゲージもあるよ",
  create,
};
