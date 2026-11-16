"use strict";
/* Animated background (drawn on a canvas behind the page) and the win burst.
 * Turned off by "Reduce animations" in Settings or the device's reduced-motion setting. */
(() => {
  const CFG = {"stars": {"count": 130, "colors": ["#fff6dc", "#dfe4ff"]}, "candles": {"count": 12}, "motes": {"count": 26, "colors": ["#ffd98a", "#fff2c4"], "dir": 1, "speed": [4, 12], "size": [0.8, 2]}, "shooting": {"every": [7, 15]}, "burst": ["#ffd65a", "#fff2b0", "#ff8a3a", "#ff5a3a"]};
  const cv = document.createElement("canvas");
  cv.id = "fx";
  cv.setAttribute("aria-hidden", "true");
  document.body.prepend(cv);
  const ctx = cv.getContext("2d");
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  let W = 0, H = 0, DPR = 1;

  // Soft glowing dot sprites, one per color, so drawing many is cheap.
  const sprites = new Map();
  function sprite(color) {
    if (sprites.has(color)) return sprites.get(color);
    const s = document.createElement("canvas");
    s.width = s.height = 64;
    const g = s.getContext("2d");
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, "#ffffff");
    grad.addColorStop(0.18, color);
    grad.addColorStop(0.45, color + "55");
    grad.addColorStop(1, color + "00");
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    sprites.set(color, s);
    return s;
  }
  const dot = (color, x, y, r, a) => {
    ctx.globalAlpha = a;
    ctx.drawImage(sprite(color), x - r, y - r, r * 2, r * 2);
  };

  let stars = [], motes = [], candles = [], blobs = [], sparks = [], streak = null, flash = 0;
  let nextStreak = 0, nextFlash = 0;

  function seed() {
    const area = (W * H) / (1280 * 800);
    const n = (c) => Math.round(c * Math.min(1.4, Math.max(0.45, area)));
    stars = CFG.stars ? Array.from({ length: n(CFG.stars.count) }, () => ({
      x: Math.random() * W, y: Math.random() * H, r: rnd(0.6, 1.8), c: pick(CFG.stars.colors),
      p: Math.random() * 6.3, s: rnd(0.4, 1.6), a: rnd(0.25, 0.9),
    })) : [];
    motes = CFG.motes ? Array.from({ length: n(CFG.motes.count) }, () => newMote(true)) : [];
    const nc = CFG.candles ? n(CFG.candles.count) : 0;
    candles = Array.from({ length: nc }, (_, i) => {
      const z = rnd(0.45, 1);
      return { x: ((i + rnd(0.15, 0.85)) / nc) * W, y: rnd(0.06, 0.55) * H, z, p: Math.random() * 6.3, s: rnd(0.25, 0.5) };
    });
    blobs = CFG.nebula ? CFG.nebula.colors.map((c) => ({
      c, x: Math.random() * W, y: Math.random() * H, r: rnd(0.35, 0.6) * Math.max(W, H), vx: rnd(-6, 6), vy: rnd(-4, 4),
    })) : [];
  }
  function newMote(anywhere) {
    const m = CFG.motes;
    return {
      x: Math.random() * W,
      y: anywhere ? Math.random() * H : m.dir < 0 ? H + 10 : -10,
      r: rnd(m.size[0], m.size[1]), c: pick(m.colors), v: rnd(m.speed[0], m.speed[1]),
      p: Math.random() * 6.3, sw: rnd(6, 22), a: rnd(0.35, 0.9),
    };
  }

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    cv.width = W * DPR;
    cv.height = H * DPR;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    seed();
  }

  function drawCandle(c, t) {
    const bob = Math.sin(t * c.s + c.p) * 7 * c.z;
    const x = c.x, y = c.y + bob, w = 5 * c.z, h = 22 * c.z;
    const flick = 1 + Math.sin(t * 9 + c.p * 3) * 0.08 + Math.sin(t * 23 + c.p) * 0.05;
    dot("#ffb347", x, y - h / 2 - 4 * c.z, 34 * c.z * flick, 0.22 * c.z);
    ctx.globalAlpha = 0.75 * c.z;
    ctx.fillStyle = "#efe6cf";
    ctx.fillRect(x - w / 2, y - h / 2, w, h);
    dot("#ffd27a", x, y - h / 2 - 5 * c.z, 7 * c.z * flick, 0.95);
  }

  let last = 0, t = 0;
  function frame(now) {
    const dt = Math.min(0.05, (now - (last || now)) / 1000);
    last = now;
    t += dt;
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = "lighter";

    for (const b of blobs) {
      b.x += b.vx * dt; b.y += b.vy * dt;
      if (b.x < -b.r * 0.3 || b.x > W + b.r * 0.3) b.vx *= -1;
      if (b.y < -b.r * 0.3 || b.y > H + b.r * 0.3) b.vy *= -1;
      dot(b.c, b.x, b.y, b.r, 0.16);
    }
    const drift = CFG.stars?.drift || 0;
    for (const s of stars) {
      if (drift) { s.x -= drift * dt * s.r; if (s.x < -4) s.x = W + 4; }
      dot(s.c, s.x, s.y, s.r * 3, s.a * (0.55 + 0.45 * Math.sin(t * s.s + s.p)));
    }
    for (const c of candles) drawCandle(c, t);
    if (CFG.motes) {
      const dir = CFG.motes.dir;
      for (let i = 0; i < motes.length; i++) {
        const m = motes[i];
        m.y += dir * m.v * dt;
        const x = m.x + Math.sin(t * 0.6 + m.p) * m.sw;
        dot(m.c, x, m.y, m.r * 4, m.a * (0.6 + 0.4 * Math.sin(t * 2 + m.p)));
        if (m.y < -20 || m.y > H + 20) motes[i] = newMote(false);
      }
    }
    if (CFG.shooting) {
      if (!nextStreak) nextStreak = t + rnd(2, 5);
      if (!streak && t > nextStreak) {
        streak = { x: rnd(0.1, 0.9) * W, y: rnd(0.02, 0.35) * H, vx: rnd(-1, 1) > 0 ? 620 : -620, vy: 260, life: 0 };
        nextStreak = t + rnd(...CFG.shooting.every);
      }
      if (streak) {
        streak.life += dt;
        streak.x += streak.vx * dt; streak.y += streak.vy * dt;
        const a = Math.max(0, 1 - streak.life / 0.9);
        const g = ctx.createLinearGradient(streak.x, streak.y, streak.x - streak.vx * 0.18, streak.y - streak.vy * 0.18);
        g.addColorStop(0, `rgba(255,255,255,${a})`);
        g.addColorStop(1, "rgba(255,255,255,0)");
        ctx.globalAlpha = 1;
        ctx.strokeStyle = g; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(streak.x, streak.y);
        ctx.lineTo(streak.x - streak.vx * 0.18, streak.y - streak.vy * 0.18); ctx.stroke();
        if (a <= 0) streak = null;
      }
    }
    if (CFG.flash) {
      if (!nextFlash) nextFlash = t + rnd(4, 9);
      if (t > nextFlash) { flash = 1; nextFlash = t + rnd(...CFG.flash.every); }
      if (flash > 0) {
        const f = flash > 0.7 ? 1 : flash; // a quick double flicker, then fade
        ctx.globalAlpha = 0.13 * f * (flash > 0.55 && flash < 0.7 ? 0.3 : 1);
        ctx.fillStyle = CFG.flash.color;
        ctx.fillRect(0, 0, W, H);
        flash -= dt * 1.4;
      }
    }
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      s.life -= dt;
      if (s.life <= 0) { sparks.splice(i, 1); continue; }
      s.vy += 220 * dt; s.vx *= 0.985; s.vy *= 0.985;
      s.x += s.vx * dt; s.y += s.vy * dt;
      dot(s.c, s.x, s.y, s.r * 4, Math.min(1, s.life / 0.6));
    }
    ctx.globalAlpha = 1;
    if (running) raf = requestAnimationFrame(frame);
  }

  let running = false, raf = 0, paused = false;
  const reduced = () => paused || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  function start() {
    if (running || reduced() || document.hidden) return;
    running = true; last = 0;
    raf = requestAnimationFrame(frame);
  }
  function stop() { running = false; cancelAnimationFrame(raf); }
  function still() { // one quiet frame for reduced motion
    stop();
    const keep = { motes, sparks }; motes = []; sparks = [];
    frame(performance.now()); stop();
    ({ motes, sparks } = keep);
  }

  window.addEventListener("resize", () => { resize(); if (!running) still(); });
  document.addEventListener("visibilitychange", () => (document.hidden ? stop() : start()));

  window.fx = {
    setPaused(p) { paused = !!p; if (reduced()) still(); else start(); },
    burst() {
      if (reduced()) return;
      const cx = W / 2, cy = Math.min(H * 0.45, 360);
      for (let i = 0; i < 140; i++) {
        const a = Math.random() * Math.PI * 2, v = rnd(120, 520);
        sparks.push({ x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 120, r: rnd(1, 2.6), c: pick(CFG.burst), life: rnd(0.9, 1.9) });
      }
      start();
    },
  };
  resize();
  start();
  if (reduced()) still();
})();
