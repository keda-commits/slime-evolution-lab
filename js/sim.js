// =============================================================
//  自律シミュレーション（DOM非依存・決定論的）
//  スライムと獲物が同じフィールドで自律行動する。
//  ブラウザ表示とNode.jsの自動テストの両方から同じコードを使う。
// =============================================================
import { CONFIG } from './config.js';
import { makeRng } from './rng.js';

const TAU = Math.PI * 2;
const PREY_TYPES = ['hopper', 'mite', 'grub', 'beast'];
const CELL = 64;

function len(x, y) { return Math.sqrt(x * x + y * y); }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function angDiff(a, b) { let d = a - b; while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU; return d; }

function newStats() {
  return {
    kills: { hopper: 0, mite: 0, grub: 0, beast: 0 },
    causes: {}, mana: 0, nutri: 0, dist: 0, slimeTime: 0,
    maxChain: 0, explosions: 0, chains10: 0, splits: 0, deaths: 0, starved: 0,
    dmgTaken: 0, popTime: 0, popMax: 0, time: 0, infectors: 0, restTime: 0,
  };
}

export class World {
  constructor(seed = 1, cfg = CONFIG) {
    this.cfg = cfg;
    this.W = cfg.world.w; this.H = cfg.world.h;
    this.rng = makeRng(seed);
    this.time = 0;
    this.prey = [];
    this.slimes = [];
    this.lineages = new Map();
    this.hazards = [];
    this.pending = [];
    this.events = [];
    this.recordEvents = true;
    this.nextId = 1;
    this.chains = new Map();
    this.onMana = null;
    this.beastTimer = 0;
    this.repopT = 0;
    this.gridW = Math.ceil(this.W / CELL); this.gridH = Math.ceil(this.H / CELL);
    this.grid = new Array(this.gridW * this.gridH);
    const r = this.rng;
    const P = cfg.prey;
    // 群れ蟲の巣（固定位置）
    this.nests = [];
    for (let i = 0; i < P.mite.nests; i++) {
      let x, y, ok, tries = 0;
      do {
        x = r.range(120, this.W - 120); y = r.range(120, this.H - 120);
        ok = this.nests.every(n => len(n.x - x, n.y - y) > 300);
      } while (!ok && ++tries < 50);
      this.nests.push({ x, y, id: i });
    }
    for (let i = 0; i < P.hopper.K; i++) this.spawnPrey('hopper', r.range(30, this.W - 30), r.range(30, this.H - 30));
    for (let i = 0; i < P.grub.K; i++) this.spawnPrey('grub', r.range(30, this.W - 30), r.range(30, this.H - 30));
    for (const n of this.nests) for (let i = 0; i < P.mite.perNest; i++) this.spawnMite(n);
    for (let i = 0; i < P.beast.K; i++) this.spawnPrey('beast', r.range(100, this.W - 100), r.range(100, this.H - 100));
  }

  emit(e) { if (this.recordEvents) { this.events.push(e); if (this.events.length > 600) this.events.splice(0, 200); } }

  // ---------------- 獲物 ----------------
  spawnPrey(type, x, y) {
    const d = this.cfg.prey[type];
    const p = {
      id: this.nextId++, type, x: clamp(x, d.r, this.W - d.r), y: clamp(y, d.r, this.H - d.r),
      vx: 0, vy: 0, hp: d.hp, maxHp: d.hp, r: d.r, alive: true, heading: this.rng() * TAU,
      t: this.rng() * 2, slowT: 0, poison: null, aggro: null, aggroT: 0, atkCd: 0, nest: null, hitT: 0,
      born: this.time,
    };
    this.prey.push(p);
    return p;
  }
  spawnMite(n) {
    const a = this.rng() * TAU, d = this.rng() * 36;
    const p = this.spawnPrey('mite', n.x + Math.cos(a) * d, n.y + Math.sin(a) * d);
    p.nest = n.id;
    return p;
  }

  rebuildGrid() {
    const g = this.grid;
    for (let i = 0; i < g.length; i++) g[i] = null;
    for (const p of this.prey) {
      if (!p.alive) continue;
      const gx = clamp((p.x / CELL) | 0, 0, this.gridW - 1), gy = clamp((p.y / CELL) | 0, 0, this.gridH - 1);
      const k = gy * this.gridW + gx;
      (g[k] || (g[k] = [])).push(p);
    }
  }
  queryPrey(x, y, r, out = []) {
    out.length = 0;
    const x0 = clamp(((x - r) / CELL) | 0, 0, this.gridW - 1), x1 = clamp(((x + r) / CELL) | 0, 0, this.gridW - 1);
    const y0 = clamp(((y - r) / CELL) | 0, 0, this.gridH - 1), y1 = clamp(((y + r) / CELL) | 0, 0, this.gridH - 1);
    for (let gy = y0; gy <= y1; gy++) for (let gx = x0; gx <= x1; gx++) {
      const c = this.grid[gy * this.gridW + gx];
      if (!c) continue;
      for (const p of c) {
        if (!p.alive) continue;
        const dx = p.x - x, dy = p.y - y, rr = r + p.r;
        if (dx * dx + dy * dy <= rr * rr) out.push(p);
      }
    }
    return out;
  }

