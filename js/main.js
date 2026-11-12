// =============================================================
//  ブラウザ版エントリ：ゲームループ・UI
// =============================================================
import { CONFIG, childrenOf } from './config.js';
import { Game, SAVE_KEY } from './game.js';
import { Renderer } from './render.js';

const $ = (s) => document.querySelector(s);
const F = CONFIG.factors, FORMS = CONFIG.forms, ELEMS = CONFIG.elements;

let storage = null;
try { storage = window.localStorage; storage.getItem('x'); } catch (e) { storage = null; }

let game = Game.load(storage) || new Game({ storage });
const canvas = $('#field');
const renderer = new Renderer(canvas, game.world, { onNotable: (m) => feed(m) });
let speed = 1, paused = true, tab = 'gacha', started = false;
let notifiedKeys = new Set(game.allAvailableKeys().filter(k => canEvolveKey(k)));

// ---------------- 開始画面 ----------------
const hasSave = !!(storage && storage.getItem(SAVE_KEY));
if (hasSave) {
  $('#btnStart').textContent = 'つづきから';
  const p = document.createElement('p'); p.className = 'small muted';
  p.textContent = `セーブデータ：プレイ時間 ${fmtTime(game.state.playTime)} / 血統 ${game.state.lineages.length}本`;
  $('#btnStart').parentElement.before(p);
}
$('#btnStart').onclick = () => { $('#intro').classList.add('hidden'); started = true; paused = false; updatePauseUi(); renderPanel(true); };
$('#btnHelp').onclick = () => { $('#menu').classList.add('hidden'); $('#intro').classList.remove('hidden'); $('#btnStart').textContent = 'もどる'; };

// ---------------- キャンバス ----------------
function resize() {
  const r = canvas.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
  renderer.clampCam();
}
window.addEventListener('resize', resize);
resize();

let drag = null;
canvas.addEventListener('mousedown', (e) => { drag = { x: e.clientX, y: e.clientY, cx: renderer.cam.x, cy: renderer.cam.y, moved: false }; });
window.addEventListener('mouseup', (e) => {
  if (drag && !drag.moved) {
    const dpr = canvas.width / canvas.getBoundingClientRect().width;
    const r = canvas.getBoundingClientRect();
    const s = renderer.pickSlime((e.clientX - r.left) * dpr, (e.clientY - r.top) * dpr);
    if (s) { game.state.selected = s.lin; renderer.selected = s.lin; if (tab === 'gacha') tab = 'evo'; renderPanel(true); }
  }
  drag = null; canvas.classList.remove('dragging');
});
window.addEventListener('mousemove', (e) => {
  const r = canvas.getBoundingClientRect(), dpr = canvas.width / r.width;
  if (drag) {
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) { drag.moved = true; canvas.classList.add('dragging'); if (renderer.follow) { renderer.follow = null; $('#btnFollow').classList.remove('active'); } }
    const v = renderer.view();
    renderer.cam.x = drag.cx - dx * dpr / v.s; renderer.cam.y = drag.cy - dy * dpr / v.s; renderer.clampCam();
  }
  hover = (e.target === canvas) ? { x: (e.clientX - r.left) * dpr, y: (e.clientY - r.top) * dpr, cx: e.clientX - r.left, cy: e.clientY - r.top } : null;
});
canvas.addEventListener('mouseleave', () => { hover = null; $('#tip').classList.add('hidden'); });
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const r = canvas.getBoundingClientRect(), dpr = canvas.width / r.width;
  const before = renderer.toWorld((e.clientX - r.left) * dpr, (e.clientY - r.top) * dpr);
  renderer.cam.zoom = Math.max(1, Math.min(4, renderer.cam.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
  const after = renderer.toWorld((e.clientX - r.left) * dpr, (e.clientY - r.top) * dpr);
  renderer.cam.x += before.x - after.x; renderer.cam.y += before.y - after.y; renderer.clampCam();
}, { passive: false });
canvas.addEventListener('dblclick', () => { setFollow(false); renderer.cam = { x: game.world.W / 2, y: game.world.H / 2, zoom: 1 }; });
let hover = null;

