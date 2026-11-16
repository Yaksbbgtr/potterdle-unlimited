"use strict";

/* =========================================================
 * Potterdle Unlimited
 * Game engine adapted from Cosmeredle Unlimited (comparison ideas from the original CC0 Cosmeredle).
 * ========================================================= */

const SHY = "\u00ad";
const clean = (s) => s.replaceAll(SHY, "");

const BOOKS = [
  "Philosopher's Stone",
  "Chamber of Secrets",
  "Prisoner of Azkaban",
  "Goblet of Fire",
  "Order of the Phoenix",
  "Half-Blood Prince",
  "Deathly Hallows",
];
const bookTitle = (n) => BOOKS[n - 1] || `Book ${n}`;

function prepare(c, id, extra = {}) {
  return {
    ...c,
    ...extra,
    id,
    display: c.name.join(" "),
    plain: clean(c.name.join(" ")),
    series: bookTitle(c.book),
  };
}

const CHARACTERS = window.CHARACTERS.map((c, id) => prepare(c, id));

// The spoiler filter is by first book, listed in reading order.
const SERIES = BOOKS.filter((b) => CHARACTERS.some((c) => c.series === b));
function countIn(series) {
  return CHARACTERS.filter((c) => c.series === series).length;
}

/* ---------------- comparison ---------------- */

function fuzzyCompareArray(a, b) {
  a = a || [];
  b = b || [];
  if (!a.length && !b.length) return "Full";
  const big = a.length >= b.length ? a : b;
  const small = big === a ? b : a;
  let matching = 0;
  for (const v of big) if (small.includes(v)) matching++;
  return matching === 0 ? "None" : matching === big.length ? "Full" : "Partial";
}

// Titles like "Mr." or "Sr." don't count as a shared name.
const TITLES = new Set(["mr.", "mrs.", "madam", "monsieur", "sir", "professor", "sr.", "jr.", "aunt"]);
function compareName(a, b) {
  const norm = (n) => n.map((p) => p.replaceAll(/[()]/g, "")).filter((p) => !TITLES.has(p.toLowerCase()));
  return fuzzyCompareArray(norm(a), norm(b));
}

// Blood status: [species, status], e.g. ["Human", "Half-blood"] or ["House-elf"].
function compareBlood(a, b) {
  const speciesMatches = a[0] === b[0];
  const statusMatches = a[1] === b[1];
  if (speciesMatches && statusMatches) return "Full";
  if (speciesMatches || (statusMatches && a[1] !== undefined && a[1] !== "Unknown")) return "Partial";
  return "None";
}

function compare(guess, target) {
  return [
    compareName(guess.name, target.name),
    guess.house === target.house ? "Full" : "None",
    guess.book === target.book ? "Full" : "None",
    compareBlood(guess.blood, target.blood),
    fuzzyCompareArray(guess.affiliation, target.affiliation),
    fuzzyCompareArray(guess.family, target.family),
  ];
}

const formatBlood = (s) => (s.length > 1 ? `${s[0]} (${s.slice(1).join(" ")})` : s[0]);
const listOrDash = (a) => (a && a.length ? a.join(", ") : "—");
// Arrow on a missed book: ▲ means the answer appears later, ▼ earlier.
const bookArrow = (guess, target) => (guess.book === target.book ? "" : guess.book < target.book ? " ▲" : " ▼");

/* ---------------- storage ---------------- */

const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem("pu:" + key);
      return v === null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem("pu:" + key, JSON.stringify(value));
    } catch {}
  },
};

const settings = Object.assign(
  { series: SERIES.slice(), theme: "system", colorblind: false, reduceMotion: false, seenHelp: false },
  store.get("settings", {}),
);
// Drop any series that no longer exist; fall back to everything if empty.
settings.series = settings.series.filter((s) => SERIES.includes(s));
if (!settings.series.length) settings.series = SERIES.slice();

// Every finished round is one entry in `history`; stats are computed from it.
// A log (rather than counters) lets two devices merge their rounds without losing any.
let history = store.get("history", null);
let statsResetAt = store.get("statsResetAt", 0);
if (history === null) history = migrateOldStats(store.get("stats", null));