  nearestSlime(x, y, maxD) {
    let best = null, bd = maxD * maxD;
    for (const s of this.slimes) {
      if (!s.alive) continue;
      const d = (s.x - x) ** 2 + (s.y - y) ** 2;
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  updatePrey(dt) {
    const P = this.cfg.prey, r = this.rng;
    for (const p of this.prey) {
      if (!p.alive) continue;
      const d = P[p.type];
      p.t -= dt; p.hitT -= dt;
      if (p.slowT > 0) p.slowT -= dt;
      const slow = p.slowT > 0 ? 0.3 : 1;
      if (p.type === 'hopper') {
        if (p.t <= 0) {
          const th = this.nearestSlime(p.x, p.y, d.flee);
          let a;
          if (th) { a = Math.atan2(p.y - th.y, p.x - th.x) + r.range(-0.7, 0.7); p.t = r.range(0.22, 0.45); }
          else { a = p.heading + r.range(-1.4, 1.4); p.t = r.range(0.6, 1.4); }
          p.heading = a;
          const sp = d.speed * r.range(0.7, 1.1) * slow * (th ? 1.25 : 0.8);
          p.vx = Math.cos(a) * sp; p.vy = Math.sin(a) * sp;
        }
        const f = Math.exp(-3.2 * dt); p.vx *= f; p.vy *= f;
      } else if (p.type === 'mite') {
        const n = this.nests[p.nest];
        let ax = (n.x - p.x) * 0.6, ay = (n.y - p.y) * 0.6;
        if (p.t <= 0) { p.heading = r() * TAU; p.t = r.range(0.3, 0.9); }
        ax += Math.cos(p.heading) * 30; ay += Math.sin(p.heading) * 30;
        const th = this.nearestSlime(p.x, p.y, d.flee);
        if (th) { const dx = p.x - th.x, dy = p.y - th.y, l = len(dx, dy) || 1; ax += dx / l * 60; ay += dy / l * 60; }
        const l = len(ax, ay) || 1, sp = d.speed * slow;
        p.vx = ax / l * sp; p.vy = ay / l * sp;
      } else if (p.type === 'grub') {
        if (p.t <= 0) { p.heading += r.range(-1, 1); p.t = r.range(1, 3); }
        p.vx = Math.cos(p.heading) * d.speed * slow; p.vy = Math.sin(p.heading) * d.speed * slow;
      } else if (p.type === 'beast') {
        p.atkCd -= dt;
        if (p.aggro && (!p.aggro.alive || p.aggroT <= 0)) p.aggro = null;
        if (p.aggro) {
          p.aggroT -= dt;
          const s = p.aggro, dx = s.x - p.x, dy = s.y - p.y, l = len(dx, dy) || 1;
          p.heading = Math.atan2(dy, dx);
          const sp = d.chargeSpeed * slow;
          p.vx = dx / l * sp; p.vy = dy / l * sp;
          if (l < p.r + s.r + 6 && p.atkCd <= 0) {
            p.atkCd = d.atkCd;
            this.damageSlime(s, d.atk, p);
            s.vx += dx / l * 160; s.vy += dy / l * 160;
            p.vx = -dx / l * 60; p.vy = -dy / l * 60;
          }
        } else {
          if (p.t <= 0) { p.heading += r.range(-0.9, 0.9); p.t = r.range(2, 5); }
          p.vx = Math.cos(p.heading) * d.speed * slow; p.vy = Math.sin(p.heading) * d.speed * slow;
        }
      }
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.x < p.r) { p.x = p.r; p.vx = Math.abs(p.vx); p.heading = Math.PI - p.heading; }
      if (p.x > this.W - p.r) { p.x = this.W - p.r; p.vx = -Math.abs(p.vx); p.heading = Math.PI - p.heading; }
      if (p.y < p.r) { p.y = p.r; p.vy = Math.abs(p.vy); p.heading = -p.heading; }
      if (p.y > this.H - p.r) { p.y = this.H - p.r; p.vy = -Math.abs(p.vy); p.heading = -p.heading; }
      // 毒
      if (p.poison) {
        p.poison.t -= dt;
        this.damagePrey(p, p.poison.dps * dt, p.poison.lin, 'poison', null);
        if (p.poison && p.poison.t <= 0) p.poison = null;
      }
    }
  }

  repopulate(dt) {
    this.repopT += dt;
    this.beastTimer -= dt;
    if (this.repopT < 0.5) return;
    const step = this.repopT; this.repopT = 0;
    const P = this.cfg.prey, r = this.rng;
    const count = { hopper: 0, mite: 0, grub: 0, beast: 0 };
    const nestCount = this.nests.map(() => 0);
    for (const p of this.prey) if (p.alive) { count[p.type]++; if (p.type === 'mite') nestCount[p.nest]++; }
    for (const t of ['hopper', 'grub']) {
      const d = P[t], n = count[t];
      const rate = d.birth * n * Math.max(0, 1 - n / d.K) + d.immigrate * Math.max(0, 1 - n / d.K);
      let e = rate * step;
      while (e > 0) {
        if (r() < Math.min(1, e)) {
          const src = n > 3 ? this.prey.find((p, i) => p.alive && p.type === t && r() < 0.15) : null;
          if (src) this.spawnPrey(t, src.x + r.range(-40, 40), src.y + r.range(-40, 40));
          else {
            const edge = r.int(4);
            const x = edge < 2 ? r.range(0, this.W) : (edge === 2 ? 10 : this.W - 10);
            const y = edge >= 2 ? r.range(0, this.H) : (edge === 0 ? 10 : this.H - 10);
            this.spawnPrey(t, x, y);
          }
        }
        e -= 1;
      }
    }
    this.nests.forEach((n, i) => {
      const c = nestCount[i];
      const rate = P.mite.regrow * Math.max(0, 1 - c / P.mite.perNest) * (c > 0 ? 1 : 0.6);
      let e = rate * step;
      while (e > 0) { if (r() < Math.min(1, e)) this.spawnMite(n); e -= 1; }
    });
    if (count.beast < P.beast.K && this.beastTimer <= 0) {
      this.beastTimer = P.beast.respawn;
      const edge = r.int(4);
      const x = edge < 2 ? r.range(60, this.W - 60) : (edge === 2 ? 30 : this.W - 30);
      const y = edge >= 2 ? r.range(60, this.H - 60) : (edge === 0 ? 30 : this.H - 30);
      this.spawnPrey('beast', x, y);
    }
  }

  // ---------------- 血統・形態 ----------------
  // L: { id, color, form, element, level, policy }
  setLineage(data, spawn = true) {
    let L = this.lineages.get(data.id);
    if (!L) {
      L = { ...data, stats: newStats(), respawnT: 0, home: data.home || { x: this.W / 2, y: this.H / 2 },
            marchPoint: null, marchT: 0, cloudT: 0, densT: 0, densPoint: null };
      this.lineages.set(data.id, L);
      if (spawn) {
        const n = Math.max(this.isMulti(L) ? 3 : 1, data.count || 1);
        for (let i = 0; i < n; i++) {
          this.spawnSlime(L, L.home.x + this.rng.range(-30, 30), L.home.y + this.rng.range(-30, 30),
            { mass: this.isMulti(L) ? 1 : (data.mass || 1), nutri: this.isMulti(L) ? this.formOf(L).split.cost * 0.5 : 0, kind: this.isMulti(L) ? 'unit' : 'main' });
          if (!this.isMulti(L)) break;
        }
      }
    } else {
      Object.assign(L, { color: data.color, element: data.element, level: data.level, policy: data.policy, name: data.name });
      if (data.form !== L.form) this.changeForm(L, data.form);
    }
    return L;
  }
  removeLineage(id) {
    this.lineages.delete(id);
    for (const s of this.slimes) if (s.lin === id) s.alive = false;
  }

  formOf(L) { return this.cfg.forms[L.form]; }
  isMulti(L) { return !!this.formOf(L).split; }

  // レベル・方針・質量を反映した実効パラメータ
  eff(s, L) {
    const F = this.formOf(L), lv = (L.level || 1) - 1, K = this.cfg.level, pol = this.cfg.policies[L.policy] || this.cfg.policies.normal;
    const m = s.mass;
    return {
      F, pol,
      speed: F.speed * Math.pow(m, -0.08) * (s.kind === 'infector' ? 0 : 1),
      accel: F.accel,
      atk: F.atk * (1 + K.atk * lv) * Math.sqrt(m) * pol.atkMul,
      impact: (F.impact || 0) * (1 + K.atk * lv) * pol.atkMul,
      maxHp: F.hp * (1 + K.hp * lv) * Math.pow(m, 0.75),
      sense: F.sense * (1 + 0.05 * lv),
      ability: 1 + K.ability * lv,
      cap: F.split ? Math.round(F.split.cap * (1 + K.cap * lv)) : 1,
    };
  }

  spawnSlime(L, x, y, o = {}) {
    const F = this.formOf(L);
    const s = {
      id: this.nextId++, lin: L.id, kind: o.kind || 'main', alive: true,
      x: clamp(x, 10, this.W - 10), y: clamp(y, 10, this.H - 10), vx: 0, vy: 0,
      mass: o.mass || 1, nutri: o.nutri || 0, hp: 1, maxHp: 1, r: F.r,
      target: null, retarget: 0, state: 'wander', wanderA: this.rng() * TAU, face: this.rng() * TAU,
      trailT: 0, hitCd: new Map(), age: 0, life: o.life || 0, breathing: false, restT: 0, born: this.time,
      combatT: 0,
    };
    const e = this.eff(s, L);
    s.maxHp = e.maxHp; s.hp = e.maxHp;
    s.r = this.radiusOf(s, L);
    this.slimes.push(s);
    return s;
  }
  radiusOf(s, L) {
    if (s.kind === 'infector') return this.formOf(L).infector.r;
    return this.formOf(L).r * Math.cbrt(s.mass);
  }

  changeForm(L, form) {
    const oldMulti = this.isMulti(L);
    L.form = form;
    const multi = this.isMulti(L);
    const mine = this.slimes.filter(s => s.alive && s.lin === L.id && s.kind !== 'infector');
    if (mine.length === 0) return;
    const F = this.formOf(L);
    if (multi && !oldMulti) {
      // 単体 → 群れ: その場で分裂して見せる
      const s = mine[0];
      s.kind = 'unit'; s.mass = 1;
      const n = 3;
      for (let i = 0; i < n - 1; i++) {
        const a = this.rng() * TAU;
        const c = this.spawnSlime(L, s.x + Math.cos(a) * 14, s.y + Math.sin(a) * 14, { kind: 'unit', nutri: F.split.cost * 0.5 });
        c.vx = Math.cos(a) * 150; c.vy = Math.sin(a) * 150;
        this.emit({ type: 'split', x: s.x, y: s.y, lin: L.id });
      }
      s.nutri = F.split.cost * 0.5;
    } else if (!multi && oldMulti) {
      // 群れ → 単体: 最古の1体へ融合
      mine.sort((a, b) => a.born - b.born);
      const keep = mine[0];
      for (const s of mine.slice(1)) { s.alive = false; this.emit({ type: 'merge', x: s.x, y: s.y, tx: keep.x, ty: keep.y, lin: L.id }); }
      keep.kind = 'main'; keep.mass = 1 + Math.min(mine.length * 0.1, 1);
    }
    for (const s of this.slimes) {
      if (!s.alive || s.lin !== L.id) continue;
      if (s.kind === 'infector') { s.alive = false; continue; }
      if (s.mass > F.massCap) s.mass = F.massCap;
      const e = this.eff(s, L);
      s.maxHp = e.maxHp; s.hp = e.maxHp; s.r = this.radiusOf(s, L);
      s.target = null; s.state = 'wander';
      this.emit({ type: 'evolve', x: s.x, y: s.y, r: s.r, lin: L.id, form });
    }
  }

  damageSlime(s, amt, src) {
    const L = this.lineages.get(s.lin); if (!L) return;
    const F = this.formOf(L), pol = this.cfg.policies[L.policy] || this.cfg.policies.normal;
    const dmg = amt * pol.dmgTakenMul * (1 - (F.armor || 0));
    s.hp -= dmg; s.combatT = 3;
    L.stats.dmgTaken += dmg;
    this.emit({ type: 'hurt', x: s.x, y: s.y, amt: dmg, lin: L.id });
    if (s.hp <= 0) this.killSlime(s, 'killed');
  }
  killSlime(s, why) {
    if (!s.alive) return;
    s.alive = false;
    const L = this.lineages.get(s.lin);
    if (!L) return;
    if (s.kind !== 'infector') {
      L.stats.deaths++;
      if (why === 'starve') L.stats.starved++;
      this.emit({ type: 'death', x: s.x, y: s.y, r: s.r, lin: L.id, why });
      const left = this.slimes.some(o => o.alive && o.lin === L.id && o.kind !== 'infector');
      if (!left) { L.respawnT = 4; L.respawnMass = s.kind === 'main' ? Math.max(1, s.mass * 0.6) : 1; }
    }
  }

  damagePrey(p, amt, lin, cause, s, chainId, depth) {
    if (!p.alive) return;
    const L = this.lineages.get(lin);
    if (p.slowT > 0 && L && L.element === 'steam') amt *= this.cfg.elements.steam.cloud.dmgMul;
    p.hp -= amt; p.hitT = 0.25;
    if (L && L.element === 'toxic' && cause !== 'poison') {
      const T = this.cfg.elements.toxic.poison;
      if (!p.poison) p.poison = { lin, t: T.dur, dps: T.dps * (p.type === 'beast' ? 3 : 1) };
      else p.poison.t = T.dur;
    }
    if (p.type === 'beast' && s && s.kind !== 'infector') {
      if (!p.aggro || !p.aggro.alive) { p.aggro = s; }
      p.aggroT = 5;
      s.combatT = 3;
    }
    if (p.hp <= 0) this.killPrey(p, lin, cause, s, chainId, depth);
  }

  killPrey(p, lin, cause, s, chainId, depth = 0) {
    if (!p.alive) return;
    p.alive = false;
    const L = this.lineages.get(lin);
    const d = this.cfg.prey[p.type];
    if (!L) return;
    L.stats.kills[p.type]++;
    L.stats.causes[cause] = (L.stats.causes[cause] || 0) + 1;
    const F = this.formOf(L);
    let mana = d.mana * (this.cfg.economy.manaMul || 1);
    // 連鎖ボーナス：連鎖が深いほど1体あたりの魔素が増える
    if (F.burst && chainId && F.burst.chainBonus) { const cn = (this.chains.get(chainId) || { n: 0 }).n; mana *= Math.min(F.burst.chainBonusMax, 1 + F.burst.chainBonus * cn); }
    L.stats.mana += mana;
    if (this.onMana) this.onMana(mana, L.id);
    // 栄養は倒したスライム（いなければ最寄りの同血統個体）へ
    let eater = s && s.alive && s.kind !== 'infector' ? s : null;
    if (!eater) {
      let bd = Infinity;
      for (const o of this.slimes) if (o.alive && o.lin === lin && o.kind !== 'infector') {
        const dd = (o.x - p.x) ** 2 + (o.y - p.y) ** 2; if (dd < bd) { bd = dd; eater = o; }
      }
    }
    if (eater) { eater.nutri += d.nutri; L.stats.nutri += d.nutri; }
    const engulf = (L.form === 'dragon' || L.form === 'lavaTitan') && (cause === 'contact' || cause === 'breath' || cause === 'aura');
    this.emit({ type: 'kill', x: p.x, y: p.y, r: p.r, prey: p.type, lin, cause, mana, engulf,
      sx: eater ? eater.x : p.x, sy: eater ? eater.y : p.y, sid: eater ? eater.id : 0 });
    // 連鎖爆破
    if (F.burst) {
      const cid = chainId || this.nextId++;
      const nd = chainId ? depth + 1 : 0;
      const B = F.burst;
      this.pending.push({ t: this.time + B.delay, x: p.x, y: p.y, lin, chainId: cid, depth: nd,
        radius: B.radius * (1 + (L.level - 1) * 0.06) * (p.type === 'beast' ? 2 : 1),
        dmg: B.dmg * Math.pow(B.falloff, nd) * (1 + (L.level - 1) * this.cfg.level.ability) });
    }
    // 毒の感染
    if (cause === 'poison' && L.element === 'toxic') {
      const T = this.cfg.elements.toxic.poison;
      const near = this.queryPrey(p.x, p.y, T.spread, []);
      let n = 0;
      for (const q of near) {
        if (q === p || q.poison) continue;
        q.poison = { lin, t: T.dur, dps: T.dps * (q.type === 'beast' ? 3 : 1) };
        this.emit({ type: 'infect', x: p.x, y: p.y, tx: q.x, ty: q.y, lin });
        if (++n >= T.spreadMax) break;
      }
    }
  }

  explode(ex) {
    const L = this.lineages.get(ex.lin);
    if (!L) return;
    L.stats.explosions++;
    const c = (this.chains.get(ex.chainId) || { n: 0, t: 0, lin: ex.lin });
    c.n++; c.t = this.time; this.chains.set(ex.chainId, c);
    if (c.n > L.stats.maxChain) L.stats.maxChain = c.n;
    if (c.n === 10) L.stats.chains10++;
    this.emit({ type: 'explode', x: ex.x, y: ex.y, r: ex.radius, lin: ex.lin, chain: c.n, depth: ex.depth, chainId: ex.chainId });
    const hit = this.queryPrey(ex.x, ex.y, ex.radius, []);
    for (const p of hit) {
      const dmg = p.type === 'beast' ? ex.dmg * 2 : ex.dmg;
      this.damagePrey(p, dmg, ex.lin, 'explosion', null, ex.chainId, ex.depth);
    }
  }

  // 獲物の密集地（重み付き）を探す
  densityPoint(L, s, weights) {
    const C = 100, gw = Math.ceil(this.W / C), gh = Math.ceil(this.H / C);
    const cnt = new Float32Array(gw * gh);
    for (const p of this.prey) {
      if (!p.alive) continue;
      const w = weights[p.type] || 0; if (!w) continue;
      cnt[clamp((p.y / C) | 0, 0, gh - 1) * gw + clamp((p.x / C) | 0, 0, gw - 1)] += w;
    }
    let best = -1, bx = s.x, by = s.y;
    for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
      // 3x3で平滑化
      let v = 0;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const x = gx + ox, y = gy + oy;
        if (x >= 0 && y >= 0 && x < gw && y < gh) v += cnt[y * gw + x] * (ox === 0 && oy === 0 ? 1 : 0.5);
      }
      const cx = (gx + 0.5) * C, cy = (gy + 0.5) * C;
      const score = v / (1 + len(cx - s.x, cy - s.y) / 700);
      if (score > best) { best = score; bx = cx; by = cy; }
    }
    return { x: bx, y: by, v: best };
  }

  pickTarget(s, L, e, claims) {
    const F = e.F, pol = e.pol;
    let best = null, bs = 0;
    const sense = e.sense;
    for (const p of this.prey) {
      if (!p.alive) continue;
      let w = F.weights[p.type] || 0;
      if (!w) continue;
      if (p.type === 'beast') w *= pol.beastBias;
      const d = len(p.x - s.x, p.y - s.y);
      if (d > sense) continue;
      let sc = w * this.cfg.prey[p.type].mana / (d + 80);
      if (p.type === 'beast' && !(F.breath)) {
        // 龍以外は弱っていない大型獣を避ける
        sc *= p.hp / p.maxHp < 0.3 ? 1 : 0.05;
      }
      if (claims) { const c = claims.get(p.id) || 0; sc /= (1 + c * 3); }
      if (sc > bs) { bs = sc; best = p; }
    }
    return best;
  }

  // ---------------- スライム更新 ----------------
  updateSlimes(dt) {
    const claims = new Map();
    for (const s of this.slimes) if (s.alive && s.target && s.target.alive) claims.set(s.target.id, (claims.get(s.target.id) || 0) + 1);
    const tmp = [];
    // 血統単位の処理
    for (const L of this.lineages.values()) {
      const F = this.formOf(L);
      L.stats.time += dt;
      const mine = this.slimes.filter(s => s.alive && s.lin === L.id && s.kind !== 'infector');
      L.pop = mine.length;
      L.stats.popTime += mine.length * dt;
      if (mine.length > L.stats.popMax) L.stats.popMax = mine.length;
      if (mine.length === 0) {
        L.respawnT -= dt;
        if (L.respawnT <= 0) {
          const s = this.spawnSlime(L, L.home.x, L.home.y, { kind: this.isMulti(L) ? 'unit' : 'main', mass: L.respawnMass || 1,
            nutri: F.split ? F.split.cost : 0 });
          this.emit({ type: 'respawn', x: s.x, y: s.y, lin: L.id });
        }
      }
      if (F.flock) {
        L.marchT -= dt;
        if (L.marchT <= 0 && mine.length) {
          L.marchT = 5;
          let cx = 0, cy = 0; for (const s of mine) { cx += s.x; cy += s.y; } cx /= mine.length; cy /= mine.length;
          L.marchPoint = this.densityPoint(L, { x: cx, y: cy }, F.weights);
        }
      }
      if (L.element === 'steam') {
        const C = this.cfg.elements.steam.cloud;
        L.cloudT -= dt;
        if (L.cloudT <= 0) {
          L.cloudT = C.every;
          const srcs = mine.length > 4 ? mine.filter((_, i) => i % Math.ceil(mine.length / 4) === 0) : mine;
          for (const s of srcs) {
            const r = C.r * (mine.length > 4 ? 0.6 : 1) * Math.max(1, Math.cbrt(s.mass));
            this.hazards.push({ kind: 'steam', x: s.x, y: s.y, r, t: C.life, life: C.life, dps: 0, lin: L.id });
            this.emit({ type: 'steam', x: s.x, y: s.y, r, lin: L.id });
          }
        }
      }
      if (F.flock && mine.length) {
        let ax = 0, ay = 0, cx = 0, cy = 0;
        for (const s of mine) { ax += s.vx; ay += s.vy; cx += s.x; cy += s.y; }
        L.flockV = { x: ax / mine.length, y: ay / mine.length };
        L.flockC = { x: cx / mine.length, y: cy / mine.length };
      }
    }

    const born = [];
    for (const s of this.slimes) {
      if (!s.alive) continue;
      const L = this.lineages.get(s.lin);
      if (!L) { s.alive = false; continue; }
      const e = this.eff(s, L), F = e.F;
      s.age += dt;
      s.breathing = false;
      s.combatT -= dt;
      L.stats.slimeTime += dt;

      // ---- 自爆感染体の子体 ----
      if (s.kind === 'infector') {
        const I = F.infector;
        if (!I) { s.alive = false; continue; }
        s.life -= dt;
        if (s.life <= 0) { this.selfDestruct(s, L, I); continue; }
        if (!s.target || !s.target.alive || (s.retarget -= dt) <= 0) {
          s.retarget = 0.5;
          const dp = this.densityPoint(L, s, { mite: 3, hopper: 0.5, grub: 1 });
          const near = this.queryPrey(dp.x, dp.y, 80, tmp);
          s.target = near.find(p => p.type !== 'beast') || null;
          s.goal = dp;
        }
        const g = s.target || s.goal;
        if (g) this.steer(s, g.x - s.x, g.y - s.y, I.speed, 500, dt);
        this.integrate(s, L, dt);
        const hits = this.queryPrey(s.x, s.y, s.r + 2, tmp);
        if (hits.length) this.selfDestruct(s, L, I);
        continue;
      }

      // ---- 成長・維持費 ----
      if (F.split) {
        s.nutri -= F.split.upkeep * dt;
        if (s.nutri < 0) {
          s.nutri = 0; s.hp -= s.maxHp * 0.12 * dt; s.state = 'starve';
          if (s.hp <= 0) { this.killSlime(s, 'starve'); continue; }
        }
        const reserve = F.split.cost * e.pol.splitReserve;
        if (s.nutri >= F.split.cost + reserve && L.pop < e.cap) {
          s.nutri -= F.split.cost;
          const a = this.rng() * TAU;
          const c = this.spawnSlime(L, s.x + Math.cos(a) * s.r, s.y + Math.sin(a) * s.r, { kind: 'unit', nutri: F.split.cost * 0.35 });
          c.vx = Math.cos(a) * 140; c.vy = Math.sin(a) * 140;
          L.pop++; L.stats.splits++;
          born.push(c);
          this.emit({ type: 'split', x: s.x, y: s.y, lin: L.id, r: s.r });
        }
      } else if (s.nutri > 0) {
        const take = Math.min(s.nutri, 6 * dt + s.nutri * 0.5 * dt);
        s.nutri -= take;
        if (s.mass < F.massCap) s.mass = Math.min(F.massCap, s.mass + take * 0.012);
        else s.hp = Math.min(s.maxHp, s.hp + take * 2);
        s.maxHp = e.maxHp; s.r = this.radiusOf(s, L);
      }
      // 自爆感染体：子体を産む
      if (F.infector && s.kind === 'main' && s.nutri >= 0) {
        const I = F.infector;
        s.spawnT = (s.spawnT || 0) - dt;
        const nInf = this.slimes.filter(o => o.alive && o.lin === L.id && o.kind === 'infector').length;
        if (s.spawnT <= 0 && nInf < I.cap) {
          s.spawnT = 1.4;
          const a = this.rng() * TAU;
          const c = this.spawnSlime(L, s.x + Math.cos(a) * s.r, s.y + Math.sin(a) * s.r, { kind: 'infector', life: I.life });
          c.vx = Math.cos(a) * 120; c.vy = Math.sin(a) * 120;
          born.push(c);
          L.stats.infectors++;
          this.emit({ type: 'spawnInfector', x: s.x, y: s.y, lin: L.id });
        }
      }
      // 回復
      s.hp = Math.min(s.maxHp, s.hp + s.maxHp * (s.combatT > 0 ? 0.004 : 0.02) * dt);

      // ---- 休眠（龍）----
      if (F.regenRest) {
        if (s.state !== 'rest' && s.hp < s.maxHp * 0.35 && !(s.combatT > 0 && s.target && s.target.hp / s.target.maxHp < 0.25)) {
          s.state = 'rest'; s.target = null;
        }
        if (s.state === 'rest') {
          s.hp = Math.min(s.maxHp, s.hp + F.regenRest * dt * Math.sqrt(s.mass));
          L.stats.restTime += dt;
          this.steer(s, 0, 0, 0, e.accel, dt);
          this.integrate(s, L, dt);
          if (s.hp >= s.maxHp * 0.9) s.state = 'wander';
          continue;
        }
      }

      // ---- 逃走 ----
      if (e.pol.fleeHp > 0 && s.hp < s.maxHp * e.pol.fleeHp && !F.breath) {
        const threat = this.prey.find(p => p.alive && p.type === 'beast' && p.aggro === s);
        if (threat) {
          s.state = 'flee'; s.target = null;
          this.steer(s, s.x - threat.x, s.y - threat.y, e.speed * 1.2, e.accel * 1.5, dt);
          this.integrate(s, L, dt);
          continue;
        }
      }

      // ---- 標的選択 ----
      s.retarget -= dt;
      if (!s.target || !s.target.alive || s.retarget <= 0) {
        s.retarget = F.trail && !F.flock ? 0.25 : 0.5;
        const cl = F.split ? claims : null;
        if (s.target && cl) cl.set(s.target.id, Math.max(0, (cl.get(s.target.id) || 1) - 1));
        s.target = this.pickTarget(s, L, e, cl);
        if (s.target && cl) cl.set(s.target.id, (cl.get(s.target.id) || 0) + 1);
        // 密集地探索型：遠くの単体より群れへ向かう
        if (F.seekDensity) {
          L.densT -= 0;
          if (!s.densPoint || (s.densT = (s.densT || 0) - 0.5) <= 0) {
            s.densT = 2; s.densPoint = this.densityPoint(L, s, F.weights);
          }
          if (s.target && len(s.target.x - s.x, s.target.y - s.y) > 110 && s.densPoint) s.target = null;
        }
      }

      // ---- 移動 ----
      const t = s.target;
      if (F.flock && L.marchPoint) {
        // 隊列行進：群れ全体で密集地へ。近くに獲物がいれば突撃
        let dx = L.marchPoint.x - s.x, dy = L.marchPoint.y - s.y; const dl = len(dx, dy) || 1;
        let gx = dx / dl * 1.0, gy = dy / dl * 1.0;
        if (L.flockV) { const vl = len(L.flockV.x, L.flockV.y) || 1; gx += L.flockV.x / vl * 0.6; gy += L.flockV.y / vl * 0.6; }
        if (L.flockC) { gx += (L.flockC.x - s.x) / 150; gy += (L.flockC.y - s.y) / 150; }
        // 分離
        for (const o of this.slimes) {
          if (o === s || !o.alive || o.lin !== s.lin) continue;
          const ox = s.x - o.x, oy = s.y - o.y, od = ox * ox + oy * oy;
          if (od < 400 && od > 0.01) { gx += ox / Math.sqrt(od) * 0.8; gy += oy / Math.sqrt(od) * 0.8; }
        }
        if (t && len(t.x - s.x, t.y - s.y) < 90) { gx += (t.x - s.x) / 30; gy += (t.y - s.y) / 30; s.state = 'hunt'; }
        else s.state = 'march';
        if (dl < 60) L.marchT = Math.min(L.marchT, 0.5);
        this.steer(s, gx, gy, e.speed, e.accel, dt);
      } else if (t) {
        s.state = 'hunt';
        let tx = t.x, ty = t.y;
        if (F.trail || F.impact) { // 高速型は偏差射撃気味に先回り
          const d = len(t.x - s.x, t.y - s.y);
          const lead = Math.min(0.6, d / (e.speed + 1));
          tx += t.vx * lead; ty += t.vy * lead;
        }
        let dx = tx - s.x, dy = ty - s.y;
        const d = len(dx, dy);
        let sp = e.speed;
        if (F.breath) {
          // 龍：吐息の射程で止まって焼く
          s.face = Math.atan2(dy, dx);
          if (d < F.breath.range * 0.55 + t.r) sp = e.speed * 0.25;
        } else if (!F.trail && !F.impact && d < s.r + t.r) sp = e.speed * 0.4;
        if (F.split && !F.trail) { // 群れ：仲間と少し離れる
          for (const o of this.slimes) {
            if (o === s || !o.alive || o.lin !== s.lin) continue;
            const ox = s.x - o.x, oy = s.y - o.y, od = ox * ox + oy * oy;
            if (od < 225 && od > 0.01) { dx += ox * 3; dy += oy * 3; }
          }
        }
        this.steer(s, dx, dy, sp, e.accel, dt);
      } else if (F.seekDensity && s.densPoint) {
        s.state = 'seek';
        this.steer(s, s.densPoint.x - s.x, s.densPoint.y - s.y, e.speed, e.accel, dt);
        if (len(s.densPoint.x - s.x, s.densPoint.y - s.y) < 40) s.densT = 0;
      } else {
        // 徘徊
        s.state = F.breath ? 'prowl' : 'wander';
        s.wanderA += this.rng.range(-1.5, 1.5) * dt * (F.trail ? 3 : 1);
        const sp = F.trail ? e.speed * 0.85 : (F.breath ? e.speed * 0.4 : e.speed * 0.5);
        this.steer(s, Math.cos(s.wanderA), Math.sin(s.wanderA), sp, e.accel, dt);
      }
      this.integrate(s, L, dt);
      const vl = len(s.vx, s.vy);
      if (vl > 5 && !F.breath) s.face = Math.atan2(s.vy, s.vx);
      else if (F.breath && !t && vl > 5) s.face += angDiff(Math.atan2(s.vy, s.vx), s.face) * Math.min(1, dt * 3);

      // ---- 攻撃 ----
      if (F.impact) {
        // 体当たり：通り道の獲物すべてに衝突ダメージ（速度依存）
        const hits = this.queryPrey(s.x, s.y, s.r + 2, tmp);
        const spRatio = clamp(vl / F.speed, 0.3, 1.2);
        for (const p of hits) {
          if (p.type === 'beast' && !(p.hp / p.maxHp < 0.3)) continue;
          const cd = s.hitCd.get(p.id) || 0;
          if (cd > this.time) continue;
          s.hitCd.set(p.id, this.time + 0.3);
          this.damagePrey(p, e.impact * spRatio, L.id, 'impact', s);
        }
        if (s.hitCd.size > 40) for (const [k, v] of s.hitCd) if (v < this.time) s.hitCd.delete(k);
      }
      if (e.atk > 0 && t && t.alive) {
        const d = len(t.x - s.x, t.y - s.y);
        if (d < s.r + t.r + 3) this.damagePrey(t, e.atk * dt, L.id, 'contact', s);
      }
      if (F.breath && t && t.alive) {
        const d = len(t.x - s.x, t.y - s.y);
        if (d < F.breath.range * Math.cbrt(s.mass) * 0.8 + t.r) {
          s.breathing = true;
          const hits = this.queryPrey(s.x + Math.cos(s.face) * F.breath.range * 0.5, s.y + Math.sin(s.face) * F.breath.range * 0.5, F.breath.range * 0.6, tmp);
          for (const p of hits) {
            if (p !== t && p.r < 8) continue; // 小物は眼中にない
            const a = Math.atan2(p.y - s.y, p.x - s.x);
            if (Math.abs(angDiff(a, s.face)) < F.breath.arc) this.damagePrey(p, F.breath.dps * e.ability * Math.sqrt(s.mass) * dt * (p === t ? 1 : 0.5), L.id, 'breath', s);
          }
        }
      }
      if (F.aura) {
        const hits = this.queryPrey(s.x, s.y, s.r * F.aura.mul, tmp);
        for (const p of hits) this.damagePrey(p, F.aura.dps * e.ability * dt, L.id, 'aura', s);
      }
      if (F.trail) {
        s.trailT -= dt;
        if (s.trailT <= 0 && (vl > 40 || F.trail.kind === 'lava')) {
          s.trailT = F.trail.every;
          this.hazards.push({ kind: F.trail.kind || 'fire', x: s.x, y: s.y, r: F.trail.r * (F.trail.kind === 'lava' ? Math.cbrt(s.mass) : 1), t: F.trail.life, life: F.trail.life, dps: F.trail.dps * e.ability, lin: L.id });
        }
      }
    }
    for (const c of born) if (c.alive) {} // 既に配列に追加済み
  }

  selfDestruct(s, L, I) {
    s.alive = false;
    const cid = this.nextId++;
    this.pending.push({ t: this.time, x: s.x, y: s.y, lin: L.id, chainId: cid, depth: 0,
      radius: I.radius * (1 + (L.level - 1) * 0.06), dmg: I.dmg * (1 + (L.level - 1) * this.cfg.level.ability) });
  }

  steer(s, dx, dy, speed, accel, dt) {
    const l = len(dx, dy);
    const tx = l > 0.001 ? dx / l * speed : 0, ty = l > 0.001 ? dy / l * speed : 0;
    let ax = tx - s.vx, ay = ty - s.vy;
    const al = len(ax, ay), maxA = accel * dt;
    if (al > maxA) { ax = ax / al * maxA; ay = ay / al * maxA; }
    s.vx += ax; s.vy += ay;
  }
  integrate(s, L, dt) {
    const ox = s.x, oy = s.y;
    s.x += s.vx * dt; s.y += s.vy * dt;
    const r = s.r;
    if (s.x < r) { s.x = r; s.vx = Math.abs(s.vx) * 0.8; s.wanderA = Math.PI - s.wanderA; }
    if (s.x > this.W - r) { s.x = this.W - r; s.vx = -Math.abs(s.vx) * 0.8; s.wanderA = Math.PI - s.wanderA; }
    if (s.y < r) { s.y = r; s.vy = Math.abs(s.vy) * 0.8; s.wanderA = -s.wanderA; }
    if (s.y > this.H - r) { s.y = this.H - r; s.vy = -Math.abs(s.vy) * 0.8; s.wanderA = -s.wanderA; }
    L.stats.dist += len(s.x - ox, s.y - oy);
  }

  updateHazards(dt) {
    const tmp = [];
    for (const h of this.hazards) {
      h.t -= dt;
      if (h.t <= 0) continue;
      const hits = this.queryPrey(h.x, h.y, h.r, tmp);
      for (const p of hits) {
        if (h.kind === 'steam') { p.slowT = 0.4; continue; }
        if (p.type === 'beast' && h.kind !== 'lava') continue;
        this.damagePrey(p, h.dps * dt, h.lin, h.kind === 'lava' ? 'lava' : 'trail', null);
      }
    }
    this.hazards = this.hazards.filter(h => h.t > 0);
  }

  step(dt = this.cfg.world.dt) {
    this.time += dt;
    this.rebuildGrid();
    this.updatePrey(dt);
    this.rebuildGrid();
    this.updateSlimes(dt);
    this.updateHazards(dt);
    // 遅延爆発
    if (this.pending.length) {
      const now = this.pending.filter(e => e.t <= this.time);
      this.pending = this.pending.filter(e => e.t > this.time);
      for (const ex of now) this.explode(ex);
    }
    if (this.chains.size) for (const [k, c] of this.chains) {
      if (this.time - c.t > 0.6) {
        if (c.n >= 5) this.emit({ type: 'chainEnd', n: c.n, lin: c.lin });
        this.chains.delete(k);
      }
    }
    this.prey = this.prey.filter(p => p.alive);
    this.slimes = this.slimes.filter(s => s.alive);
    this.repopulate(dt);
  }

  // 現在の獲物数
  census() {
    const c = { hopper: 0, mite: 0, grub: 0, beast: 0 };
    for (const p of this.prey) if (p.alive) c[p.type]++;
    return c;
  }
}

export { PREY_TYPES };