// ---------------- 操作 ----------------
function updatePauseUi() { $('#btnPause').textContent = paused ? '▶' : '⏸'; $('#pausedBadge').classList.toggle('hidden', !paused || !started); }
$('#btnPause').onclick = () => { paused = !paused; updatePauseUi(); };
document.querySelectorAll('.spd').forEach(b => b.onclick = () => { speed = Number(b.dataset.spd); document.querySelectorAll('.spd').forEach(x => x.classList.toggle('active', x === b)); });
$('#btnLinks').onclick = () => { renderer.showLinks = !renderer.showLinks; $('#btnLinks').classList.toggle('active', renderer.showLinks); };
$('#btnLinks').classList.toggle('active', renderer.showLinks);
function setFollow(on) {
  renderer.follow = on ? game.state.selected : null;
  if (on && renderer.cam.zoom < 1.8) renderer.cam.zoom = 2.2;
  if (!on) renderer.cam.zoom = 1;
  renderer.clampCam();
  $('#btnFollow').classList.toggle('active', !!on);
}
$('#btnFollow').onclick = () => setFollow(!renderer.follow);
$('#btnMenu').onclick = () => $('#menu').classList.toggle('hidden');
$('#btnLab').onclick = () => { window.open('lab.html', '_blank'); $('#menu').classList.add('hidden'); };
$('#btnReset').onclick = () => confirmBox('セーブデータを初期化して最初からやり直しますか？（元に戻せません）', () => {
  game.reset(); renderer.setWorld(game.world); renderer.selected = null; setFollow(false); notifiedKeys = new Set();
  $('#menu').classList.add('hidden'); tab = 'gacha'; renderPanel(true); feed('セーブを初期化しました');
});
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && !$('#gachaOverlay').classList.contains('hidden')) { e.preventDefault(); skipGacha(); return; }
  if (e.code === 'Space' && started) { e.preventDefault(); paused = !paused; updatePauseUi(); }
  if (e.code === 'KeyF' && started && !e.ctrlKey) setFollow(!renderer.follow);
});
function confirmBox(msg, yes) {
  $('#confirmMsg').textContent = msg; $('#confirm').classList.remove('hidden');
  $('#confirmYes').onclick = () => { $('#confirm').classList.add('hidden'); yes(); };
  $('#confirmNo').onclick = () => $('#confirm').classList.add('hidden');
}
document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => { tab = b.dataset.tab; renderPanel(true); });

// ---------------- フィード・トースト ----------------
function feed(msg) {
  const d = document.createElement('div'); d.textContent = msg;
  const f = $('#feed'); f.prepend(d);
  while (f.children.length > 6) f.lastChild.remove();
  setTimeout(() => d.remove(), 9000);
}
let toastTimer = 0;
function toast(html, ms = 7000) {
  const t = $('#toast'); t.innerHTML = html; t.classList.remove('hidden');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), ms);
}
function canEvolveKey(k) {
  const [lin, kind, id] = k.split(':');
  const l = game.lineage(lin); if (!l) return false;
  const o = game.options(l).find(x => x.kind === kind && x.id === id);
  return o && game.canEvolve(l, o);
}
function checkEvolveNotice() {
  const ready = game.allAvailableKeys().filter(canEvolveKey);
  $('#evoBadge').classList.toggle('hidden', ready.length === 0);
  const fresh = ready.filter(k => !notifiedKeys.has(k));
  if (fresh.length && $('#gachaOverlay').classList.contains('hidden')) {
    const p = game.parseKey(fresh[0]);
    const l = game.lineage(p.lin);
    toast(`✨ <span><b>${l.name}</b> が <b>${p.name}</b> に進化できます！</span><button class="primary" data-evo="${fresh[0]}">進化する</button>`);
  }
  notifiedKeys = new Set(ready);
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-evo]');
  if (b) { const [lin, kind, id] = b.dataset.evo.split(':'); doEvolve(lin, kind, id); $('#toast').classList.add('hidden'); }
});

function doEvolve(lin, kind, id) {
  if (game.evolve(lin, kind, id)) {
    game.state.selected = lin; renderer.selected = lin;
    const name = kind === 'form' ? FORMS[id].name : ELEMS[id].name + '化';
    feed(`🌟 ${game.lineage(lin).name} が ${name} に進化！`);
    // 進化した血統へカメラを寄せる
    const mine = game.world.slimes.filter(s => s.lin === lin);
    if (mine.length && renderer.cam.zoom > 1.01) { renderer.cam.x = mine[0].x; renderer.cam.y = mine[0].y; renderer.clampCam(); }
    tab = 'evo';
    renderPanel(true);
    return true;
  }
  return false;
}