function migrateOldStats(old) {
  const out = [];
  if (!old || !old.played) return out;
  const wins = [];
  for (const [n, count] of Object.entries(old.dist || {})) for (let i = 0; i < count; i++) wins.push(Number(n));
  const losses = Math.max(0, old.played - wins.length);
  const streak = Math.min(old.streak || 0, wins.length);
  // Order: older wins, losses, then the current streak of wins at the end.
  const seq = [...wins.slice(streak).map((n) => [true, n]), ...Array(losses).fill([false, 0]), ...wins.slice(0, streak).map((n) => [true, n])];
  const base = Date.now() - seq.length * 1000;
  seq.forEach(([won, n], i) => out.push({ id: `m${base}-${i}`, t: base + i * 1000, won, n, who: "" }));
  return out;
}

const stats = { played: 0, wins: 0, streak: 0, best: 0, dist: {} };
function recomputeStats() {
  Object.assign(stats, { played: 0, wins: 0, streak: 0, best: 0, dist: {} });
  for (const h of history.slice().sort((a, b) => a.t - b.t)) {
    stats.played++;
    if (h.won) {
      stats.wins++;
      stats.streak++;
      stats.best = Math.max(stats.best, stats.streak);
      stats.dist[h.n] = (stats.dist[h.n] || 0) + 1;
    } else stats.streak = 0;
  }
}
recomputeStats();

let game = null; // in memory: { target: id, guesses: [id], over, won, t }

const saveSettings = () => {
  settings.t = Date.now();
  store.set("settings", settings);
  scheduleSync();
};
const saveHistory = () => {
  store.set("history", history);
  store.set("statsResetAt", statsResetAt);
  scheduleSync();
};
// Saved by character name so it survives custom-character lists changing order.
function gameToStored(g) {
  return g && { target: CHARACTERS[g.target].plain, guesses: g.guesses.map((id) => CHARACTERS[id].plain), over: g.over, won: g.won, t: g.t };
}
function gameFromStored(s) {
  if (!s) return null;
  const byName = (v) => (typeof v === "number" ? CHARACTERS[v] : CHARACTERS.find((c) => c.plain === v))?.id;
  const target = byName(s.target);
  if (target === undefined) return null;
  return { target, guesses: s.guesses.map(byName).filter((id) => id !== undefined), over: !!s.over, won: !!s.won, t: s.t || 0 };
}
const saveGame = () => {
  game.t = Date.now();
  store.set("game", gameToStored(game));
  scheduleSync();
};
const roundNumber = () => stats.played + (game && !game.over ? 1 : 0);

/* ---------------- dom ---------------- */

const $ = (sel) => document.querySelector(sel);
const input = $("#guess-input");
const list = $("#suggestions");
const rowsEl = $("#rows");

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "style") node.style.cssText = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) node.append(c);
  return node;
}

/* ---------------- game flow ---------------- */

function pool() {
  const allowed = new Set(settings.series);
  // Added characters from a series not in the list (e.g. a new book) are always allowed.
  return CHARACTERS.filter((c) => allowed.has(c.series) || (c.custom && !SERIES.includes(c.series)));
}

function newGame() {
  const candidates = pool();
  const recent = store.get("recent", []);
  let options = candidates.filter((c) => !recent.includes(c.id));
  if (!options.length) options = candidates;
  const target = options[Math.floor(Math.random() * options.length)];
  // Avoid repeats over the last ~third of the pool.
  const keep = Math.max(1, Math.floor(candidates.length / 3));
  store.set("recent", [target.id, ...recent].slice(0, keep));

  game = { target: target.id, guesses: [], over: false, won: false, t: 0 };
  saveGame();
  render(true);
  input.focus();
}

function makeGuess(id) {
  if (!game || game.over || game.guesses.includes(id)) return;
  game.guesses.unshift(id);
  const target = CHARACTERS[game.target];
  const result = compare(CHARACTERS[id], target);
  const won = result.every((r) => r === "Full");

  if (won) finish(true);
  saveGame();

  const row = buildRow(id, true);
  rowsEl.prepend(row);
  requestAnimationFrame(() => requestAnimationFrame(() => row.classList.add("revealed")));
  updateChrome();

  if (won) {
    row.classList.add("win");
    setTimeout(showEnd, settings.reduceMotion ? 50 : 1300);
  }
}

