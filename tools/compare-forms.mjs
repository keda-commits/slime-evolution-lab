// 形態比較テスト：同じシード・同じ環境で各進化形態を単独で動かし、行動指標を比較する。
//   node tools/compare-forms.mjs [秒数=240] [シード...]
import { World } from '../js/sim.js';
import { CONFIG } from '../js/config.js';

const T = Number(process.argv[2] || 240);
const seeds = process.argv.slice(3).map(Number);
if (!seeds.length) seeds.push(11, 22, 33);

const variants = [
  { form: 'base' }, { form: 'fireball' }, { form: 'legion' }, { form: 'chain' }, { form: 'dragon' },
  { form: 'fireDance' }, { form: 'march' }, { form: 'infect' }, { form: 'lavaTitan' },
  { form: 'chain', element: 'steam' }, { form: 'legion', element: 'toxic' },
];

function run(seed, v) {
  const w = new World(seed);
  w.recordEvents = true;
  w.setLineage({ id: 'A', name: 'A', color: '#fff', form: v.form, element: v.element || null, level: 1, policy: 'normal', home: { x: 800, y: 500 } });
  let ev = { split: 0, explode: 0, engulf: 0, steam: 0, infect: 0 };
  const startCensus = w.census();
  let minCensus = { ...startCensus };
  let speedSum = 0, speedN = 0, targetSizeSum = 0, targetN = 0;
  const steps = Math.round(T / CONFIG.world.dt);
  for (let i = 0; i < steps; i++) {
    w.step();
    for (const e of w.events) {
      if (e.type === 'split') ev.split++;
      if (e.type === 'explode') ev.explode++;
      if (e.type === 'kill' && e.engulf) ev.engulf++;
      if (e.type === 'infect') ev.infect++;
    }
    w.events.length = 0;
    if (i % 15 === 0) {
      const c = w.census();
      for (const k in c) minCensus[k] = Math.min(minCensus[k], c[k]);
      for (const s of w.slimes) {
        if (s.kind === 'infector') continue;
        speedSum += Math.hypot(s.vx, s.vy); speedN++;
        if (s.target && s.target.alive) { targetSizeSum += s.target.r; targetN++; }
      }
    }
  }
  const L = w.lineages.get('A');
  const st = L.stats;
  const killsTotal = Object.values(st.kills).reduce((a, b) => a + b, 0);
  const s = w.slimes.filter(x => x.kind !== 'infector');
  return {
    name: CONFIG.forms[v.form].name + (v.element ? '+' + CONFIG.elements[v.element].name : ''),
    manaPerMin: st.mana / T * 60,
    kills: killsTotal,
    killMix: st.kills,
    avgSpeed: speedSum / Math.max(1, speedN),
    distPerSlimeSec: st.dist / Math.max(1, st.slimeTime),
    avgTargetR: targetN ? targetSizeSum / targetN : 0,
    avgPop: st.popTime / T, maxPop: st.popMax,
    maxChain: st.maxChain, explosions: st.explosions, chains10: st.chains10,
    splits: st.splits, deaths: st.deaths, starved: st.starved, dmgTaken: st.dmgTaken,
    restPct: st.restTime / T * 100,
    finalSize: s.length ? Math.max(...s.map(x => x.r)) : 0,
    causes: st.causes,
    minCensus,
  };
}