// ---------------- ガチャ演出 ----------------
let gachaState = null;
function doPull(bannerId, n) {
  const res = game.pull(bannerId, n);
  if (!res) return;
  showGacha(res, bannerId, n);
  renderPanel(true);
}
function showGacha(res, bannerId, n) {
  const ov = $('#gachaOverlay');
  ov.classList.remove('hidden');
  const b = game.banner(bannerId);
  $('#gachaTitle').textContent = `${b.name} ${n === 10 ? '10連' : '単発'}${res.free ? '（無料）' : ''}`;
  const box = $('#gachaCards');
  box.className = n === 1 ? 'single' : '';
  box.innerHTML = res.cards.map((c, i) => {
    const f = F[c.factor];
    const tags = c.wanted ? '<span class="tag want">必要!</span>' : (c.isNew ? '<span class="tag new">NEW</span>' : '');
    return `<div class="gcard ${c.rarity} ${c.wanted ? 'wanted' : ''}" data-i="${i}">${tags}<div class="gi">${f.icon}</div><div class="gn">${f.name}</div><div class="gr r-${c.rarity}">${c.rarity}</div></div>`;
  }).join('');
  $('#gachaNews').innerHTML = '';
  $('#gachaSkip').classList.remove('hidden');
  $('#gachaClose').classList.add('hidden');
  $('#gachaAgain').classList.add('hidden');
  const cards = [...box.children];
  let i = 0;
  gachaState = { res, bannerId, n, timer: null, done: false };
  const next = () => {
    if (i >= cards.length) { finishGacha(); return; }
    cards[i].classList.add('show');
    const slow = res.cards[i].rarity === 'SSR' ? 450 : (res.cards[i].rarity === 'SR' ? 160 : 90);
    i++;
    gachaState.timer = setTimeout(next, slow);
  };
  next();
}
function skipGacha() {
  if (!gachaState) return;
  if (gachaState.done) { closeGacha(); return; }
  clearTimeout(gachaState.timer);
  document.querySelectorAll('.gcard').forEach(c => c.classList.add('show'));
  finishGacha();
}
function finishGacha() {
  if (!gachaState || gachaState.done) return;
  gachaState.done = true;
  const { res, bannerId, n } = gachaState;
  const news = res.newly.map(x => {
    const l = game.lineage(x.lin);
    const key = `${x.lin}:${x.kind}:${x.id}`;
    const opt = game.options(l).find(o => o.kind === x.kind && o.id === x.id);
    const ok = opt && game.canEvolve(l, opt);
    const lack = opt && !ok ? `（あと魔素 ${Math.ceil((opt.def.mana || 0) - game.state.mana)}）` : '';
    return `<div class="news">🔓 <span><b>${x.name}</b> が解放！ <span class="muted">${l.name}</span>${lack}</span>${ok ? `<button class="primary" data-evo="${key}">今すぐ進化</button>` : ''}</div>`;
  });
  if (!news.length) {
    const want = [...game.wantedFactors()].map(k => F[k].icon + F[k].name).join('、');
    news.push(`<div class="muted small">${want ? '次の進化に必要：' + want : '新しい進化はありません。重複した因子は「血統」タブの共鳴強化に使えます。'}</div>`);
  }
  $('#gachaNews').innerHTML = news.join('');
  $('#gachaSkip').classList.add('hidden');
  $('#gachaClose').classList.remove('hidden');
  const b = game.banner(bannerId);
  const again = $('#gachaAgain');
  if (game.canPull(bannerId, n)) {
    again.classList.remove('hidden');
    again.textContent = `もう一度 (${game.pullCost(bannerId, n)})`;
    again.onclick = () => { clearTimeout(gachaState.timer); doPull(bannerId, n); };
  }
  for (const x of res.newly) notifiedKeys.add(`${x.lin}:${x.kind}:${x.id}`);
}
function closeGacha() { $('#gachaOverlay').classList.add('hidden'); gachaState = null; renderPanel(true); }
$('#gachaSkip').onclick = skipGacha;
$('#gachaClose').onclick = closeGacha;
$('#gachaOverlay').addEventListener('click', (e) => {
  if (e.target.closest('[data-evo]')) { closeGacha(); return; }
  if (e.target.closest('button')) return;
  skipGacha();
});