function giveUp() {
  if (!game || game.over) return;
  if (!confirm("Give up and reveal the character? This resets your streak.")) return;
  finish(false);
  saveGame();
  updateChrome();
  showEnd();
}

function finish(won) {
  game.over = true;
  game.won = won;
  const now = Date.now();
  history.push({
    id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    t: now,
    won,
    n: game.guesses.length,
    who: CHARACTERS[game.target].plain,
  });
  recomputeStats();
  saveHistory();
}

/* ---------------- rendering ---------------- */

function buildRow(id, animate) {
  const c = CHARACTERS[id];
  const res = compare(c, CHARACTERS[game.target]);
  const target = CHARACTERS[game.target];
  const values = [
    c.display,
    c.house || "—",
    [bookTitle(c.book), `Book ${c.book}${bookArrow(c, target)}`],
    formatBlood(c.blood),
    listOrDash(c.affiliation),
    listOrDash(c.family),
  ];
  const row = el("div", { class: "row" + (animate ? "" : " revealed") });
  values.forEach((v, i) => {
    const back = el("div", { class: `face back ${res[i]}` });
    if (Array.isArray(v)) {
      back.append(v[0]);
      if (v[1]) back.append(el("small", {}, v[1]));
    } else back.append(v);
    const inner = el(
      "div",
      { class: "cell-inner", style: animate ? `transition-delay:${i * 120}ms` : "" },
      el("div", { class: "face front" }),
      back,
    );
    row.append(el("div", { class: "cell" }, inner));
  });
  if (!animate && res.every((r) => r === "Full")) row.classList.add("win");
  return row;
}

function render() {
  rowsEl.replaceChildren(...game.guesses.map((id) => buildRow(id, false)));
  updateChrome();
}

function updateChrome() {
  $("#round-num").textContent = roundNumber();
  $("#guess-count").textContent = game.guesses.length;
  $("#streak").textContent = stats.streak;
  $("#empty").hidden = game.guesses.length > 0;
  input.disabled = game.over;
  input.placeholder = game.over ? "Round over. Start a new character →" : "Guess a Harry Potter character…";
  $("#btn-giveup").disabled = game.over;
  $("#btn-new").textContent = game.over ? "Next character" : "New character";
  document.body.classList.toggle("cb", settings.colorblind);
  if (settings.theme === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.dataset.theme = settings.theme;
  document.body.classList.toggle("reduce-motion", settings.reduceMotion);
}

function showEnd() {
  const t = CHARACTERS[game.target];
  const n = game.guesses.length;
  $("#end-kicker").textContent = game.won ? "You found them" : "The character was";
  $("#end-name").textContent = t.display;
  const facts = $("#end-facts");
  facts.replaceChildren();
  for (const [k, v] of [
    ["House", t.house || "—"],
    ["First book", `${t.book}. ${bookTitle(t.book)}`],
    ["Blood status", formatBlood(t.blood)],
    ["Affiliation", listOrDash(t.affiliation)],
    ["Family", listOrDash(t.family)],
  ]) facts.append(el("dt", {}, k), el("dd", {}, v));
  $("#end-line").textContent = game.won
    ? `Solved in ${n} ${n === 1 ? "guess" : "guesses"}. Streak: ${stats.streak}.`
    : `Gave up after ${n} ${n === 1 ? "guess" : "guesses"}.`;
  $("#dlg-end").showModal();
}

/* ---------------- autocomplete ---------------- */

let matches = [];
let active = -1;

function highlight(text, q) {
  const frag = document.createDocumentFragment();
  const plain = clean(text);
  const i = plain.toLowerCase().indexOf(q);
  if (!q || i < 0) {
    frag.append(plain);
    return frag;
  }
  frag.append(plain.slice(0, i), el("mark", {}, plain.slice(i, i + q.length)), plain.slice(i + q.length));
  return frag;
}

function search(q) {
  q = q.trim().toLowerCase();
  if (!q) return [];
  const guessed = new Set(game.guesses);
  const scored = [];
  for (const c of CHARACTERS) {
    if (guessed.has(c.id)) continue;
    const name = c.plain.toLowerCase();
    let score;
    if (name.startsWith(q)) score = 0;
    else if (name.split(/[\s()-]+/).some((w) => w.startsWith(q))) score = 1;
    else if (name.includes(q)) score = 2;
    else continue;
    scored.push([score, c]);
  }
  scored.sort((a, b) => a[0] - b[0] || a[1].plain.localeCompare(b[1].plain));
  return scored.slice(0, 10).map((s) => s[1]);
}

function renderSuggestions() {
  const q = input.value.trim().toLowerCase();
  matches = search(q);
  active = matches.length ? 0 : -1;
  list.replaceChildren();
  if (!q) {
    closeSuggestions();
    return;
  }
  if (!matches.length) {
    list.append(el("li", { class: "none" }, "No matching character"));
  } else {
    matches.forEach((c, i) => {
      const li = el(
        "li",
        { role: "option", id: `opt-${i}`, "aria-selected": String(i === active) },
        el("span", {}, highlight(c.display, q)),
        el("small", {}, c.house || ""),
      );
      li.addEventListener("mousedown", (e) => {
        e.preventDefault();
        choose(i);
      });
      list.append(li);
    });
  }
  list.hidden = false;
  input.setAttribute("aria-expanded", "true");
}

function moveActive(delta) {
  if (!matches.length) return;
  active = (active + delta + matches.length) % matches.length;
  [...list.children].forEach((li, i) => li.setAttribute("aria-selected", String(i === active)));
  list.children[active]?.scrollIntoView({ block: "nearest" });
}

function choose(i) {
  const c = matches[i];
  if (!c) return;
  input.value = "";
  closeSuggestions();
  makeGuess(c.id);
}

function closeSuggestions() {
  list.hidden = true;
  input.setAttribute("aria-expanded", "false");
}

input.addEventListener("input", renderSuggestions);
input.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown") { e.preventDefault(); moveActive(1); }
  else if (e.key === "ArrowUp") { e.preventDefault(); moveActive(-1); }
  else if (e.key === "Enter") { e.preventDefault(); if (active >= 0) choose(active); }
  else if (e.key === "Escape") closeSuggestions();
});
input.addEventListener("blur", () => setTimeout(closeSuggestions, 100));
input.addEventListener("focus", () => input.value && renderSuggestions());

