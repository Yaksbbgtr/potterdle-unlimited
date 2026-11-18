"use strict";

/* =========================================================
 * Extra game modes: Quote, Spell, Potion, Description, Location.
 * Loaded after app.js and reuses its helpers ($, el, store, settings, CHARACTERS, …).
 * Each mode is a clue + free guesses; hints unlock after a number of wrong guesses.
 * Spell and potion data: theDavidBarton/the-harry-potter-database (MIT).
 * ========================================================= */

const M = window.MODES;
const charByName = new Map(CHARACTERS.map((c) => [c.plain, c]));
const bookHint = (n) => `${n}. ${bookTitle(n)}`;
const firstLetter = (s) => `Starts with “${s.replace(/^(The|Number)\s+/i, "")[0].toUpperCase()}”`;
const letterCount = (s) => {
  const words = s.split(/\s+/).map((w) => w.replace(/[^A-Za-z]/g, "").length).filter(Boolean);
  return words.length > 1 ? `${words.length} words (${words.join(", ")} letters)` : `${words[0]} letters`;
};

const characterOptions = () =>
  CHARACTERS.map((c) => ({ key: c.plain, label: c.display, small: c.house && !["None", "Unknown"].includes(c.house) ? c.house : "" }));

const DEFS = {
  quote: {
    label: "Quote",
    noun: "quote",
    kicker: "Who said this?",
    placeholder: "Who said it? Guess a character…",
    items: () => M.quotes,
    keyOf: (q) => q.who,
    clue: (q) => `“${q.q}”`,
    options: characterOptions,
    hints: [{ at: 4, label: "Book", value: (q) => bookHint(q.book) }],
    answerName: (q) => charByName.get(q.who)?.display || q.who,
    answerSub: (q) => `“${q.q}”`,
    facts: (q) => [["Book", bookHint(q.book)]],
    patronus: (q) => charByName.get(q.who)?.patronus,
  },
  spell: {
    label: "Spell",
    noun: "spell",
    kicker: "Which spell does this?",
    placeholder: "Guess a spell…",
    items: () => (settings.famousOnly ? M.spells.filter((s) => s.famous) : M.spells),
    keyOf: (s) => s.name,
    clue: (s) => s.d,
    options: () => M.spells.map((s) => ({ key: s.name, label: s.name, small: s.alt, alt: s.alt })),
    hints: [
      { at: 2, label: "Type", value: (s) => s.type },
      { at: 4, label: "Used", value: (s) => s.hint || "No recorded use." },
      { at: 7, label: "Letter", value: (s) => firstLetter(s.name) },
    ],
    answerName: (s) => s.name,
    answerSub: (s) => s.alt,
    facts: (s) => [["Type", s.type]],
  },
  potion: {
    label: "Potion",
    noun: "potion",
    kicker: "Which potion is this?",
    placeholder: "Guess a potion…",
    items: () => (settings.famousOnly ? M.potions.filter((p) => p.famous) : M.potions),
    keyOf: (p) => p.name,
    clue: (p) => p.d,
    options: () => M.potions.map((p) => ({ key: p.name, label: p.name, small: p.alt, alt: p.alt })),
    hints: [
      { at: 3, label: "Letter", value: (p) => firstLetter(p.name) },
      { at: 6, label: "Length", value: (p) => letterCount(p.name) },
    ],
    answerName: (p) => p.name,
    answerSub: (p) => p.alt,
    facts: () => [],
  },
  description: {
    label: "Description",
    noun: "character",
    kicker: "Who is this?",
    placeholder: "Guess a character…",
    items: () => M.descriptions,
    keyOf: (d) => d.who,
    clue: (d) => d.d,
    options: characterOptions,
    hints: [
      { at: 3, label: "Book", value: (d) => bookHint(d.book) },
      { at: 6, label: "Job", value: (d) => d.job },
    ],
    answerName: (d) => charByName.get(d.who)?.display || d.who,
    answerSub: (d) => d.job,
    facts: (d) => [["First book", bookHint(d.book)]],
    patronus: (d) => charByName.get(d.who)?.patronus,
  },
  location: {
    label: "Location",
    noun: "place",
    kicker: "Where is this?",
    placeholder: "Guess a place…",
    items: () => M.locations,
    keyOf: (l) => l.name,
    clue: (l) => l.d,
    options: () => M.locations.map((l) => ({ key: l.name, label: l.name, small: "" })),
    hints: [
      { at: 3, label: "Book", value: (l) => bookHint(l.book) },
      { at: 6, label: "Area", value: (l) => l.area },
      { at: 9, label: "Letter", value: (l) => firstLetter(l.name) },
    ],
    answerName: (l) => l.name,
    answerSub: (l) => l.area,
    facts: (l) => [["First book", bookHint(l.book)]],
  },
};
const MODE_IDS = ["classic", ...Object.keys(DEFS)];

