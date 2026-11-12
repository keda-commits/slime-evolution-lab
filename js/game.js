// =============================================================
//  ゲーム進行（ガチャ・進化・血統・セーブ）  DOM非依存
// =============================================================
import { CONFIG, childrenOf } from './config.js';
import { World } from './sim.js';
import { makeRng } from './rng.js';

export const SAVE_KEY = 'slime-evolution-lab-save-v1';
const LIN_COLORS = ['#4ecdc4', '#ffd166', '#ef476f'];
const LIN_IDS = ['A', 'B', 'C'];

export function freshState(seed) {
  return {
    version: CONFIG.version,
    seed,
    mana: CONFIG.economy.startMana,
    inventory: { ...CONFIG.economy.startFactors },
    freePullUsed: false,
    sinceSSR: 0,
    totalPulls: 0,
    lineages: [newLineage(0)],
    selected: 'A',
    playTime: 0,
    manaEarned: 0,
    discovered: { base: true },
    log: [],
    gachaRng: (seed * 7919 + 13) >>> 0,
  };
}

function newLineage(idx) {
  return { id: LIN_IDS[idx], name: '血統' + LIN_IDS[idx], color: LIN_COLORS[idx], form: 'base', element: null,
           level: 1, policy: 'normal', history: ['base'], count: 1, mass: 1, home: null };
}

export class Game {
  constructor({ seed = (Date.now() % 1e9) | 0, storage = null, state = null, cfg = CONFIG } = {}) {
    this.cfg = cfg;
    this.storage = storage;
    this.state = state || freshState(seed);
    this.listeners = [];
    this.buildWorld();
  }

  static load(storage) {
    try {
      const raw = storage && storage.getItem(SAVE_KEY);
      if (!raw) return null;
      const st = JSON.parse(raw);
      if (!st || st.version !== CONFIG.version) return null;
      return new Game({ storage, state: st });
    } catch (e) { console.warn('save load failed', e); return null; }
  }

  save() {
    if (!this.storage) return;
    const st = this.state;
    for (const l of st.lineages) {
      const L = this.world.lineages.get(l.id);
      if (!L) continue;
      const mine = this.world.slimes.filter(s => s.lin === l.id && s.kind !== 'infector');
      l.count = Math.max(1, mine.length);
      l.mass = mine.length ? Math.max(...mine.map(s => s.mass)) : 1;
    }
    st.gachaRng = this.gachaRng.getState();
    try { this.storage.setItem(SAVE_KEY, JSON.stringify(st)); } catch (e) { /* ignore quota */ }
  }

  reset() {
    if (this.storage) this.storage.removeItem(SAVE_KEY);
    this.state = freshState((Date.now() % 1e9) | 0);
    this.buildWorld();
    this.notify('reset');
  }

  buildWorld() {
    const st = this.state;
    this.world = new World(st.seed, this.cfg);
    this.gachaRng = makeRng(st.gachaRng || 1);
    this.world.onMana = (m) => { this.state.mana += m; this.state.manaEarned += m; };
    st.lineages.forEach((l, i) => {
      if (!l.home) l.home = this.homeFor(i);
      this.world.setLineage({ ...l });
    });
  }
  homeFor(i) {
    const W = this.cfg.world.w, H = this.cfg.world.h;
    return [{ x: W * 0.5, y: H * 0.5 }, { x: W * 0.25, y: H * 0.3 }, { x: W * 0.75, y: H * 0.7 }][i];
  }

  on(fn) { this.listeners.push(fn); }
  notify(type, data) { for (const f of this.listeners) f(type, data); }

  tick(dt) {
    this.world.step(dt);
    this.state.playTime += dt;
  }

  lineage(id = this.state.selected) { return this.state.lineages.find(l => l.id === id); }

  // ---------------- ガチャ ----------------
  banner(id) { return this.cfg.gacha.banners.find(b => b.id === id); }
  canFree() { return !this.state.freePullUsed; }
  pullCost(bannerId, n) {
    const b = this.banner(bannerId);
    if (n === 10 && this.canFree() && bannerId === this.cfg.economy.freeTenPullBanner) return 0;
    return n === 10 ? b.cost10 : b.cost1 * n;
  }
  canPull(bannerId, n) { return this.state.mana >= this.pullCost(bannerId, n); }