/* ---------------- dialogs ---------------- */

function renderStats() {
  const pct = stats.played ? Math.round((stats.wins / stats.played) * 100) : 0;
  const totalGuesses = Object.entries(stats.dist).reduce((s, [k, v]) => s + k * v, 0);
  const avg = stats.wins ? (totalGuesses / stats.wins).toFixed(1) : "–";
  $("#stat-grid").replaceChildren(
    ...[[stats.played, "Played"], [pct + "%", "Won"], [stats.streak, "Streak"], [avg, "Avg"]].map(([v, l]) =>
      el("div", {}, el("b", {}, String(v)), el("span", {}, l)),
    ),
  );
  const dist = $("#dist");
  const keys = Object.keys(stats.dist).map(Number);
  if (!keys.length) {
    dist.replaceChildren(el("p", { class: "muted small" }, "Win a round to see your distribution."));
    return;
  }
  const max = Math.max(...Object.values(stats.dist));
  const hi = Math.max(...keys);
  const rows = [];
  // Bucket long games so the chart stays readable.
  const buckets = [];
  for (let i = 1; i <= Math.min(hi, 12); i++) buckets.push([String(i), stats.dist[i] || 0, i]);
  if (hi > 12) {
    const rest = keys.filter((k) => k > 12).reduce((s, k) => s + stats.dist[k], 0);
    buckets.push(["13+", rest, 13]);
  }
  const bMax = Math.max(max, ...buckets.map((b) => b[1]));
  const last = game && game.over && game.won ? Math.min(game.guesses.length, 13) : -1;
  for (const [label, count, key] of buckets) {
    rows.push(
      el("div", { class: "dist-row" + (key === last ? " hl" : "") },
        el("span", {}, label),
        el("div", { class: "bar", style: `--w:${Math.max(6, (count / bMax) * 100)}%` }, String(count)),
      ),
    );
  }
  dist.replaceChildren(...rows);
}