// ---------------- パネル ----------------
let lastHtml = '';
function renderPanel(force) {
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  renderer.selected = game.state.selected;
  if (renderer.follow) renderer.follow = game.state.selected;
  let html = '';
  if (tab === 'gacha') html = gachaTab();
  else if (tab === 'evo') html = evoTab();
  else html = linTab();
  if (force || html !== lastHtml) {
    const body = $('#tabBody'), st = body.scrollTop;
    const openDetails = [...body.querySelectorAll('details[open]')].map(d => d.dataset.k);
    body.innerHTML = html; body.scrollTop = st; lastHtml = html;
    for (const k of openDetails) { const d = body.querySelector(`details[data-k="${k}"]`); if (d) d.open = true; }
  }
}
function fchip(k, cls = '', extra = '') { const f = F[k]; return `<span class="chip ${cls}"><span>${f.icon}</span><span class="r-${f.rarity}">${f.name}</span>${extra}</span>`; }

function gachaTab() {
  const st = game.state, wanted = game.wantedFactors();
  let h = '';
  // 欲しいもの
  h += `<h3>次の進化に必要な因子</h3><div class="card">`;
  const needs = [];
  for (const l of st.lineages) for (const o of game.options(l)) {
    const m = game.missing(o.def);
    const ks = Object.keys(m);
    if (ks.length) needs.push(`<div class="small" style="margin:3px 0"><span style="color:${l.color}">${l.id}</span> ${o.kind === 'form' ? o.def.name : o.def.name + '化'}：${ks.map(k => fchip(k, 'want')).join(' ')}</div>`);
  }
  h += needs.length ? needs.join('') : '<div class="muted">今の血統で必要な因子はすべて揃っています。進化タブへ！</div>';
  h += `</div>`;
  // ガチャ
  h += `<h3>ガチャ</h3>`;
  for (const b of CONFIG.gacha.banners) {
    const free = game.canFree() && b.id === CONFIG.economy.freeTenPullBanner;
    const wr = [...wanted].map(k => `${F[k].icon}${F[k].name} <b>${b.rates[k]}%</b>`).join(' / ');
    h += `<div class="card banner" style="--theme:${b.theme}">
      <div class="row"><span class="name">${b.name}</span></div>
      <div class="muted">${b.desc}</div>
      ${wr ? `<div class="wantrate">欲しい因子の排出率：${wr}</div>` : ''}
      <div class="btns">
        <button data-pull="${b.id}:1" ${game.canPull(b.id, 1) ? '' : 'disabled'}>単発 ✦${b.cost1}</button>
        <button data-pull="${b.id}:10" class="${free ? 'primary free' : ''}" ${game.canPull(b.id, 10) ? '' : 'disabled'}>${free ? '初回無料10連!' : `10連 ✦${b.cost10}`}</button>
      </div>
      <details data-k="rate-${b.id}"><summary>排出率を見る</summary><table class="rates">${Object.entries(b.rates).map(([k, r]) => `<tr><td>${F[k].icon} ${F[k].name}</td><td class="r-${F[k].rarity}">${F[k].rarity}</td><td>${r}%</td></tr>`).join('')}</table></details>
    </div>`;
  }
  h += `<div class="muted small">保証：10連の10枠目はSR以上確定 ／ SSR天井まであと <b>${CONFIG.gacha.ssrCeiling - st.sinceSSR}</b> 回（全ガチャ共通）。<br>それ以外は表示された排出率どおりの完全ランダム抽選です。</div>`;
  // 所持
  h += `<h3>所持因子</h3><div class="inv">`;
  for (const [k, f] of Object.entries(F)) {
    const n = st.inventory[k] || 0;
    h += `<div class="${n ? '' : 'zero'} ${wanted.has(k) ? 'want' : ''}" title="${f.desc}"><span class="ic">${f.icon}</span><span class="r-${f.rarity}">${f.name}</span><br><b>×${n}</b></div>`;
  }
  h += `</div>`;
  return h;
}