/* ---------------- state ---------------- */

let mode = store.get("mode", "classic");
if (!MODE_IDS.includes(mode)) mode = "classic";

// history per mode: { quote: [{id, t, won, n, who}], … }
let modeHistory = store.get("modeHistory", {});
const mgames = {}; // mode -> { target: key, guesses: [key], over, won }

const allItems = (m) => M[`${m}s`]; // M.quotes, M.spells, …
const itemFor = (m, key) => allItems(m).find((i) => DEFS[m].keyOf(i) === key);

function loadMGame(m) {
  const g = store.get(`mgame:${m}`, null);
  if (g && itemFor(m, g.target)) return g;
  return null;
}
const saveMGame = (m) => store.set(`mgame:${m}`, mgames[m]);
const saveModeHistory = () => {
  store.set("modeHistory", modeHistory);
  scheduleSync();
};

function modeStats(m) {
  const s = { played: 0, wins: 0, streak: 0, best: 0, dist: {} };
  for (const h of (modeHistory[m] || []).slice().sort((a, b) => a.t - b.t)) {
    s.played++;
    if (h.won) {
      s.wins++;
      s.streak++;
      s.best = Math.max(s.best, s.streak);
      s.dist[h.n] = (s.dist[h.n] || 0) + 1;
    } else s.streak = 0;
  }
  return s;
}

window.modeHistorySnapshot = () => modeHistory;
window.mergeModeHistory = (remote, resetAt) => {
  for (const m of Object.keys(DEFS)) {
    const byId = new Map();
    for (const h of [...(remote[m] || []), ...(modeHistory[m] || [])]) byId.set(h.id, h);
    modeHistory[m] = [...byId.values()].filter((h) => h.t > resetAt).sort((a, b) => a.t - b.t);
  }
  store.set("modeHistory", modeHistory);
  if (mode !== "classic") renderMode();
};
window.resetModeHistory = () => {
  modeHistory = {};
  store.set("modeHistory", modeHistory);
};

/* ---------------- flow ---------------- */

function newMGame(m = mode) {
  const items = DEFS[m].items();
  const recent = store.get(`mrecent:${m}`, []);
  let options = items.filter((i) => !recent.includes(DEFS[m].keyOf(i)));
  if (!options.length) options = items;
  const pick = options[Math.floor(Math.random() * options.length)];
  const key = DEFS[m].keyOf(pick);
  store.set(`mrecent:${m}`, [key, ...recent].slice(0, Math.max(1, Math.floor(items.length / 2))));
  mgames[m] = { target: key, item: allItems(m).indexOf(pick), guesses: [], over: false, won: false };
  saveMGame(m);
}

// Quote and Description modes have several clues per character, so remember which one.
function currentItem(m = mode) {
  const g = mgames[m];
  const byIndex = allItems(m)[g.item];
  if (byIndex && DEFS[m].keyOf(byIndex) === g.target) return byIndex;
  return itemFor(m, g.target);
}

function finishM(won) {
  const g = mgames[mode];
  g.over = true;
  g.won = won;
  const now = Date.now();
  (modeHistory[mode] ||= []).push({
    id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    t: now,
    won,
    n: g.guesses.length,
    who: g.target,
  });
  saveModeHistory();
  saveMGame(mode);
}

function guessM(key) {
  const g = mgames[mode];
  if (g.over || g.guesses.includes(key)) return;
  g.guesses.unshift(key);
  const won = key === g.target;
  if (won) finishM(true);
  else saveMGame(mode);
  renderMode(true);
  if (won) setTimeout(showMEnd, settings.reduceMotion ? 50 : 700);
}

/* ---------------- rendering ---------------- */

const modeEl = $("#clue-mode");
const classicEl = $("#classic");
const mInput = $("#m-input");
const mList = $("#m-suggestions");

function renderNav() {
  const nav = $("#mode-nav");
  nav.replaceChildren(
    ...MODE_IDS.map((m) => {
      const b = el("button", { type: "button", class: "mode-btn" + (m === mode ? " on" : ""), "aria-pressed": String(m === mode) },
        m === "classic" ? "Classic" : DEFS[m].label);
      b.addEventListener("click", () => switchMode(m));
      return b;
    }),
  );
}

function switchMode(m) {
  if (m === mode) return;
  mode = m;
  store.set("mode", m);
  renderNav();
  classicEl.hidden = m !== "classic";
  modeEl.hidden = m === "classic";
  if (m === "classic") {
    updateChrome();
    return;
  }
  if (!mgames[m]) mgames[m] = loadMGame(m);
  if (!mgames[m]) newMGame(m);
  renderMode();
}