function renderSettings() {
  const box = $("#series-list");
  box.replaceChildren(
    ...SERIES.map((s) => {
      const cb = el("input", { type: "checkbox", value: s });
      cb.checked = settings.series.includes(s);
      cb.addEventListener("change", () => {
        const chosen = [...box.querySelectorAll("input:checked")].map((i) => i.value);
        if (!chosen.length) {
          cb.checked = true; // need at least one
          return;
        }
        settings.series = chosen;
        saveSettings();
      });
      return el("label", {}, cb, el("span", {}, s), el("span", { class: "count" }, String(countIn(s))));
    }),
  );
  $("#opt-theme").value = settings.theme;
  $("#opt-cb").checked = settings.colorblind;
  $("#opt-motion").checked = settings.reduceMotion;
}

$("#opt-theme").addEventListener("change", (e) => {
  settings.theme = e.target.value;
  saveSettings();
  updateChrome();
});
$("#opt-cb").addEventListener("change", (e) => {
  settings.colorblind = e.target.checked;
  saveSettings();
  updateChrome();
});
$("#opt-motion").addEventListener("change", (e) => {
  settings.reduceMotion = e.target.checked;
  saveSettings();
  updateChrome();
});
$("#btn-reset-stats").addEventListener("click", () => {
  if (!confirm("Reset all your stats?")) return;
  statsResetAt = Date.now();
  history = [];
  recomputeStats();
  saveHistory();
  updateChrome();
});

$("#btn-help").addEventListener("click", () => $("#dlg-help").showModal());
$("#btn-stats").addEventListener("click", () => {
  renderStats();
  $("#dlg-stats").showModal();
});
$("#btn-settings").addEventListener("click", () => {
  renderSettings();
  $("#dlg-settings").showModal();
});
$("#btn-giveup").addEventListener("click", giveUp);
$("#btn-new").addEventListener("click", () => {
  if (game && !game.over && game.guesses.length) {
    if (!confirm("Skip this character? It counts as a loss.")) return;
    finish(false);
  }
  newGame();
});
// If the series filter now excludes the current mystery character, swap it right away
// (no win or loss recorded) so the change takes effect immediately.
$("#dlg-settings").addEventListener("close", () => {
  if (game.over || pool().some((c) => c.id === game.target)) return;
  newGame();
});
$("#dlg-end").addEventListener("close", () => {
  if ($("#dlg-end").returnValue === "next") newGame();
});
for (const d of document.querySelectorAll("dialog")) {
  d.addEventListener("click", (e) => {
    if (e.target === d) d.close();
  });
}

/* ---------------- custom characters ----------------
 * The Add character button was removed; characters added earlier still load and sync.
 * New characters go in tools/characters.source.json (see tools/add_character.py). */

const BASE_COUNT = CHARACTERS.length;

const customKey = (c) => clean(c.name.join(" ")).toLowerCase();

function loadCustom() {
  CHARACTERS.length = BASE_COUNT;
  store.get("custom", []).forEach((c, i) => {
    CHARACTERS.push(prepare(c, BASE_COUNT + i, { custom: true }));
  });
}

/* ---------------- updates ----------------
 * Home-screen web apps on iPhone keep serving a cached copy of the page. Each release bumps
 * the ?v= stamp on the script tags, so we compare ours with the live page's and offer a reload
 * with a fresh URL, which skips the cache. */

const APP_VERSION = (document.querySelector('script[src*="app.js"]')?.src.match(/[?&]v=(\w+)/) || [])[1] || "dev";

async function latestVersion() {
  const res = await fetch(`./?check=${Date.now()}`, { cache: "no-store" });
  const text = await res.text();
  return (text.match(/app\.js\?v=(\w+)/) || [])[1] || null;
}

function reloadFresh() {
  const u = new URL(location.href);
  u.search = `?u=${Date.now()}`;
  u.hash = "";
  location.replace(u.toString());
}

let lastUpdateCheck = 0;
async function checkForUpdate(manual = false) {
  const msg = $("#update-msg");
  if (!manual && Date.now() - lastUpdateCheck < 60_000) return;
  lastUpdateCheck = Date.now();
  if (manual) {
    msg.className = "small muted";
    msg.textContent = "Checking…";
  }
  try {
    const latest = await latestVersion();
    if (latest && latest !== APP_VERSION) {
      $("#update-bar").hidden = false;
      if (manual) {
        msg.className = "small status-ok";
        msg.textContent = "A new version is ready. Updating…";
        setTimeout(reloadFresh, 400);
      }
    } else if (manual) {
      msg.className = "small status-ok";
      msg.textContent = "You're on the latest version.";
    }
  } catch {
    if (manual) {
      msg.className = "small status-warn";
      msg.textContent = "Couldn't check. Are you online?";
    }
  }
}