const agg = {};
for (const seed of seeds) for (const v of variants) {
  const r = run(seed, v);
  (agg[r.name] ||= []).push(r);
}
const avg = (arr, f) => arr.reduce((a, x) => a + f(x), 0) / arr.length;
const pct = (arr, k) => {
  const tot = avg(arr, x => Object.values(x.killMix).reduce((a, b) => a + b, 0)) || 1;
  return Math.round(avg(arr, x => x.killMix[k]) / tot * 100);
};
const fmt = (n, d = 0) => Number(n).toFixed(d);
const rows = [];
rows.push(`形態比較  T=${T}s  seeds=${seeds.join(',')}  （各値はシード平均）`);
rows.push('');
rows.push('| 形態 | 魔素/分 | 捕食数 | 跳ね虫% | 群れ蟲% | 丸虫% | 角獣% | 平均速度 | 移動距離/体/秒 | 標的平均半径 | 平均個体数 | 最大連鎖 | 爆発数 | 分裂 | 死亡(餓死) | 休眠% | 最終サイズ |');
rows.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const [name, arr] of Object.entries(agg)) {
  rows.push(`| ${name} | ${fmt(avg(arr, x => x.manaPerMin))} | ${fmt(avg(arr, x => x.kills))} | ${pct(arr, 'hopper')} | ${pct(arr, 'mite')} | ${pct(arr, 'grub')} | ${pct(arr, 'beast')} | ${fmt(avg(arr, x => x.avgSpeed))} | ${fmt(avg(arr, x => x.distPerSlimeSec))} | ${fmt(avg(arr, x => x.avgTargetR), 1)} | ${fmt(avg(arr, x => x.avgPop), 1)} | ${fmt(Math.max(...arr.map(x => x.maxChain)))} | ${fmt(avg(arr, x => x.explosions))} | ${fmt(avg(arr, x => x.splits))} | ${fmt(avg(arr, x => x.deaths), 1)}(${fmt(avg(arr, x => x.starved), 1)}) | ${fmt(avg(arr, x => x.restPct))} | ${fmt(avg(arr, x => x.finalSize))} |`);
}
rows.push('');
rows.push('捕食手段の内訳（シード1）:');
for (const [name, arr] of Object.entries(agg)) rows.push(`- ${name}: ${JSON.stringify(arr[0].causes)}`);
// ---- 判定：4形態の行動が明確に異なるか ----
const A = (n) => agg[CONFIG.forms[n].name];
const killPct = (arr, k) => avg(arr, x => x.killMix[k]) / Math.max(1, avg(arr, x => Object.values(x.killMix).reduce((a, b) => a + b, 0)));
const checks = [
  ['火達磨: 平均速度が他の基本形態の2倍以上', avg(A('fireball'), x => x.avgSpeed) > 2 * Math.max(avg(A('legion'), x => x.avgSpeed), avg(A('chain'), x => x.avgSpeed), avg(A('dragon'), x => x.avgSpeed))],
  ['火達磨: 捕食の最多が跳ね虫（小型・素早い）', killPct(A('fireball'), 'hopper') > 0.4],
  ['炎の軍勢: 平均個体数が5体以上', avg(A('legion'), x => x.avgPop) >= 5],
  ['炎の軍勢系: 餓死が発生する（維持費の短所）', avg(A('legion'), x => x.starved) + avg(A('march'), x => x.starved) > 0],
  ['連鎖爆破: 最大連鎖10以上 & 捕食の過半が爆発', Math.max(...A('chain').map(x => x.maxChain)) >= 10 && avg(A('chain'), x => (x.causes.explosion || 0) / Math.max(1, x.kills)) > 0.5],
  ['灼熱龍: 捕食の50%以上が角獣（大型）', killPct(A('dragon'), 'beast') > 0.5],
  ['灼熱龍: 小型獲物（跳ね虫・群れ蟲）をほぼ食べない', killPct(A('dragon'), 'hopper') + killPct(A('dragon'), 'mite') < 0.1],
  ['灼熱龍: 最終サイズが他の基本形態の1.5倍以上', avg(A('dragon'), x => x.finalSize) > 1.5 * Math.max(avg(A('fireball'), x => x.finalSize), avg(A('chain'), x => x.finalSize), avg(A('legion'), x => x.finalSize))],
  ['基本4形態の魔素効率の差が3倍以内（どれも選ぶ価値がある）', (() => { const v = ['fireball', 'legion', 'chain', 'dragon'].map(n => avg(A(n), x => x.manaPerMin)); return Math.max(...v) / Math.min(...v) < 3; })()],
];
rows.push('');
rows.push('判定:');
for (const [n, ok] of checks) rows.push(`- ${ok ? 'PASS' : 'FAIL'} ${n}`);
console.log(rows.join('\n'));
if (process.env.OUT) { (await import('fs')).writeFileSync(process.env.OUT, rows.join('\n') + '\n'); }
if (checks.some(c => !c[1])) process.exitCode = 1;
