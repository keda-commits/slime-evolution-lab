// =============================================================
//  描画（Canvas 2D）。シミュレーションのイベントから演出を生成する。
// =============================================================
import { CONFIG } from './config.js';

const TAU = Math.PI * 2;
const rnd = Math.random;

function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function rgba(h, a) { const [r, g, b] = hexToRgb(h); return `rgba(${r},${g},${b},${a})`; }
function shade(h, k) { const [r, g, b] = hexToRgb(h); const f = (v) => Math.max(0, Math.min(255, Math.round(k > 0 ? v + (255 - v) * k : v * (1 + k)))).toString(16).padStart(2, '0'); return `#${f(r)}${f(g)}${f(b)}`; }

export class Renderer {
  constructor(canvas, world, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.world = world;
    this.particles = [];
    this.texts = [];
    this.rings = [];
    this.ghosts = [];
    this.links = [];
    this.chainLast = new Map();
    this.shake = 0;
    this.slimeFx = new Map();
    this.cam = { x: world.W / 2, y: world.H / 2, zoom: 1 };
    this.rect = opts.rect || null;   // 比較ラボ用の描画領域
    this.showLinks = opts.showLinks ?? true;
    this.showLabels = opts.showLabels ?? true;
    this.compact = opts.compact || false;
    this.selected = null;
    this.onNotable = opts.onNotable || null;
    this.bg = null;
    this.t = 0;
  }

  setWorld(w) { this.world = w; this.particles = []; this.texts = []; this.rings = []; this.ghosts = []; this.links = []; this.bg = null; this.slimeFx.clear(); }