function linSelector() {
  return `<div class="lin-tabs">${game.state.lineages.map(l => `<button data-sel="${l.id}" class="${l.id === game.state.selected ? 'active' : ''}" style="border-color:${l.color};color:${l.color}">${l.name}</button>`).join('')}</div>`;
}

function recipeChips(def) {
  const inv = game.state.inventory;
  return Object.entries(def.recipe).map(([k, n]) => { const have = inv[k] || 0; return fchip(k, have >= n ? 'ok' : 'ng', ` <span class="muted">${have}/${n}</span>`); }).join(' ');
}

function evoTab() {
  const st = game.state, lin = game.lineage();
  const cur = FORMS[lin.form];
  let h = linSelector();
  h += `<div class="card lincard" style="--c:${lin.color}"><div class="muted">${lin.name} の現在の形態</div>
    <div class="form-title">${cur.name}${lin.element ? '・' + ELEMS[lin.element].name : ''} <span class="muted">Lv${lin.level}</span></div>
    <div class="small" style="color:#c4d1c6">${cur.desc}${lin.element ? '<br>' + ELEMS[lin.element].desc : ''}</div></div>`;
  const opts = game.options(lin);
  h += `<h3>次の進化先</h3>`;
  if (!opts.length) h += `<div class="muted card">この系統の最終形態です。転生して別の系統を試すか、血統を分岐させましょう。</div>`;
  for (const o of opts) {
    const ready = game.factorsReady(o), can = game.canEvolve(lin, o);
    const m = game.missing(o.def);
    const mana = o.def.mana || 0;
    let hint = '';
    if (!ready) {
      const k = Object.keys(m).sort((a, b) => maxRate(b) - maxRate(a))[0];
      const best = CONFIG.gacha.banners.slice().sort((a, b) => b.rates[k] - a.rates[k])[0];
      hint = `<div class="hint">${F[k].icon}${F[k].name} は「${best.name}」で ${best.rates[k]}%</div>`;
    } else if (!can) hint = `<div class="hint">因子は揃っています。あと魔素 ✦${Math.ceil(mana - st.mana)}</div>`;
    h += `<div class="opt ${can ? 'ready' : ''}">
      <div class="row"><span class="oname">${o.kind === 'form' ? o.def.name : '複合属性：' + o.def.name}</span><span class="sp"></span>${mana ? `<span class="muted">✦${mana}</span>` : ''}</div>
      <div class="odesc">${o.def.desc}</div>
      <div class="row">${recipeChips(o.def)}</div>${hint}
      ${can ? `<button class="primary" data-evo="${lin.id}:${o.kind}:${o.id}">進化する</button>` : ''}
    </div>`;
  }
  if (lin.form !== 'base') h += `<div class="row" style="margin:4px 0 10px"><button data-rebirth="${lin.id}">↺ 転生（基本スライムに戻る）</button><span class="muted small">使った因子は戻りません・Lvは維持</span></div>`;
  // 図鑑
  h += `<h3>進化図鑑</h3><div class="tree">`;
  const tier1 = childrenOf('base');
  const nodeFor = (id) => {
    const f = FORMS[id], got = st.discovered[id], isCur = st.lineages.some(l => l.form === id);
    return `<div class="node ${isCur ? 'cur' : got ? 'got' : 'lock'}"><div class="nn">${f.name}</div><div class="nr">${Object.keys(f.recipe).map(k => F[k].icon).join('')}${f.mana ? ' ✦' + f.mana : ''}</div></div>`;
  };
  for (const id of tier1) h += nodeFor(id);
  for (const id of tier1) { const c = childrenOf(id)[0]; h += c ? nodeFor(c) : '<div></div>'; }
  h += `</div><div class="muted small" style="margin-top:4px">上段：炎＋行動因子（基本形態） / 下段：基本形態＋追加因子</div>`;
  h += `<div class="tree" style="grid-template-columns:1fr 1fr;margin-top:6px">${Object.entries(ELEMS).map(([id, e]) => `<div class="node ${st.discovered['el:' + id] ? 'got' : 'lock'}"><div class="nn">${e.name}（炎＋${id === 'steam' ? '水' : '毒'}）</div><div class="nr">💠${id === 'steam' ? '💧' : '☠️'} ✦${e.mana}</div></div>`).join('')}</div>`;
  h += `<div class="muted small" style="margin-top:4px">複合属性は基本形態以上の血統に上乗せできる変異（SSR 複属性核が必要）</div>`;
  return h;
}
function maxRate(k) { return Math.max(...CONFIG.gacha.banners.map(b => b.rates[k])); }