  drawOne(b, forceSRplus, forceSSR) {
    const F = this.cfg.factors;
    let entries = Object.entries(b.rates);
    if (forceSSR) entries = entries.filter(([k]) => F[k].rarity === 'SSR');
    else if (forceSRplus) entries = entries.filter(([k]) => F[k].rarity !== 'R');
    const total = entries.reduce((a, [, w]) => a + w, 0);
    let r = this.gachaRng() * total;
    for (const [k, w] of entries) { r -= w; if (r <= 0) return k; }
    return entries[entries.length - 1][0];
  }

  // 抽選本体：純粋な乱数＋明示された保証のみ。
  pull(bannerId, n) {
    const st = this.state, b = this.banner(bannerId), G = this.cfg.gacha;
    const cost = this.pullCost(bannerId, n);
    if (st.mana < cost) return null;
    const wasFree = cost === 0 && n === 10;
    st.mana -= cost;
    if (wasFree) st.freePullUsed = true;
    const beforeAvail = this.allAvailableKeys();
    const beforeInv = { ...st.inventory };
    const results = [];
    for (let i = 0; i < n; i++) {
      const ceiling = st.sinceSSR + 1 >= G.ssrCeiling;
      const guaranteeSR = n === 10 && i === 9 && G.tenPullGuaranteeSR && !results.some(f => this.cfg.factors[f].rarity !== 'R');
      const f = this.drawOne(b, guaranteeSR, ceiling);
      if (this.cfg.factors[f].rarity === 'SSR') st.sinceSSR = 0; else st.sinceSSR++;
      st.inventory[f] = (st.inventory[f] || 0) + 1;
      results.push(f);
    }
    st.totalPulls += n;
    const afterAvail = this.allAvailableKeys();
    const newly = afterAvail.filter(k => !beforeAvail.includes(k));
    const wanted = this.wantedFactors(beforeInv);
    const cards = results.map(f => ({
      factor: f, rarity: this.cfg.factors[f].rarity,
      isNew: !beforeInv[f] && results.indexOf(f) === results.indexOf(f),
      wanted: wanted.has(f),
    }));
    // 同じ因子で "NEW" は最初の1枚だけ
    const seen = new Set();
    for (const c of cards) { if (c.isNew) { if (seen.has(c.factor)) c.isNew = false; seen.add(c.factor); } }
    const res = { banner: bannerId, cards, newly: newly.map(k => this.parseKey(k)), free: wasFree };
    this.log(`ガチャ ${b.name} ${n}回${wasFree ? '（無料）' : ''}`);
    this.notify('pull', res);
    this.save();
    return res;
  }

  // ---------------- 進化 ----------------
  // 指定血統が次に進化できる候補（形態 + 属性変異）
  options(lin) {
    const F = this.cfg.forms, out = [];
    for (const id of childrenOf(lin.form)) out.push({ kind: 'form', id, def: F[id] });
    if (F[lin.form].tier >= 1 && !lin.element) {
      for (const [id, def] of Object.entries(this.cfg.elements)) out.push({ kind: 'element', id, def });
    }
    return out;
  }
  missing(def, inv = this.state.inventory) {
    const m = {};
    for (const [k, n] of Object.entries(def.recipe)) { const have = inv[k] || 0; if (have < n) m[k] = n - have; }
    return m;
  }
  canEvolve(lin, opt) {
    return Object.keys(this.missing(opt.def)).length === 0 && this.state.mana >= (opt.def.mana || 0);
  }
  factorsReady(opt, inv = this.state.inventory) { return Object.keys(this.missing(opt.def, inv)).length === 0; }

  allAvailableKeys(inv = this.state.inventory) {
    const keys = [];
    for (const l of this.state.lineages) for (const o of this.options(l)) {
      if (this.factorsReady(o, inv)) keys.push(`${l.id}:${o.kind}:${o.id}`);
    }
    return keys;
  }
  parseKey(k) {
    const [lin, kind, id] = k.split(':');
    return { lin, kind, id, name: kind === 'form' ? this.cfg.forms[id].name : this.cfg.elements[id].name + '化' };
  }
  // 今の血統たちの「次の進化」に足りない因子
  wantedFactors(inv = this.state.inventory) {
    const w = new Set();
    for (const l of this.state.lineages) for (const o of this.options(l)) {
      for (const k of Object.keys(this.missing(o.def, inv))) w.add(k);
    }
    return w;
  }