function renderMode(justGuessed = false) {
  if (mode === "classic") return;
  const d = DEFS[mode];
  const g = mgames[mode];
  const item = currentItem();
  $("#clue-kicker").textContent = d.kicker;
  $("#clue-text").textContent = d.clue(item);
  $("#clue-text").classList.toggle("quote", mode === "quote");

  const wrong = g.guesses.filter((k) => k !== g.target).length;
  $("#hints").replaceChildren(
    ...d.hints.map((h) => {
      const open = g.over || wrong >= h.at;
      const left = h.at - wrong;
      return el("li", { class: "hint" + (open ? " open" : "") },
        el("span", { class: "hint-label" }, h.label),
        el("span", { class: "hint-value" }, open ? h.value(item) : `in ${left} ${left === 1 ? "guess" : "guesses"}`));
    }),
  );

  const opts = new Map(d.options().map((o) => [o.key, o]));
  $("#m-guesses").replaceChildren(
    ...g.guesses.map((k, i) => {
      const right = k === g.target;
      const li = el("li", { class: "mg " + (right ? "Full" : "None") + (justGuessed && i === 0 ? " pop" : "") },
        el("span", {}, opts.get(k)?.label || k));
      if (opts.get(k)?.small) li.append(el("small", {}, opts.get(k).small));
      return li;
    }),
  );

  mInput.disabled = g.over;
  mInput.placeholder = g.over ? `Round over. Start a new ${d.noun} →` : d.placeholder;
  $("#m-giveup").disabled = g.over;
  $("#m-new").textContent = `${g.over ? "Next" : "New"} ${d.noun}`;
  afterChrome();
}

function afterChrome() {
  if (mode === "classic") return;
  const s = modeStats(mode);
  const g = mgames[mode];
  $("#round-num").textContent = s.played + (g && !g.over ? 1 : 0);
  $("#guess-count").textContent = g ? g.guesses.length : 0;
  $("#streak").textContent = s.streak;
}
window.afterChrome = afterChrome;

function showMEnd() {
  const d = DEFS[mode];
  const g = mgames[mode];
  const item = currentItem();
  const n = g.guesses.length;
  $("#mend-kicker").textContent = g.won ? "You got it" : `The ${d.noun} was`;
  $("#mend-name").textContent = d.answerName(item);
  const sub = d.answerSub(item);
  $("#mend-sub").textContent = sub || "";
  $("#mend-sub").hidden = !sub;
  $("#mend-facts").replaceChildren(...d.facts(item).flatMap(([k, v]) => [el("dt", {}, k), el("dd", {}, v)]));
  const s = modeStats(mode);
  $("#mend-line").textContent = g.won
    ? `Solved in ${n} ${n === 1 ? "guess" : "guesses"}. Streak: ${s.streak}.`
    : `Gave up after ${n} ${n === 1 ? "guess" : "guesses"}.`;
  $("#mend-next").textContent = `Next ${d.noun} →`;
  $("#dlg-mend").showModal();
  const pat = d.patronus?.(item);
  if (g.won && pat && !settings.reduceMotion) runPatronus(pat);
}

$("#dlg-mend").addEventListener("close", () => {
  if ($("#dlg-mend").returnValue === "next") {
    newMGame();
    renderMode();
    mInput.focus();
  }
});
$("#m-giveup").addEventListener("click", () => {
  const g = mgames[mode];
  if (g.over) return;
  if (!confirm(`Give up and reveal the ${DEFS[mode].noun}? This resets your streak.`)) return;
  finishM(false);
  renderMode();
  showMEnd();
});
$("#m-new").addEventListener("click", () => {
  const g = mgames[mode];
  if (!g.over && g.guesses.length) {
    if (!confirm(`Skip this ${DEFS[mode].noun}? It counts as a loss.`)) return;
    finishM(false);
  }
  newMGame();
  renderMode();
  mInput.focus();
});

