// 形態比較ラボ：同一シードの世界を4つ並べ、それぞれ別形態の血統を1つだけ置いて比較する。
//   lab.html?seed=42&forms=fireball,legion,chain,dragon
import { CONFIG } from './config.js';
import { World } from './sim.js';
import { Renderer } from './render.js';

const q = new URLSearchParams(location.search);
const canvas = document.getElementById('labCanvas');
const wrap = document.getElementById('labWrap');
let forms = (q.get('forms') || 'fireball,legion,chain,dragon').split(',');
let seed = Number(q.get('seed') || 42);
document.getElementById('seed').value = seed;
let speed = 1, paused = false;
let cells = [];

const OPTIONS = [...Object.keys(CONFIG.forms).map(f => ({ v: f, n: CONFIG.forms[f].name })),
  { v: 'chain+steam', n: '連鎖爆破+蒸気' }, { v: 'fireball+steam', n: '火達磨+蒸気' }, { v: 'legion+toxic', n: '炎の軍勢+毒炎' }, { v: 'dragon+toxic', n: '灼熱龍+毒炎' }];

function build() {
  for (const c of cells) c.hud.remove();
  cells = forms.map((spec, i) => {
    const [form, element] = spec.split('+');
    const w = new World(seed);
    w.setLineage({ id: 'A', name: 'A', color: '#4ecdc4', form, element: element || null, level: 1, policy: 'normal', home: { x: w.W / 2, y: w.H / 2 } });
    const r = new Renderer(canvas, w, { compact: true, showLinks: true });
    r.selected = 'A';
    const hud = document.createElement('div'); hud.className = 'cellHud'; wrap.appendChild(hud);
    hud.innerHTML = `<select>${OPTIONS.map(o => `<option value="${o.v}" ${o.v === spec ? 'selected' : ''}>${o.n}</option>`).join('')}</select><div class="st"></div>`;
    hud.querySelector('select').onchange = (e) => { forms[i] = e.target.value; build(); };
    return { w, r, hud, st: hud.querySelector('.st'), spec };
  });
  layout();
}
function layout() {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = rect.width * dpr; canvas.height = rect.height * dpr;
  const cols = 2, rows = Math.ceil(cells.length / 2);
  const cw = canvas.width / cols, ch = canvas.height / rows;
  cells.forEach((c, i) => {
    const x = (i % cols) * cw, y = Math.floor(i / cols) * ch;
    c.r.rect = { x: x + 2, y: y + 2, w: cw - 4, h: ch - 4 };
    c.hud.style.left = (x / dpr + 8) + 'px'; c.hud.style.top = (y / dpr + 8) + 'px';
  });
}
window.addEventListener('resize', layout);
document.getElementById('restart').onclick = () => { seed = Number(document.getElementById('seed').value) || 1; build(); };
document.getElementById('pause').onclick = (e) => { paused = !paused; e.target.textContent = paused ? '▶' : '⏸'; };
document.querySelectorAll('.spd').forEach(b => b.onclick = () => { speed = Number(b.dataset.spd); document.querySelectorAll('.spd').forEach(x => x.classList.toggle('active', x === b)); });

let last = performance.now(), acc = 0, hudT = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (!paused) {
    acc += dt * speed;
    const step = CONFIG.world.dt; let n = 0;
    while (acc >= step && n < 12) { for (const c of cells) c.w.step(step); acc -= step; n++; }
    if (n >= 12) acc = 0;
  }
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (const c of cells) c.r.draw(paused ? 0 : dt * Math.min(2, speed));
  hudT += dt;
  if (hudT > 0.5) {
    hudT = 0;
    for (const c of cells) {
      const L = c.w.lineages.get('A'), S = L.stats, T = Math.max(1, c.w.time);
      const k = S.kills, tot = k.hopper + k.mite + k.grub + k.beast || 1;
      const pct = (n) => Math.round(n / tot * 100);
      c.st.innerHTML = `経過 ${T.toFixed(0)}s ／ 魔素 <b>${Math.round(S.mana / T * 60)}/分</b><br>捕食 ${tot}：跳ね虫${pct(k.hopper)}% 群れ蟲${pct(k.mite)}% 丸虫${pct(k.grub)}% 角獣${pct(k.beast)}%<br>移動 ${Math.round(S.dist / Math.max(1, S.slimeTime))}/体/秒 ／ 個体数 ${L.pop} ／ 最大連鎖 ${S.maxChain}`;
    }
  }
  requestAnimationFrame(frame);
}
build();
requestAnimationFrame(frame);