  // ---------------- 座標 ----------------
  view() {
    const c = this.canvas;
    const r = this.rect || { x: 0, y: 0, w: c.width, h: c.height };
    const base = Math.min(r.w / this.world.W, r.h / this.world.H);
    const s = base * this.cam.zoom;
    return { r, s, ox: r.x + r.w / 2 - this.cam.x * s, oy: r.y + r.h / 2 - this.cam.y * s, base };
  }
  toWorld(px, py) { const v = this.view(); return { x: (px - v.ox) / v.s, y: (py - v.oy) / v.s }; }
  clampCam() {
    const v = this.view();
    const hw = v.r.w / 2 / v.s, hh = v.r.h / 2 / v.s;
    const W = this.world.W, H = this.world.H;
    this.cam.x = hw * 2 >= W ? W / 2 : Math.max(hw, Math.min(W - hw, this.cam.x));
    this.cam.y = hh * 2 >= H ? H / 2 : Math.max(hh, Math.min(H - hh, this.cam.y));
  }
  pickSlime(px, py, radius = 22) {
    const p = this.toWorld(px, py), v = this.view();
    let best = null, bd = (radius / v.s) ** 2;
    for (const s of this.world.slimes) {
      const d = (s.x - p.x) ** 2 + (s.y - p.y) ** 2 - s.r * s.r;
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  // ---------------- イベント → 演出 ----------------
  consumeEvents() {
    const ev = this.world.events;
    if (!ev.length) return;
    const W = this.world;
    for (const e of ev) {
      const L = W.lineages.get(e.lin);
      const col = L ? L.color : '#fff';
      switch (e.type) {
        case 'kill': {
          const big = e.prey === 'beast';
          if (e.engulf) this.ghosts.push({ x: e.x, y: e.y, r: e.r, prey: e.prey, sid: e.sid, t: 0, life: big ? 0.9 : 0.45 });
          else this.burstParticles(e.x, e.y, CONFIG.prey[e.prey].color, e.prey === 'mite' ? 3 : 6, 60);
          // 栄養の吸収
          if (e.sid && !e.engulf && e.cause !== 'explosion') { /* contact: no flyer */ }
          else if (e.sid && e.cause === 'explosion') this.particles.push({ kind: 'absorb', x: e.x, y: e.y, sid: e.sid, t: 0, life: 0.7, col: '#ffe08a' });
          if (e.mana >= 5 && !this.compact) this.texts.push({ x: e.x, y: e.y - 6, txt: '+' + Math.round(e.mana), col: big ? '#ffd166' : '#d6f5a3', t: 0, life: big ? 1.6 : 0.8, size: big ? 18 : 11, vy: -26 });
          if (big) { this.shake = Math.max(this.shake, 6); this.rings.push({ x: e.x, y: e.y, r0: 10, r1: 70, t: 0, life: 0.6, col: '#ffd166', w: 4 }); if (this.onNotable) this.onNotable(`${L ? L.name : ''}が角獣を捕食！`); }
          break;
        }
        case 'explode': {
          const r = e.r;
          this.rings.push({ x: e.x, y: e.y, r0: 4, r1: r, t: 0, life: 0.35, col: '#ffcf4a', w: 3, fill: true });
          for (let i = 0; i < 7; i++) { const a = rnd() * TAU, sp = 80 + rnd() * 160; this.particles.push({ kind: 'spark', x: e.x, y: e.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, t: 0, life: 0.35 + rnd() * 0.25, col: rnd() < 0.5 ? '#ffd23f' : '#ff6a2a', size: 2 + rnd() * 2 }); }
          const last = this.chainLast.get(e.chainId);
          if (last) this.links.push({ x1: last.x, y1: last.y, x2: e.x, y2: e.y, t: 0, life: 0.45, col: '#fff3b0' });
          this.chainLast.set(e.chainId, { x: e.x, y: e.y, n: e.chain });
          if (e.chain >= 3 && !this.compact) this.texts.push({ x: e.x, y: e.y - 10, txt: '×' + e.chain, col: '#ffe066', t: 0, life: 0.6, size: 10 + Math.min(e.chain, 30) * 0.5, vy: -40 });
          this.shake = Math.max(this.shake, Math.min(10, 1 + e.chain * 0.25));
          break;
        }
        case 'chainEnd': {
          let pos = null;
          for (const [k, v] of this.chainLast) if (v.n === e.n) pos = v;
          if (pos) this.texts.push({ x: pos.x, y: pos.y - 20, txt: `CHAIN ×${e.n}!`, col: e.n >= 20 ? '#ff4d6d' : '#ffd166', t: 0, life: 1.6, size: 18 + Math.min(e.n, 40) * 0.6, vy: -20, bold: true });
          if (e.n >= 15 && this.onNotable) this.onNotable(`${L ? L.name : ''} 連鎖爆発 ×${e.n}！`);
          if (this.chainLast.size > 50) this.chainLast.clear();
          break;
        }
        case 'split':
          this.rings.push({ x: e.x, y: e.y, r0: 4, r1: 24, t: 0, life: 0.4, col, w: 2 });
          this.burstParticles(e.x, e.y, '#ff9f68', 5, 50);
          break;
        case 'merge':
          this.particles.push({ kind: 'absorb', x: e.x, y: e.y, tx: e.tx, ty: e.ty, t: 0, life: 0.6, col });
          break;
        case 'evolve': {
          this.rings.push({ x: e.x, y: e.y, r0: 6, r1: 90, t: 0, life: 0.9, col: '#ffffff', w: 4 });
          this.rings.push({ x: e.x, y: e.y, r0: 6, r1: 60, t: -0.15, life: 0.9, col, w: 3 });
          this.particles.push({ kind: 'pillar', x: e.x, y: e.y, t: 0, life: 1.0, col });
          for (let i = 0; i < 14; i++) { const a = rnd() * TAU, sp = 40 + rnd() * 120; this.particles.push({ kind: 'spark', x: e.x, y: e.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60, t: 0, life: 0.8 + rnd() * 0.4, col: '#fff7c2', size: 2.5 }); }
          this.shake = Math.max(this.shake, 5);
          break;
        }
        case 'levelup':
          for (let i = 0; i < 10; i++) this.particles.push({ kind: 'spark', x: e.x + (rnd() - 0.5) * 20, y: e.y, vx: 0, vy: -60 - rnd() * 60, t: 0, life: 0.9, col: '#9bf6ff', size: 2 });
          this.texts.push({ x: e.x, y: e.y - 20, txt: 'Lv UP', col: '#9bf6ff', t: 0, life: 1.1, size: 13, vy: -30, bold: true });
          break;
        case 'death':
          this.burstParticles(e.x, e.y, '#888', 8, 70);
          if (e.why === 'starve' && !this.compact) this.texts.push({ x: e.x, y: e.y - 8, txt: '餓死', col: '#bbb', t: 0, life: 0.8, size: 10, vy: -20 });
          break;
        case 'hurt': {
          const fx = this.fxFor(e.sid);
          this.texts.push({ x: e.x + (rnd() - 0.5) * 10, y: e.y - 14, txt: '-' + Math.round(e.amt), col: '#ff6b6b', t: 0, life: 0.6, size: 11, vy: -30 });
          break;
        }
        case 'steam':
          for (let i = 0; i < 10; i++) { const a = rnd() * TAU, d = rnd() * e.r * 0.8; this.particles.push({ kind: 'puff', x: e.x + Math.cos(a) * d, y: e.y + Math.sin(a) * d, vx: Math.cos(a) * 15, vy: Math.sin(a) * 15 - 8, t: 0, life: 2.2 + rnd(), col: '#e9f1f7', size: 14 + rnd() * 16 }); }
          break;
        case 'infect':
          this.links.push({ x1: e.x, y1: e.y, x2: e.tx, y2: e.ty, t: 0, life: 0.5, col: '#9be15d' });
          break;
        case 'spawnInfector':
          this.rings.push({ x: e.x, y: e.y, r0: 3, r1: 14, t: 0, life: 0.3, col: '#ff4d6d', w: 1.5 });
          break;
        case 'respawn':
          this.rings.push({ x: e.x, y: e.y, r0: 40, r1: 4, t: 0, life: 0.6, col, w: 3 });
          break;
      }
    }
    ev.length = 0;
  }
  fxFor(id) { let f = this.slimeFx.get(id); if (!f) { f = { spin: 0, hurt: 0, emitT: 0 }; this.slimeFx.set(id, f); } return f; }
  burstParticles(x, y, col, n, sp) {
    for (let i = 0; i < n; i++) { const a = rnd() * TAU, v = sp * (0.4 + rnd()); this.particles.push({ kind: 'dot', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0, life: 0.35 + rnd() * 0.3, col, size: 1.5 + rnd() * 1.5 }); }
  }

  // ---------------- 描画 ----------------
  makeBg() {
    const W = this.world.W, H = this.world.H;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(W / 2, H / 2, 100, W / 2, H / 2, W * 0.7);
    grd.addColorStop(0, '#2f4a2b'); grd.addColorStop(1, '#1b2a1c');
    g.fillStyle = grd; g.fillRect(0, 0, W, H);
    let seed = 7; const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 70; i++) { g.fillStyle = `rgba(${20 + r() * 30},${50 + r() * 40},${20 + r() * 20},0.25)`; g.beginPath(); g.ellipse(r() * W, r() * H, 30 + r() * 90, 20 + r() * 60, r() * 3, 0, TAU); g.fill(); }
    g.strokeStyle = 'rgba(120,170,90,0.25)'; g.lineWidth = 1.2;
    for (let i = 0; i < 900; i++) { const x = r() * W, y = r() * H; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 4, y - 4 - r() * 5); g.stroke(); }
    for (const n of this.world.nests) {
      const ng = g.createRadialGradient(n.x, n.y, 4, n.x, n.y, 52);
      ng.addColorStop(0, 'rgba(90,60,40,0.75)'); ng.addColorStop(1, 'rgba(90,60,40,0)');
      g.fillStyle = ng; g.beginPath(); g.arc(n.x, n.y, 52, 0, TAU); g.fill();
      g.fillStyle = 'rgba(40,25,20,0.8)'; g.beginPath(); g.arc(n.x, n.y, 5, 0, TAU); g.fill();
    }
    g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 6; g.strokeRect(0, 0, W, H);
    this.bg = c;
  }