function linTab() {
  const st = game.state;
  let h = `<h3>血統（最大${CONFIG.economy.maxLineages}）</h3>`;
  for (const l of st.lineages) {
    const L = game.world.lineages.get(l.id); const S = L.stats;
    const f = FORMS[l.form];
    const rate = S.time > 5 ? Math.round(S.mana / S.time * 60) : 0;
    const resF = game.resonanceFactors(l).filter(k => (st.inventory[k] || 0) > 0);
    const maxLv = l.level >= CONFIG.economy.resonanceMaxLevel;
    const rc = game.resonanceCost(l);
    h += `<div class="card lincard" style="--c:${l.color}">
      <div class="row"><b style="color:${l.color}">${l.name}</b><span>${f.name}${l.element ? '・' + ELEMS[l.element].name : ''}</span><span class="muted">Lv${l.level}</span><span class="sp"></span><button data-sel="${l.id}" data-go="evo">進化へ</button></div>
      <div class="stat">
        <span>個体数</span><span>${L.pop || 0}</span>
        <span>魔素効率</span><span>${rate}/分</span>
        <span>捕食数</span><span>跳${S.kills.hopper} 群${S.kills.mite} 丸${S.kills.grub} 角${S.kills.beast}</span>
        <span>最大連鎖</span><span>${S.maxChain}</span>
        <span>移動距離</span><span>${Math.round(S.dist)}</span>
        <span>系統</span><span>${l.history.map(x => FORMS[x].name).join('→')}</span>
      </div>
      <div class="row" style="margin-top:6px"><span class="muted small">行動方針</span>
        <select data-policy="${l.id}">${Object.entries(CONFIG.policies).map(([k, p]) => `<option value="${k}" ${l.policy === k ? 'selected' : ''}>${p.name}</option>`).join('')}</select>
      </div>
      <div class="row" style="margin-top:6px"><span class="muted small">共鳴強化${maxLv ? '（最大Lv）' : ` ✦${rc}`}</span>
        ${maxLv ? '' : resF.length ? resF.map(k => `<button data-res="${l.id}:${k}" ${st.mana >= rc ? '' : 'disabled'} title="${F[k].name}を1つ消費してLv+1">${F[k].icon}×1</button>`).join('') : '<span class="muted small">使える因子なし</span>'}
      </div>
    </div>`;
  }
  if (st.lineages.length < CONFIG.economy.maxLineages) {
    const c = game.branchCost();
    h += `<div class="card"><b>血統分岐</b><div class="muted small">新しい基本スライムの血統を作り、別の進化系統を同時に育てます（増殖とは別機能）。同じフィールドで獲物を奪い合います。</div>
      <button class="primary" style="width:100%;margin-top:6px" data-branch ${game.canBranch() ? '' : 'disabled'}>血統を分岐する ✦${c}</button></div>`;
  }
  h += `<div class="muted small">行動方針：攻撃的＝大物にも挑み逃げない／慎重＝体力が減ると逃げる・群れ型は栄養を蓄えてから分裂。<br>共鳴強化：その血統の進化で使った因子（または硬化・感知）を注入してLvアップ。</div>`;
  h += `<h3>記録</h3><div class="card small">${st.log.slice(0, 10).map(x => `<div><span class="muted">${fmtTime(x.t)}</span> ${x.msg}</div>`).join('') || '<span class="muted">まだ記録はありません</span>'}</div>`;
  return h;
}