function initUpdates() {
  $("#app-version").textContent = APP_VERSION;
  $("#btn-check-update").addEventListener("click", () => checkForUpdate(true));
  $("#btn-update").addEventListener("click", reloadFresh);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") checkForUpdate();
  });
  checkForUpdate();
}

/* ---------------- cloud sync (private GitHub Gist) ---------------- */

const SYNC_FILE = "potterdle-sync.json";
const sync = {
  token: store.get("syncToken", null),
  gist: store.get("syncGist", null),
  last: store.get("syncLast", 0),
  busy: false,
  again: false,
  timer: null,
  error: null,
  applying: false,
};

function scheduleSync() {
  if (!sync.token || sync.applying) return;
  clearTimeout(sync.timer);
  sync.timer = setTimeout(syncNow, 1500);
}

async function gh(path, opts = {}) {
  const res = await fetch("https://api.github.com" + path, {
    ...opts,
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${sync.token}`,
      Accept: "application/vnd.github+json",
      ...(opts.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  if (res.status === 401) throw new Error("GitHub didn't accept the token. It may have expired.");
  if (res.status === 403 || res.status === 404) throw new Error("The token can't access gists. Make sure the “gist” box was ticked.");
  if (!res.ok) throw new Error(`GitHub error ${res.status}.`);
  return res.json();
}

function snapshot() {
  return {
    v: 1,
    statsResetAt,
    history,
    custom: store.get("custom", []),
    customRemoved: store.get("customRemoved", {}),
    settings: { ...settings, seenHelp: true },
    game: gameToStored(game),
  };
}

async function findOrCreateGist() {
  for (let page = 1; page <= 10; page++) {
    const list = await gh(`/gists?per_page=100&page=${page}`);
    const hit = list.find((g) => g.files && g.files[SYNC_FILE]);
    if (hit) return hit.id;
    if (list.length < 100) break;
  }
  const created = await gh("/gists", {
    method: "POST",
    body: JSON.stringify({
      description: "Potterdle Unlimited sync data",
      public: false,
      files: { [SYNC_FILE]: { content: JSON.stringify(snapshot()) } },
    }),
  });
  return created.id;
}

async function readRemote() {
  const g = await gh(`/gists/${sync.gist}`);
  const f = g.files[SYNC_FILE];
  if (!f) return null;
  const text = f.truncated ? await (await fetch(f.raw_url, { cache: "no-store" })).text() : f.content;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function mergeRemote(r) {
  if (!r || r.v !== 1) return;
  sync.applying = true;
  try {
    // Rounds: union of both logs, minus anything before the latest "reset stats".
    statsResetAt = Math.max(statsResetAt, r.statsResetAt || 0);
    const byId = new Map();
    for (const h of [...(r.history || []), ...history]) byId.set(h.id, h);
    history = [...byId.values()].filter((h) => h.t > statsResetAt).sort((a, b) => a.t - b.t);
    store.set("history", history);
    store.set("statsResetAt", statsResetAt);
    recomputeStats();

    // Added characters: union, honoring removals made after a character was added.
    const tomb = { ...(r.customRemoved || {}) };
    for (const [k, t] of Object.entries(store.get("customRemoved", {}))) tomb[k] = Math.max(tomb[k] || 0, t);
    const merged = new Map();
    for (const c of [...store.get("custom", []), ...(r.custom || [])]) {
      const k = customKey(c);
      if (!merged.has(k) || (c.added || 0) < (merged.get(k).added || 0)) merged.set(k, c);
    }
    const custom = [...merged.values()]
      .filter((c) => !(tomb[customKey(c)] >= (c.added || 0)))
      .sort((a, b) => (a.added || 0) - (b.added || 0));
    store.set("customRemoved", tomb);
    store.set("custom", custom);
    const keepGame = gameToStored(game);
    loadCustom();

    // Settings and the round in progress: most recent change wins.
    if (r.settings && (r.settings.t || 0) > (settings.t || 0)) {
      Object.assign(settings, r.settings, { seenHelp: true });
      settings.series = settings.series.filter((s) => SERIES.includes(s));
      if (!settings.series.length) settings.series = SERIES.slice();
      store.set("settings", settings);
    }
    const remoteGame = r.game && (r.game.t || 0) > (keepGame?.t || 0) ? gameFromStored(r.game) : null;
    game = remoteGame ?? gameFromStored(keepGame) ?? game;
    store.set("game", gameToStored(game));
    if (!document.querySelector("dialog[open]")) render();
    else updateChrome();
  } finally {
    sync.applying = false;
  }
}

async function syncNow() {
  if (!sync.token) return;
  if (sync.busy) {
    sync.again = true;
    return;
  }
  sync.busy = true;
  sync.error = null;
  renderSyncStatus();
  try {
    if (!sync.gist) {
      sync.gist = await findOrCreateGist();
      store.set("syncGist", sync.gist);
    }
    const remote = await readRemote();
    mergeRemote(remote);
    const mine = snapshot();
    if (JSON.stringify(mine) !== JSON.stringify(remote)) {
      await gh(`/gists/${sync.gist}`, {
        method: "PATCH",
        body: JSON.stringify({ files: { [SYNC_FILE]: { content: JSON.stringify(mine) } } }),
      });
    }
    sync.last = Date.now();
    store.set("syncLast", sync.last);
  } catch (e) {
    sync.error = e.message || "Sync failed.";
  } finally {
    sync.busy = false;
    renderSyncStatus();
    if (sync.again) {
      sync.again = false;
      syncNow();
    }
  }
}

function ago(t) {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString();
}

function renderSyncStatus() {
  const on = !!sync.token;
  $("#sync-off").hidden = on;
  $("#sync-on").hidden = !on;
  $("#sync-dot").hidden = !on;
  $("#sync-dot").className = "sync-dot " + (sync.error ? "err" : sync.busy ? "busy" : "ok");
  $("#sync-dot").title = sync.error ? `Sync problem: ${sync.error}` : sync.busy ? "Syncing…" : "Synced";
  if (!on) return;
  const s = $("#sync-status");
  if (sync.busy) s.textContent = "Syncing…";
  else if (sync.error) s.textContent = sync.error;
  else s.textContent = sync.last ? `Synced ${ago(sync.last)}` : "Connected";
  s.className = "small " + (sync.error ? "status-warn" : "status-ok");
}

async function connectSync() {
  const token = $("#sync-token").value.trim();
  if (!token) return;
  const btn = $("#btn-sync-connect");
  btn.disabled = true;
  $("#sync-msg").textContent = "Connecting…";
  sync.token = token;
  sync.gist = null;
  try {
    sync.gist = await findOrCreateGist();
    store.set("syncToken", token);
    store.set("syncGist", sync.gist);
    $("#sync-token").value = "";
    $("#sync-msg").textContent = "";
    await syncNow();
  } catch (e) {
    sync.token = null;
    $("#sync-msg").textContent = e.message;
  } finally {
    btn.disabled = false;
    renderSyncStatus();
  }
}

function initSync() {
  $("#btn-sync-connect").addEventListener("click", connectSync);
  $("#sync-token").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); connectSync(); }
  });
  $("#btn-sync-now").addEventListener("click", syncNow);
  $("#btn-sync-off").addEventListener("click", () => {
    if (!confirm("Stop syncing on this device? Your data stays here and in the cloud.")) return;
    sync.token = sync.gist = null;
    store.set("syncToken", null);
    store.set("syncGist", null);
    renderSyncStatus();
  });
  $("#sync-dot").addEventListener("click", () => $("#btn-settings").click());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") syncNow();
  });
  setInterval(() => {
    if (document.visibilityState === "visible") syncNow();
  }, 60_000);
  renderSyncStatus();
  syncNow();
}

/* ---------------- boot ---------------- */

loadCustom();
game = gameFromStored(store.get("game", null));

if (!game) {
  newGame();
} else {
  render();
}
initSync();
initUpdates();
if (!settings.seenHelp) {
  settings.seenHelp = true;
  saveSettings();
  $("#dlg-help").showModal();
}