window.showModeStats = () => {
  if (mode === "classic") return false;
  const s = modeStats(mode);
  const pct = s.played ? Math.round((s.wins / s.played) * 100) : 0;
  const total = Object.entries(s.dist).reduce((a, [k, v]) => a + k * v, 0);
  const avg = s.wins ? (total / s.wins).toFixed(1) : "–";
  $("#stat-grid").replaceChildren(
    ...[[s.played, "Played"], [pct + "%", "Won"], [s.streak, "Streak"], [avg, "Avg"]].map(([v, l]) =>
      el("div", {}, el("b", {}, String(v)), el("span", {}, l))),
  );
  const keys = Object.keys(s.dist).map(Number);
  const dist = $("#dist");
  if (!keys.length) dist.replaceChildren(el("p", { class: "muted small" }, "Win a round to see your distribution."));
  else {
    const hi = Math.max(...keys);
    const buckets = [];
    for (let i = 1; i <= Math.min(hi, 12); i++) buckets.push([String(i), s.dist[i] || 0]);
    if (hi > 12) buckets.push(["13+", keys.filter((k) => k > 12).reduce((a, k) => a + s.dist[k], 0)]);
    const max = Math.max(...buckets.map((b) => b[1]));
    dist.replaceChildren(...buckets.map(([label, count]) =>
      el("div", { class: "dist-row" }, el("span", {}, label),
        el("div", { class: "bar", style: `--w:${Math.max(6, (count / max) * 100)}%` }, String(count)))));
  }
  $("#dlg-stats h2").textContent = `${DEFS[mode].label} statistics`;
  $("#dlg-stats").showModal();
  return true;
};
$("#dlg-stats").addEventListener("close", () => ($("#dlg-stats h2").textContent = "Statistics"));

/* ---------------- autocomplete ---------------- */

let mMatches = [];
let mActive = -1;

function mSearch(q) {
  q = q.trim().toLowerCase();
  if (!q) return [];
  const guessed = new Set(mgames[mode].guesses);
  const scored = [];
  for (const o of DEFS[mode].options()) {
    if (guessed.has(o.key)) continue;
    const hay = [o.label, o.alt || ""].map((s) => clean(s).toLowerCase());
    let score = 9;
    hay.forEach((h, i) => {
      if (h.startsWith(q)) score = Math.min(score, 0 + i);
      else if (h.split(/[\s()'-]+/).some((w) => w.startsWith(q))) score = Math.min(score, 2 + i);
      else if (h.includes(q)) score = Math.min(score, 4 + i);
    });
    if (score < 9) scored.push([score, o]);
  }
  scored.sort((a, b) => a[0] - b[0] || a[1].label.localeCompare(b[1].label));
  return scored.slice(0, 10).map((s) => s[1]);
}

function mRender() {
  const q = mInput.value.trim().toLowerCase();
  mMatches = mSearch(q);
  mActive = mMatches.length ? 0 : -1;
  mList.replaceChildren();
  if (!q) return mClose();
  if (!mMatches.length) mList.append(el("li", { class: "none" }, `No matching ${DEFS[mode].noun}`));
  mMatches.forEach((o, i) => {
    const li = el("li", { role: "option", id: `mopt-${i}`, "aria-selected": String(i === mActive) },
      el("span", {}, highlight(o.label, q)), el("small", {}, o.small || ""));
    li.addEventListener("mousedown", (e) => {
      e.preventDefault();
      mChoose(i);
    });
    mList.append(li);
  });
  mList.hidden = false;
  mInput.setAttribute("aria-expanded", "true");
}
function mClose() {
  mList.hidden = true;
  mInput.setAttribute("aria-expanded", "false");
}
function mMove(delta) {
  if (!mMatches.length) return;
  mActive = (mActive + delta + mMatches.length) % mMatches.length;
  [...mList.children].forEach((li, i) => li.setAttribute("aria-selected", String(i === mActive)));
  mList.children[mActive]?.scrollIntoView({ block: "nearest" });
}
function mChoose(i) {
  const o = mMatches[i];
  if (!o) return;
  mInput.value = "";
  mClose();
  guessM(o.key);
}
mInput.addEventListener("input", mRender);
mInput.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown") { e.preventDefault(); mMove(1); }
  else if (e.key === "ArrowUp") { e.preventDefault(); mMove(-1); }
  else if (e.key === "Enter") { e.preventDefault(); if (mActive >= 0) mChoose(mActive); }
  else if (e.key === "Escape") mClose();
});
mInput.addEventListener("blur", () => setTimeout(mClose, 100));
mInput.addEventListener("focus", () => mInput.value && mRender());

/* ---------------- settings ---------------- */

const famousBox = $("#opt-famous");
$("#btn-settings").addEventListener("click", () => (famousBox.checked = settings.famousOnly !== false));
famousBox.addEventListener("change", () => {
  settings.famousOnly = famousBox.checked;
  saveSettings();
});
// If the current spell/potion is no longer allowed, swap it (no win or loss recorded).
$("#dlg-settings").addEventListener("close", () => {
  for (const m of ["spell", "potion"]) {
    const g = mgames[m];
    if (g && !g.over && !DEFS[m].items().some((i) => i.name === g.target)) {
      newMGame(m);
      if (m === mode) renderMode();
    }
  }
});

/* ---------------- boot ---------------- */

{
  const start = mode;
  mode = "classic";
  renderNav();
  switchMode(start);
  const want = new URLSearchParams(location.search).get("mode");
  if (want && MODE_IDS.includes(want)) switchMode(want);
}