$('#tabBody').addEventListener('click', (e) => {
  const t = e.target.closest('button'); if (!t) return;
  if (t.dataset.pull) { const [b, n] = t.dataset.pull.split(':'); doPull(b, Number(n)); }
  else if (t.dataset.sel) { game.state.selected = t.dataset.sel; if (t.dataset.go) tab = t.dataset.go; renderPanel(true); }
  else if (t.dataset.rebirth) confirmBox(`${game.lineage(t.dataset.rebirth).name} を基本スライムに転生させますか？（使った因子は戻りません）`, () => { game.rebirth(t.dataset.rebirth); renderPanel(true); });
  else if (t.dataset.res) { const [l, k] = t.dataset.res.split(':'); if (game.resonate(l, k)) feed(`${game.lineage(l).name} 共鳴強化 → Lv${game.lineage(l).level}`); renderPanel(true); }
  else if (t.hasAttribute('data-branch')) { if (game.branch()) { feed(`🌱 新しい血統 ${game.lineage().name} が誕生`); tab = 'evo'; renderPanel(true); } }
});
$('#tabBody').addEventListener('change', (e) => {
  const s = e.target.closest('select[data-policy]');
  if (s) { game.setPolicy(s.dataset.policy, s.value); feed(`${game.lineage(s.dataset.policy).name} の方針：${CONFIG.policies[s.value].name}`); }
});

// ---------------- ツールチップ ----------------
const STATE_TXT = { hunt: '狩り中', wander: '徘徊', seek: '群れを探索', prowl: '大物を探索', rest: '休眠・回復', flee: '逃走', march: '行進', starve: '飢餓' };
function updateTip() {
  const tip = $('#tip');
  if (!hover) { tip.classList.add('hidden'); return; }
  const s = renderer.pickSlime(hover.x, hover.y);
  if (!s) { tip.classList.add('hidden'); return; }
  const L = game.world.lineages.get(s.lin); const f = FORMS[L.form];
  const tgt = s.target && s.target.alive ? CONFIG.prey[s.target.type].name : '—';
  tip.innerHTML = s.kind === 'infector' ? `<b>自爆子体</b><br>群れに突っ込んで自爆する` :
    `<b style="color:${L.color}">${L.name}</b> ${f.name}${L.element ? '・' + ELEMS[L.element].name : ''} Lv${L.level}<br>状態：${STATE_TXT[s.state] || s.state}<br>標的：${tgt}<br>HP ${Math.ceil(s.hp)}/${Math.ceil(s.maxHp)}　大きさ ${s.r.toFixed(0)}${f.split ? `<br>栄養 ${s.nutri.toFixed(1)}/${f.split.cost}（分裂）` : ''}`;
  tip.style.left = Math.min(hover.cx + 14, canvas.clientWidth - 200) + 'px';
  tip.style.top = (hover.cy + 14) + 'px';
  tip.classList.remove('hidden');
}

// ---------------- メインループ ----------------
let last = performance.now(), acc = 0, panelT = 0, saveT = 0, rateHist = [], rateT = 0;
function frame(now) {
  const dtReal = Math.min(0.1, (now - last) / 1000); last = now;
  if (!paused && started) {
    acc += dtReal * speed;
    const dt = CONFIG.world.dt;
    let n = 0;
    while (acc >= dt && n < 12) { game.tick(dt); acc -= dt; n++; }
    if (n >= 12) acc = 0;
  }
  renderer.draw(paused ? 0 : dtReal * Math.min(speed, 2));
  $('#manaVal').textContent = Math.floor(game.state.mana).toLocaleString();
  rateT += dtReal;
  if (rateT > 1) { rateT = 0; rateHist.push(game.state.manaEarned); if (rateHist.length > 31) rateHist.shift(); const r = rateHist.length > 2 ? (rateHist[rateHist.length - 1] - rateHist[0]) / (rateHist.length - 1) * 60 / speed : 0; $('#manaRate').textContent = r > 0 && !paused ? `+${Math.round(r * (paused ? 0 : 1))}/分` : ''; }
  panelT += dtReal; saveT += dtReal;
  if (panelT > 0.5) { panelT = 0; renderPanel(false); checkEvolveNotice(); updateTip(); }
  if (saveT > 5) { saveT = 0; if (started) game.save(); }
  requestAnimationFrame(frame);
}
window.addEventListener('beforeunload', () => { if (started) game.save(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && started) game.save(); });

function fmtTime(t) { t = Math.floor(t); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; }

renderer.selected = game.state.selected;
renderPanel(true);
updatePauseUi();
requestAnimationFrame(frame);
window.__game = () => game; // デバッグ・検証用
