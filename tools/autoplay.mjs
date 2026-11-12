// 自動プレイテスト：15分相当を複数シードで実行し、ガチャ→進化の進行が詰まらないか確認する。
//   node tools/autoplay.mjs [分=15] [シード数=8]
import { Game } from '../js/game.js';
import { CONFIG } from '../js/config.js';

const MIN = Number(process.argv[2] || 15);
const NSEED = Number(process.argv[3] || 8);
const DT = CONFIG.world.dt;

function mem() { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: k => m.delete(k) }; }

// 欲しい因子が最も効率よく出るガチャ
function bestBanner(g, wanted) {
  let best = null, bs = -1;
  for (const b of CONFIG.gacha.banners) {
    const p = [...wanted].reduce((a, f) => a + (b.rates[f] || 0), 0) / b.cost1;
    if (p > bs) { bs = p; best = b; }
  }
  return best;
}

function play(seed, strategy) {
  const g = new Game({ seed, storage: mem() });
  const rng = (() => { let a = seed * 31 + 7; return () => ((a = (a * 1103515245 + 12345) >>> 0) / 4294967296); })();
  const T = MIN * 60;
  const timeline = [];
  const formsSeen = new Set(['base']);
  let lastAction = 0, maxGap = 0, gapAt = 0, pulls = 0, firstEvo = null, firstTier2 = null, firstElem = null, firstSSR = null;
  const manaWin = []; let lastMana = 0;
  const finalStint = {};
  let t = 0, nextThink = 3;
  const act = (msg) => { timeline.push(`${t.toFixed(0)}s ${msg}`); const gap = t - lastAction; if (gap > maxGap) { maxGap = gap; gapAt = lastAction; } lastAction = t; };
  while (t < T) {
    g.tick(DT); t += DT;
    if (Math.floor(t / 60) > manaWin.length - 1 && Math.floor(t) % 60 === 0 && t - Math.floor(t) < DT) {
      manaWin.push(Math.round(g.state.manaEarned - lastMana)); lastMana = g.state.manaEarned;
    }
    if (t < nextThink) continue;
    nextThink = t + 1;
    const st = g.state;
    // 1) 無料10連
    if (g.canFree()) { const r = g.pull('standard', 10); pulls += 10; act(`無料10連: ${r.cards.map(c => CONFIG.factors[c.factor].name).join(',')}`); if (r.cards.some(c => c.rarity === 'SSR')) firstSSR ??= t; continue; }
    // 2) 進化
    let did = false;
    for (const lin of st.lineages) {
      const opts = g.options(lin).filter(o => g.canEvolve(lin, o));
      if (!opts.length) continue;
      const forms = opts.filter(o => o.kind === 'form');
      const pool = forms.length ? forms : opts;
      let o;
      if (strategy === 'goal') {
        // 未体験の形態を優先
        o = pool.find(x => x.kind === 'form' && !formsSeen.has(x.id)) || pool[0];
      } else o = pool[Math.floor(rng() * pool.length)];
      g.evolve(lin.id, o.kind, o.id);
      if (o.kind === 'form') formsSeen.add(o.id);
      act(`${lin.name} → ${o.kind === 'form' ? CONFIG.forms[o.id].name : CONFIG.elements[o.id].name}`);
      firstEvo ??= t;
      if (o.kind === 'form' && CONFIG.forms[o.id].tier === 2) firstTier2 ??= t;
      if (o.kind === 'element') firstElem ??= t;
      lin._since = t;
      did = true; break;
    }
    if (did) continue;
    // 3) 血統分岐（全血統が1段階以上進化していて余裕がある）
    if (g.canBranch() && st.lineages.every(l => l.form !== 'base') && st.mana >= g.branchCost() + 200) {
      g.branch(); act(`血統分岐 → ${st.lineages.length}本`); continue;
    }
    // 4) 探索型：最終形態で90秒経ったら、因子が揃っている未体験の基本形態へ転生
    if (strategy === 'goal') {
      for (const lin of st.lineages) {
        if (lin.form === 'base') continue;
        const done = g.options(lin).length === 0 || (CONFIG.forms[lin.form].tier === 2 && lin.element);
        if (done && t - (lin._since || 0) > 90) {
          const untried = ['fireball', 'legion', 'chain', 'dragon'].filter(f => !formsSeen.has(f) && Object.keys(g.missing(CONFIG.forms[f])).length === 0);
          if (untried.length) { g.rebirth(lin.id); act(`${lin.name} 転生`); did = true; break; }
        }
      }
      if (did) continue;
    }
    // 5) ガチャ：次の進化に足りない因子を狙う（因子が揃って魔素待ちの進化があれば貯める）
    const saving = st.lineages.some(l => g.options(l).some(o => g.factorsReady(o) && st.mana < (o.def.mana || 0)));
    if (saving) continue;
    const wanted = g.wantedFactors();
    const onlyRare = [...wanted].every(k => CONFIG.factors[k].rarity === 'SSR');
    if (onlyRare && st.lineages.length < CONFIG.economy.maxLineages && st.mana < g.branchCost() + 200) continue;
    if (wanted.size) {
      const b = bestBanner(g, wanted);
      const n = st.mana >= b.cost10 ? 10 : (st.mana >= b.cost1 * 3 ? 1 : 0);
      if (n) {
        const r = g.pull(b.id, n); pulls += n;
        const hits = r.cards.filter(c => c.wanted).map(c => CONFIG.factors[c.factor].name);
        if (r.cards.some(c => c.rarity === 'SSR')) firstSSR ??= t;
        act(`${b.name} ${n}回 ${hits.length ? '当たり:' + hits.join(',') : 'はずれ'}${r.newly.length ? ' 解放:' + r.newly.map(x => x.name).join(',') : ''}`);
        continue;
      }
    }
    // 6) 共鳴強化
    for (const lin of st.lineages) {
      const f = g.resonanceFactors(lin).find(k => (st.inventory[k] || 0) > 1);
      if (f && lin.level < CONFIG.economy.resonanceMaxLevel && st.mana > g.resonanceCost(lin) + 300) { g.resonate(lin.id, f); act(`${lin.name} 共鳴 Lv${lin.level}`); break; }
    }
  }
  const gap = T - lastAction; if (gap > maxGap) { maxGap = gap; gapAt = lastAction; }
  return { seed, strategy, firstEvo, firstTier2, firstElem, firstSSR, pulls, formsSeen: [...formsSeen], maxGap, gapAt,
    lineages: g.state.lineages.map(l => `${l.name}:${CONFIG.forms[l.form].name}${l.element ? '+' + CONFIG.elements[l.element].name : ''} Lv${l.level}`),
    manaWin, manaEarned: Math.round(g.state.manaEarned), timeline };
}