  draw(dtReal) {
    const ctx = this.ctx, W = this.world;
    this.t += dtReal;
    if (this.follow) {
      const mine = W.slimes.filter(s => s.lin === this.follow && s.kind !== 'infector');
      if (mine.length) {
        const cx = mine.reduce((a, s) => a + s.x, 0) / mine.length, cy = mine.reduce((a, s) => a + s.y, 0) / mine.length;
        const k = Math.min(1, 3 * Math.max(dtReal, 0.016));
        this.cam.x += (cx - this.cam.x) * k; this.cam.y += (cy - this.cam.y) * k;
        // 群れは全員が収まるズームに
        let span = 0;
        for (const s of mine) span = Math.max(span, Math.abs(s.x - cx) * 0.62, Math.abs(s.y - cy));
        const v0 = this.view();
        const fit = Math.max(1, Math.min(2.4, (v0.r.h / 2 - 40) / Math.max(1, span + 60) / v0.base));
        this.cam.zoom += (fit - this.cam.zoom) * Math.min(1, dtReal * 1.5);
        this.clampCam();
      }
    }
    this.consumeEvents();
    if (!this.bg) this.makeBg();
    const v = this.view();
    ctx.save();
    if (this.rect) { ctx.beginPath(); ctx.rect(v.r.x, v.r.y, v.r.w, v.r.h); ctx.clip(); }
    ctx.fillStyle = '#0d140e'; ctx.fillRect(v.r.x, v.r.y, v.r.w, v.r.h);
    let sx = 0, sy = 0;
    if (this.shake > 0.1) { sx = (rnd() - 0.5) * this.shake; sy = (rnd() - 0.5) * this.shake; this.shake *= Math.pow(0.02, dtReal); }
    ctx.translate(v.ox + sx, v.oy + sy); ctx.scale(v.s, v.s);
    ctx.drawImage(this.bg, 0, 0);
    const pxs = 1 / v.s; // 1スクリーンpxのワールド長

    // 危険地帯（炎の轍・溶岩・蒸気）
    ctx.save();
    for (const h of W.hazards) {
      const a = h.t / h.life;
      if (h.kind === 'steam') continue;
      if (h.kind === 'lava') {
        ctx.fillStyle = `rgba(255,${90 + 60 * a},20,${0.35 * a + 0.1})`;
        ctx.beginPath(); ctx.arc(h.x, h.y, h.r * (0.8 + 0.2 * a), 0, TAU); ctx.fill();
        ctx.fillStyle = `rgba(60,15,5,${0.3 * a})`; ctx.beginPath(); ctx.arc(h.x, h.y, h.r * 0.5, 0, TAU); ctx.fill();
      }
    }
    ctx.globalCompositeOperation = 'lighter';
    for (const h of W.hazards) {
      if (h.kind !== 'fire') continue;
      const a = h.t / h.life;
      ctx.fillStyle = `rgba(255,${100 + 100 * a},30,${0.32 * a})`;
      ctx.beginPath(); ctx.arc(h.x, h.y, h.r * (0.5 + 0.5 * a), 0, TAU); ctx.fill();
    }
    ctx.restore();

    // 標的ライン（誰が何を狙っているか）
    if (this.showLinks) {
      ctx.lineWidth = 1.2 * pxs;
      for (const s of W.slimes) {
        if (!s.target || !s.target.alive || s.kind === 'infector') continue;
        const L = W.lineages.get(s.lin); if (!L) continue;
        const sel = this.selected === s.lin;
        ctx.strokeStyle = rgba(L.color, sel ? 0.55 : 0.22);
        ctx.setLineDash([4 * pxs, 4 * pxs]);
        ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.target.x, s.target.y); ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    // 獲物
    for (const p of W.prey) this.drawPrey(ctx, p);

    // 飲み込まれる獲物
    for (const g of this.ghosts) {
      g.t += dtReal;
      const s = W.slimes.find(o => o.id === g.sid);
      const k = Math.min(1, g.t / g.life);
      if (s) { g.x += (s.x - g.x) * Math.min(1, dtReal * 6); g.y += (s.y - g.y) * Math.min(1, dtReal * 6); }
      ctx.globalAlpha = 1 - k;
      this.drawPrey(ctx, { type: g.prey, x: g.x, y: g.y, r: g.r * (1 - k * 0.8), heading: 0, hp: 1, maxHp: 1, alive: true, vx: 0, vy: 0, id: 0, hitT: 0, slowT: 0 });
      ctx.globalAlpha = 1;
    }
    this.ghosts = this.ghosts.filter(g => g.t < g.life);

    // スライム（小さい順）
    const sl = W.slimes.slice().sort((a, b) => a.r - b.r);
    for (const s of sl) this.drawSlime(ctx, s, dtReal);

    // 蒸気
    // パーティクル
    this.drawParticles(ctx, dtReal);

    // 爆発リング
    for (const r of this.rings) {
      r.t += dtReal;
      if (r.t < 0) continue;
      const k = r.t / r.life;
      const rad = r.r0 + (r.r1 - r.r0) * (1 - Math.pow(1 - k, 2));
      if (r.fill) {
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        const g = ctx.createRadialGradient(r.x, r.y, 0, r.x, r.y, rad);
        g.addColorStop(0, `rgba(255,250,210,${0.9 * (1 - k)})`); g.addColorStop(0.5, `rgba(255,150,40,${0.6 * (1 - k)})`); g.addColorStop(1, 'rgba(255,60,0,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(r.x, r.y, rad, 0, TAU); ctx.fill(); ctx.restore();
      }
      ctx.strokeStyle = rgba(r.col.startsWith('#') ? r.col : '#ffffff', 1 - k);
      ctx.lineWidth = r.w * (1 - k * 0.5);
      ctx.beginPath(); ctx.arc(r.x, r.y, rad, 0, TAU); ctx.stroke();
    }
    this.rings = this.rings.filter(r => r.t < r.life);

    // 連鎖ライン
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (const l of this.links) {
      l.t += dtReal; const k = l.t / l.life;
      ctx.strokeStyle = rgba(l.col, 1 - k); ctx.lineWidth = 2.5 * (1 - k) + 0.5;
      ctx.beginPath(); ctx.moveTo(l.x1, l.y1); ctx.lineTo(l.x2, l.y2); ctx.stroke();
    }
    ctx.restore();
    this.links = this.links.filter(l => l.t < l.life);

    // ラベル
    if (this.showLabels) this.drawLabels(ctx, pxs);

    // テキスト
    for (const t of this.texts) {
      t.t += dtReal; t.y += t.vy * dtReal;
      const k = t.t / t.life;
      ctx.globalAlpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
      const size = t.size * pxs * (t.bold ? (1 + Math.max(0, 0.3 - t.t) * 2) : 1);
      ctx.font = `${t.bold ? 900 : 700} ${size}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 3 * pxs; ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.strokeText(t.txt, t.x, t.y); ctx.fillStyle = t.col; ctx.fillText(t.txt, t.x, t.y);
    }
    ctx.globalAlpha = 1;
    this.texts = this.texts.filter(t => t.t < t.life);
    if (this.texts.length > 120) this.texts.splice(0, this.texts.length - 120);
    ctx.restore();
  }

  drawParticles(ctx, dt) {
    const W = this.world;
    // 蒸気（通常合成）
    for (const p of this.particles) {
      if (p.kind !== 'puff') continue;
      p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt;
      const k = p.t / p.life;
      ctx.fillStyle = `rgba(235,242,248,${0.22 * (1 - k)})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (0.6 + k * 0.8), 0, TAU); ctx.fill();
    }
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (const p of this.particles) {
      if (p.kind === 'puff') continue;
      p.t += dt;
      const k = p.t / p.life;
      if (p.kind === 'absorb') {
        let tx = p.tx, ty = p.ty;
        if (p.sid) { const s = W.slimes.find(o => o.id === p.sid); if (s) { tx = s.x; ty = s.y; } }
        if (tx != null) { p.x += (tx - p.x) * Math.min(1, dt * 7); p.y += (ty - p.y) * Math.min(1, dt * 7); }
        ctx.fillStyle = rgba(p.col, 1 - k * 0.5); ctx.beginPath(); ctx.arc(p.x, p.y, 2.2, 0, TAU); ctx.fill();
        continue;
      }
      if (p.kind === 'pillar') {
        const h = 260 * (1 - k * 0.3), w = 30 * (1 - k);
        const g = ctx.createLinearGradient(p.x, p.y - h, p.x, p.y);
        g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(1, `rgba(255,255,230,${0.7 * (1 - k)})`);
        ctx.fillStyle = g; ctx.fillRect(p.x - w / 2, p.y - h, w, h);
        continue;
      }
      if (p.kind === 'flame') {
        p.x += p.vx * dt; p.y += p.vy * dt; p.vy -= 30 * dt;
        ctx.fillStyle = `rgba(255,${Math.round(200 - 150 * k)},${Math.round(60 - 50 * k)},${0.7 * (1 - k)})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (1 - k * 0.6), 0, TAU); ctx.fill();
        continue;
      }
      if (p.kind === 'bubble') {
        p.x += p.vx * dt; p.y += p.vy * dt;
        ctx.strokeStyle = `rgba(160,240,110,${0.8 * (1 - k)})`; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, TAU); ctx.stroke();
        continue;
      }
      p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= Math.pow(0.1, dt); p.vy *= Math.pow(0.1, dt);
      ctx.fillStyle = rgba(p.col, 1 - k);
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, TAU); ctx.fill();
    }
    ctx.restore();
    this.particles = this.particles.filter(p => p.t < p.life);
    if (this.particles.length > 1500) this.particles.splice(0, this.particles.length - 1500);
  }

  drawPrey(ctx, p) {
    const P = CONFIG.prey[p.type];
    const flash = p.hitT > 0;
    let col = P.color;
    if (p.poison) col = '#8fd14f';
    if (p.slowT > 0) col = '#cfe3f0';
    if (flash) col = '#ffffff';
    if (p.type === 'mite') {
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
      return;
    }
    const a = Math.atan2(p.vy, p.vx) || p.heading || 0;
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(a);
    if (p.type === 'hopper') {
      const sp = Math.hypot(p.vx, p.vy), st = Math.min(0.5, sp / 300);
      ctx.strokeStyle = '#6e7d2c'; ctx.lineWidth = 1;
      for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(-1, 0); ctx.lineTo(-6 - st * 6, s * 5); ctx.stroke(); }
      ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(0, 0, p.r * (1 + st), p.r * (1 - st * 0.5), 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(p.r * 0.6, -1.5, 1, 0, TAU); ctx.arc(p.r * 0.6, 1.5, 1, 0, TAU); ctx.fill();
    } else if (p.type === 'grub') {
      ctx.fillStyle = col;
      for (let i = 2; i >= 0; i--) { ctx.beginPath(); ctx.arc(-i * p.r * 0.7, Math.sin(this.t * 4 + i + p.id) * 1.2, p.r * (1 - i * 0.15), 0, TAU); ctx.fill(); }
      ctx.fillStyle = '#5b4632'; ctx.beginPath(); ctx.arc(p.r * 0.4, -2, 1.3, 0, TAU); ctx.arc(p.r * 0.4, 2, 1.3, 0, TAU); ctx.fill();
    } else if (p.type === 'beast') {
      const r = p.r, step = Math.sin(this.t * 8 + p.id) * 3;
      ctx.fillStyle = '#5a3b26';
      for (const [lx, ly] of [[-r * 0.5, -r * 0.6], [-r * 0.5, r * 0.6], [r * 0.4, -r * 0.6], [r * 0.4, r * 0.6]]) { ctx.beginPath(); ctx.ellipse(lx + (ly > 0 ? step : -step), ly, 5, 4, 0, 0, TAU); ctx.fill(); }
      ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(0, 0, r, r * 0.68, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = shade(P.color, -0.25); ctx.beginPath(); ctx.ellipse(-r * 0.2, 0, r * 0.55, r * 0.35, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = flash ? '#fff' : shade(P.color, 0.1); ctx.beginPath(); ctx.arc(r * 0.95, 0, r * 0.42, 0, TAU); ctx.fill();
      ctx.fillStyle = '#efe6cf';
      for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(r * 1.05, s * r * 0.25); ctx.lineTo(r * 1.6, s * r * 0.55); ctx.lineTo(r * 1.15, s * r * 0.05); ctx.fill(); }
      ctx.fillStyle = p.aggro ? '#ff2a2a' : '#111';
      ctx.beginPath(); ctx.arc(r * 1.1, -r * 0.18, 2.2, 0, TAU); ctx.arc(r * 1.1, r * 0.18, 2.2, 0, TAU); ctx.fill();
    }
    ctx.restore();
    if (p.type === 'beast' && p.hp < p.maxHp) {
      const w = p.r * 2;
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(p.x - w / 2, p.y - p.r - 12, w, 4);
      ctx.fillStyle = '#ff5252'; ctx.fillRect(p.x - w / 2, p.y - p.r - 12, w * Math.max(0, p.hp / p.maxHp), 4);
    }
    if (p.type === 'beast' && p.aggro) {
      ctx.fillStyle = '#ff3b3b'; ctx.font = '900 16px system-ui'; ctx.textAlign = 'center'; ctx.fillText('!', p.x, p.y - p.r - 16);
    }
  }

  blob(ctx, r, t, seed, wob = 0.06, n = 18) {
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const a = i / n * TAU;
      const rr = r * (1 + wob * Math.sin(t * 5 + i * 1.9 + seed) + wob * 0.6 * Math.sin(t * 3.1 + i * 3.3 + seed * 2));
      const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath();
  }

  drawSlime(ctx, s, dt) {
    const W = this.world, L = W.lineages.get(s.lin);
    if (!L) return;
    const F = CONFIG.forms[L.form];
    const fx = this.fxFor(s.id);
    const sp = Math.hypot(s.vx, s.vy);
    fx.spin += sp * dt / Math.max(4, s.r);
    const t = this.t, r = s.r;
    const elem = L.element;

    if (s.kind === 'infector') {
      const blink = Math.sin(t * 20 + s.id) > 0;
      ctx.fillStyle = blink ? '#ff4d6d' : '#7a0f2e';
      ctx.beginPath(); ctx.arc(s.x, s.y, r + (blink ? 1 : 0), 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(255,77,109,0.4)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x - s.vx * 0.08, s.y - s.vy * 0.08); ctx.stroke();
      return;
    }

    // 血統リング（足元）
    ctx.strokeStyle = rgba(L.color, this.selected === L.id ? 0.95 : 0.55);
    ctx.lineWidth = this.selected === L.id ? 2.5 : 1.5;
    ctx.beginPath(); ctx.ellipse(s.x, s.y + r * 0.55, r * 1.05, r * 0.42, 0, 0, TAU); ctx.stroke();

    // 炎の粒子を出す
    fx.emitT -= dt;
    const fiery = ['fireball', 'fireDance', 'legion', 'march', 'dragon', 'lavaTitan'].includes(L.form);
    if (fiery && fx.emitT <= 0) {
      fx.emitT = L.form === 'fireball' || L.form === 'fireDance' ? 0.02 : 0.08;
      const n = L.form === 'fireball' || L.form === 'fireDance' ? 2 : 1;
      for (let i = 0; i < n; i++) this.particles.push({ kind: 'flame', x: s.x + (rnd() - 0.5) * r, y: s.y + (rnd() - 0.5) * r, vx: -s.vx * 0.2 + (rnd() - 0.5) * 20, vy: -s.vy * 0.2 - 20 - rnd() * 20, t: 0, life: 0.35 + rnd() * 0.3, size: r * (0.35 + rnd() * 0.3) });
    }
    if (elem === 'toxic' && rnd() < dt * 6) this.particles.push({ kind: 'bubble', x: s.x + (rnd() - 0.5) * r, y: s.y - r * 0.3, vx: 0, vy: -20, t: 0, life: 0.8, size: 1.5 + rnd() * 2 });
    if (elem === 'steam' && rnd() < dt * 3) this.particles.push({ kind: 'puff', x: s.x, y: s.y - r * 0.5, vx: (rnd() - 0.5) * 10, vy: -15, t: 0, life: 1.2, size: r * 0.5 });

    ctx.save();
    ctx.translate(s.x, s.y);
    // 状態：休眠
    const resting = s.state === 'rest';
    const k = Math.min(0.32, sp / 650);
    const ang = Math.atan2(s.vy, s.vx);
    let base = F.color;
    if (elem === 'steam') base = shade(base, 0.45);
    if (elem === 'toxic') base = mix(base, '#7bd148', 0.45);

    // 吐息
    if (s.breathing) {
      ctx.save(); ctx.rotate(s.face); ctx.globalCompositeOperation = 'lighter';
      const R = F.breath.range * Math.cbrt(s.mass) * 0.9, A = F.breath.arc;
      const g = ctx.createRadialGradient(r * 0.8, 0, 2, r * 0.8, 0, R);
      g.addColorStop(0, 'rgba(255,240,180,0.85)'); g.addColorStop(0.4, 'rgba(255,140,30,0.55)'); g.addColorStop(1, 'rgba(255,40,0,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(r * 0.8, 0);
      const jitter = Math.sin(t * 30) * 0.05;
      ctx.arc(r * 0.8, 0, R, -A + jitter, A + jitter); ctx.closePath(); ctx.fill();
      ctx.restore();
      if (rnd() < 0.7) { const a = s.face + (rnd() - 0.5) * F.breath.arc * 1.5, v = 150 + rnd() * 120; this.particles.push({ kind: 'flame', x: s.x + Math.cos(s.face) * r, y: s.y + Math.sin(s.face) * r, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0, life: 0.45, size: 4 + rnd() * 5 }); }
    }
    // オーラ（溶岩巨龍）
    if (F.aura) {
      const R = r * F.aura.mul;
      const g = ctx.createRadialGradient(0, 0, r * 0.8, 0, 0, R);
      g.addColorStop(0, 'rgba(255,100,20,0.25)'); g.addColorStop(1, 'rgba(255,60,0,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.fill();
    }
    // 炎のグロー
    if (fiery) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(0, 0, r * 0.4, 0, 0, r * 2);
      g.addColorStop(0, 'rgba(255,120,30,0.35)'); g.addColorStop(1, 'rgba(255,60,0,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, r * 2, 0, TAU); ctx.fill(); ctx.restore();
    }

    // 体の変形（速度方向に伸びる）
    ctx.save();
    ctx.rotate(ang); ctx.scale(1 + k, 1 - k * 0.6); ctx.rotate(-ang);
    const form = L.form;
    if (form === 'fireball' || form === 'fireDance') {
      const g = ctx.createRadialGradient(-r * 0.3, -r * 0.3, 1, 0, 0, r * 1.1);
      g.addColorStop(0, form === 'fireDance' ? '#fffbe0' : '#fff1c1'); g.addColorStop(0.45, base); g.addColorStop(1, shade(base, -0.45));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
      ctx.save(); ctx.rotate(fx.spin);
      ctx.strokeStyle = 'rgba(120,20,0,0.55)'; ctx.lineWidth = r * 0.22;
      for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(0, 0, r * 0.62, i * TAU / 3, i * TAU / 3 + 1.1); ctx.stroke(); }
      ctx.restore();
    } else if (form === 'dragon' || form === 'lavaTitan') {
      const face = s.face;
      // 背のトゲ
      ctx.save(); ctx.rotate(face);
      ctx.fillStyle = form === 'lavaTitan' ? '#2b1208' : shade(base, -0.35);
      for (let i = 0; i < 5; i++) { const a = Math.PI * 0.6 + i * 0.2; ctx.beginPath(); ctx.moveTo(Math.cos(a) * r * 0.9, Math.sin(a) * r * 0.9); ctx.lineTo(Math.cos(a) * r * 1.35, Math.sin(a) * r * 1.35); ctx.lineTo(Math.cos(a + 0.12) * r * 0.9, Math.sin(a + 0.12) * r * 0.9); ctx.fill(); }
      for (let i = 0; i < 5; i++) { const a = -Math.PI * 0.6 - i * 0.2; ctx.beginPath(); ctx.moveTo(Math.cos(a) * r * 0.9, Math.sin(a) * r * 0.9); ctx.lineTo(Math.cos(a) * r * 1.35, Math.sin(a) * r * 1.35); ctx.lineTo(Math.cos(a - 0.12) * r * 0.9, Math.sin(a - 0.12) * r * 0.9); ctx.fill(); }
      ctx.restore();
      const g = ctx.createRadialGradient(-r * 0.3, -r * 0.4, 2, 0, 0, r * 1.1);
      g.addColorStop(0, form === 'lavaTitan' ? '#6b3a22' : shade(base, 0.35)); g.addColorStop(1, form === 'lavaTitan' ? '#1e0b05' : shade(base, -0.4));
      ctx.fillStyle = g; this.blob(ctx, r, resting ? t * 0.3 : t, s.id, 0.04); ctx.fill();
      if (form === 'lavaTitan') {
        ctx.strokeStyle = `rgba(255,${120 + 60 * Math.sin(t * 3)},20,0.9)`; ctx.lineWidth = Math.max(1.5, r * 0.06);
        for (let i = 0; i < 7; i++) { const a = i * 0.9 + s.id; ctx.beginPath(); ctx.moveTo(Math.cos(a) * r * 0.15, Math.sin(a) * r * 0.15); ctx.lineTo(Math.cos(a + 0.3) * r * 0.55, Math.sin(a + 0.3) * r * 0.55); ctx.lineTo(Math.cos(a) * r * 0.92, Math.sin(a) * r * 0.92); ctx.stroke(); }
      }
      // 角と目
      ctx.save(); ctx.rotate(face);
      ctx.fillStyle = '#f3e3c3';
      for (const sgn of [-1, 1]) { ctx.beginPath(); ctx.moveTo(r * 0.35, sgn * r * 0.55); ctx.quadraticCurveTo(r * 0.2, sgn * r * 1.3, -r * 0.3, sgn * r * 1.25); ctx.lineTo(r * 0.1, sgn * r * 0.5); ctx.fill(); }
      ctx.fillStyle = resting ? '#333' : '#ffe14d';
      for (const sgn of [-1, 1]) {
        ctx.beginPath();
        if (resting) ctx.rect(r * 0.45, sgn * r * 0.28 - 1, r * 0.25, 2);
        else { ctx.moveTo(r * 0.4, sgn * r * 0.18); ctx.lineTo(r * 0.75, sgn * r * 0.32); ctx.lineTo(r * 0.45, sgn * r * 0.42); }
        ctx.fill();
      }
      ctx.restore();
    } else if (form === 'chain' || form === 'infect') {
      const pulse = 1 + 0.06 * Math.sin(t * (s.target ? 14 : 5));
      const g = ctx.createRadialGradient(0, 0, 1, 0, 0, r * 1.1);
      g.addColorStop(0, '#ffcc4d'); g.addColorStop(0.35, base); g.addColorStop(1, shade(base, -0.5));
      ctx.fillStyle = g; this.blob(ctx, r * pulse, t, s.id, 0.07); ctx.fill();
      ctx.strokeStyle = `rgba(255,230,120,${0.6 + 0.4 * Math.sin(t * 9 + s.id)})`; ctx.lineWidth = 1.6;
      for (let i = 0; i < 5; i++) { const a = i * 1.25 + s.id; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5); ctx.lineTo(Math.cos(a + 0.4) * r * 0.85, Math.sin(a + 0.4) * r * 0.85); ctx.stroke(); }
      if (form === 'infect') {
        ctx.fillStyle = '#ff4d6d';
        for (let i = 0; i < 6; i++) { const a = i * TAU / 6 + t * 0.5; ctx.beginPath(); ctx.arc(Math.cos(a) * r * 0.9, Math.sin(a) * r * 0.9, r * 0.18 * (1 + 0.3 * Math.sin(t * 6 + i)), 0, TAU); ctx.fill(); }
      }
      // 導火線
      ctx.strokeStyle = '#3a2a1a'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, -r * 0.9); ctx.quadraticCurveTo(r * 0.3, -r * 1.3, r * 0.1, -r * 1.5); ctx.stroke();
      if (Math.sin(t * 25) > -0.3) { ctx.fillStyle = '#fff3a0'; ctx.beginPath(); ctx.arc(r * 0.1, -r * 1.5, 2.5, 0, TAU); ctx.fill(); }
    } else if (form === 'legion' || form === 'march') {
      const g = ctx.createRadialGradient(-r * 0.3, -r * 0.3, 1, 0, 0, r * 1.1);
      g.addColorStop(0, shade(base, 0.5)); g.addColorStop(1, shade(base, -0.35));
      ctx.fillStyle = g; this.blob(ctx, r, t, s.id, 0.08, 12); ctx.fill();
      if (form === 'march') {
        ctx.save(); ctx.rotate(fx.spin); ctx.strokeStyle = 'rgba(90,10,0,0.6)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(-r * 0.8, 0); ctx.lineTo(r * 0.8, 0); ctx.stroke(); ctx.restore();
      }
      // 小さな炎の冠
      ctx.fillStyle = `rgba(255,${200 + 40 * Math.sin(t * 12 + s.id)},80,0.95)`;
      ctx.beginPath(); ctx.moveTo(-r * 0.4, -r * 0.8); ctx.quadraticCurveTo(0, -r * (1.9 + 0.3 * Math.sin(t * 15 + s.id)), r * 0.4, -r * 0.8); ctx.fill();
    } else {
      // 基本スライム
      const g = ctx.createRadialGradient(-r * 0.35, -r * 0.4, 1, 0, 0, r * 1.15);
      g.addColorStop(0, shade(base, 0.55)); g.addColorStop(1, shade(base, -0.3));
      ctx.fillStyle = g; this.blob(ctx, r, t, s.id, 0.07); ctx.fill();
    }
    ctx.restore();

    // 目（龍以外）
    if (form !== 'dragon' && form !== 'lavaTitan' && form !== 'fireball' && form !== 'fireDance') {
      const la = s.target && s.target.alive ? Math.atan2(s.target.y - s.y, s.target.x - s.x) : ang;
      const er = Math.max(1.5, r * 0.2), ex = r * 0.3;
      for (const sgn of [-1, 1]) {
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(sgn * ex, -r * 0.15, er, 0, TAU); ctx.fill();
        ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(sgn * ex + Math.cos(la) * er * 0.4, -r * 0.15 + Math.sin(la) * er * 0.4, er * 0.55, 0, TAU); ctx.fill();
      }
    }
    // ハイライト
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath(); ctx.ellipse(-r * 0.35, -r * 0.45, r * 0.25, r * 0.13, -0.5, 0, TAU); ctx.fill();
    if (elem === 'steam') { ctx.strokeStyle = 'rgba(230,245,255,0.6)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(0, 0, r * 1.15, 0, TAU); ctx.stroke(); }
    if (elem === 'toxic') { ctx.strokeStyle = 'rgba(150,230,90,0.7)'; ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.arc(0, 0, r * 1.15, 0, TAU); ctx.stroke(); ctx.setLineDash([]); }
    // HP（減っている時）
    if (s.hp < s.maxHp * 0.98 && r > 8) {
      const w = Math.max(16, r * 1.6);
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(-w / 2, -r - 9, w, 3);
      ctx.fillStyle = s.hp / s.maxHp > 0.35 ? '#5cff8d' : '#ff5252'; ctx.fillRect(-w / 2, -r - 9, w * Math.max(0, s.hp / s.maxHp), 3);
    }
    if (resting) { ctx.fillStyle = '#cde'; ctx.font = `700 ${Math.max(10, r * 0.5)}px system-ui`; ctx.fillText('Zz', r * 0.6, -r * 0.9 - Math.sin(t * 2) * 3); }
    if (s.state === 'starve' && Math.sin(t * 6) > 0) { ctx.fillStyle = '#ffd166'; ctx.font = '700 9px system-ui'; ctx.textAlign = 'center'; ctx.fillText('腹ペコ', 0, -r - 3); }
    if (s.state === 'flee') { ctx.fillStyle = '#fff'; ctx.font = '900 11px system-ui'; ctx.textAlign = 'center'; ctx.fillText('💦', 0, -r - 4); }
    ctx.restore();
  }

  drawLabels(ctx, pxs) {
    const W = this.world;
    for (const L of W.lineages.values()) {
      const mine = W.slimes.filter(s => s.lin === L.id && s.kind !== 'infector');
      if (!mine.length) continue;
      const F = CONFIG.forms[L.form];
      let x, y, top;
      if (mine.length === 1) { x = mine[0].x; y = mine[0].y; top = y - mine[0].r - 14 * pxs; }
      else {
        // 群れの中心に一番近い個体の上に表示
        const cx = mine.reduce((a, s) => a + s.x, 0) / mine.length, cy = mine.reduce((a, s) => a + s.y, 0) / mine.length;
        let b = mine[0], bd = Infinity;
        for (const s of mine) { const d = (s.x - cx) ** 2 + (s.y - cy) ** 2; if (d < bd) { bd = d; b = s; } }
        x = b.x; y = b.y; top = y - b.r - 14 * pxs;
      }
      const el = L.element ? CONFIG.elements[L.element].name : '';
      const txt = `${L.id} ${F.name}${el ? '・' + el : ''}${L.level > 1 ? ' Lv' + L.level : ''}${mine.length > 1 ? ' ×' + mine.length : ''}`;
      const size = (this.compact ? 11 : 12) * pxs;
      ctx.font = `700 ${size}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      const w = ctx.measureText(txt).width + 10 * pxs;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      roundRect(ctx, x - w / 2, top - size, w, size * 1.35, 4 * pxs); ctx.fill();
      ctx.fillStyle = L.color; ctx.fillText(txt, x, top);
    }
  }
}

function mix(a, b, k) { const A = hexToRgb(a), B = hexToRgb(b); return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * k).toString(16).padStart(2, '0')).join(''); }
function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