  evolve(linId, kind, id) {
    const st = this.state, lin = this.lineage(linId);
    const opt = this.options(lin).find(o => o.kind === kind && o.id === id);
    if (!opt || !this.canEvolve(lin, opt)) return false;
    for (const [k, n] of Object.entries(opt.def.recipe)) st.inventory[k] -= n;
    st.mana -= opt.def.mana || 0;
    if (kind === 'form') { lin.form = id; lin.history.push(id); st.discovered[id] = true; }
    else { lin.element = id; st.discovered['el:' + id] = true; }
    this.world.setLineage({ ...lin });
    if (kind === 'element') {
      for (const s of this.world.slimes) if (s.lin === lin.id) this.world.emit({ type: 'evolve', x: s.x, y: s.y, r: s.r, lin: lin.id, form: lin.form });
    }
    this.log(`${lin.name} が ${kind === 'form' ? this.cfg.forms[id].name : this.cfg.elements[id].name + '化'} に進化`);
    this.notify('evolve', { lin: linId, kind, id });
    this.save();
    return true;
  }

  // 転生：基本スライムに戻して別系統を試す（使った因子は戻らない。レベルは維持）
  rebirth(linId) {
    const lin = this.lineage(linId);
    if (lin.form === 'base') return false;
    lin.form = 'base'; lin.element = null; lin.history.push('base');
    this.world.setLineage({ ...lin });
    this.log(`${lin.name} が転生（基本スライムへ）`);
    this.notify('evolve', { lin: linId, kind: 'rebirth' });
    this.save();
    return true;
  }

  // 共鳴強化：その血統の進化経路で使った因子（または硬化・感知）を1つ注入してLv+1
  resonanceFactors(lin) {
    const used = new Set(['harden', 'sense']);
    for (const f of lin.history) for (const k of Object.keys(this.cfg.forms[f].recipe)) used.add(k);
    if (lin.element) for (const k of Object.keys(this.cfg.elements[lin.element].recipe)) if (k !== 'core') used.add(k);
    return [...used];
  }
  resonanceCost(lin) { return this.cfg.economy.resonanceManaCost * lin.level; }
  resonate(linId, factor) {
    const lin = this.lineage(linId), st = this.state;
    if (lin.level >= this.cfg.economy.resonanceMaxLevel) return false;
    if (!this.resonanceFactors(lin).includes(factor) || !(st.inventory[factor] > 0)) return false;
    const cost = this.resonanceCost(lin);
    if (st.mana < cost) return false;
    st.inventory[factor]--; st.mana -= cost;
    lin.level++;
    this.world.setLineage({ ...lin });
    for (const s of this.world.slimes) if (s.lin === lin.id) this.world.emit({ type: 'levelup', x: s.x, y: s.y, r: s.r, lin: lin.id });
    this.log(`${lin.name} 共鳴強化 Lv${lin.level}`);
    this.notify('resonate', { lin: linId });
    this.save();
    return true;
  }

  // ---------------- 血統 ----------------
  branchCost() { return this.cfg.economy.branchCost[this.state.lineages.length] ?? Infinity; }
  canBranch() { return this.state.lineages.length < this.cfg.economy.maxLineages && this.state.mana >= this.branchCost(); }
  branch() {
    if (!this.canBranch()) return false;
    const st = this.state;
    st.mana -= this.branchCost();
    const idx = st.lineages.length;
    const l = newLineage(idx);
    l.home = this.homeFor(idx);
    st.lineages.push(l);
    this.world.setLineage({ ...l });
    this.world.emit({ type: 'respawn', x: l.home.x, y: l.home.y, lin: l.id });
    st.selected = l.id;
    this.log(`新しい血統 ${l.name} を分岐`);
    this.notify('branch', { lin: l.id });
    this.save();
    return true;
  }
  setPolicy(linId, policy) {
    const lin = this.lineage(linId);
    lin.policy = policy;
    this.world.setLineage({ ...lin });
    this.save();
  }

  log(msg) {
    const t = Math.floor(this.state.playTime);
    this.state.log.unshift({ t, msg });
    if (this.state.log.length > 40) this.state.log.length = 40;
  }
}