const out = [];
const results = [];
for (const strategy of ['random', 'goal']) for (let i = 0; i < NSEED; i++) results.push(play(1000 + i * 17, strategy));
out.push(`自動プレイ ${MIN}分 × ${NSEED}シード × 2戦略`);
out.push('');
out.push('| 戦略 | seed | 初進化 | 初tier2 | 初属性 | 初SSR | ガチャ回数 | 体験形態数 | 最長無操作 | 最終血統 |');
out.push('|---|---|---|---|---|---|---|---|---|---|');
const f = v => v == null ? '—' : v.toFixed(0) + 's';
for (const r of results) out.push(`| ${r.strategy} | ${r.seed} | ${f(r.firstEvo)} | ${f(r.firstTier2)} | ${f(r.firstElem)} | ${f(r.firstSSR)} | ${r.pulls} | ${r.formsSeen.length} | ${r.maxGap.toFixed(0)}s (@${r.gapAt.toFixed(0)}s) | ${r.lineages.join(' / ')} |`);
out.push('');
const mean = (k) => results.reduce((a, r) => a + (r[k] ?? 0), 0) / results.length;
out.push(`平均: 初進化 ${mean('firstEvo').toFixed(0)}s / ガチャ ${mean('pulls').toFixed(0)}回 / 体験形態 ${(results.reduce((a, r) => a + r.formsSeen.length, 0) / results.length).toFixed(1)} / 最長無操作 ${mean('maxGap').toFixed(0)}s`);
out.push(`tier2到達率: ${results.filter(r => r.firstTier2 != null).length}/${results.length}  属性変異到達率: ${results.filter(r => r.firstElem != null).length}/${results.length}`);
out.push('');
out.push('毎分の魔素獲得（seed ' + results[0].seed + ', random）: ' + results[0].manaWin.join(', '));
out.push('毎分の魔素獲得（seed ' + results[NSEED].seed + ', goal）: ' + results[NSEED].manaWin.join(', '));
out.push('');
out.push('タイムライン例（goal, seed ' + results[NSEED].seed + '）:');
out.push(...results[NSEED].timeline.slice(0, 60).map(x => '  ' + x));
const checks = [
  ['全シードで60秒以内に初進化', results.every(r => r.firstEvo != null && r.firstEvo <= 60)],
  ['全シードでtier2（追加進化）に到達', results.every(r => r.firstTier2 != null)],
  ['全シードで5分以内に2回目の進化', results.every(r => r.firstTier2 != null && r.firstTier2 <= 300)],
  ['平均で3形態以上を体験', results.reduce((a, r) => a + r.formsSeen.length, 0) / results.length >= 3],
];
out.splice(1, 0, '', '判定:', ...checks.map(([n, ok]) => `- ${ok ? 'PASS' : 'FAIL'} ${n}`));
console.log(out.join('\n'));
if (process.env.OUT) (await import('fs')).writeFileSync(process.env.OUT, out.join('\n') + '\n');
if (checks.some(c => !c[1])) process.exitCode = 1;
