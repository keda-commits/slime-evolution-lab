// =============================================================
//  バランス設定ファイル
//  ガチャ排出率・コスト・進化レシピ・獲物/スライムの数値はすべてここで調整する。
//  （ゲームロジックはこのファイルの値だけを参照する）
// =============================================================

export const CONFIG = {
  version: 1,
  world: { w: 1600, h: 1000, dt: 1 / 30 },

  // ---------------- 経済 ----------------
  economy: {
    startMana: 0,
    startFactors: { fire: 1 },       // はじまりの火種（全基本形態に必要な炎を1つ配布）
    freeTenPullBanner: 'standard',   // 初回無料10連の対象ガチャ
    branchCost: [0, 300, 900],       // 血統 1/2/3 本目の作成コスト（魔素）
    maxLineages: 3,
    resonanceMaxLevel: 5,            // 共鳴強化の上限レベル
    resonanceManaCost: 50,
    manaMul: 1.0,                    // 魔素獲得量の全体倍率（テンポ調整用）
  },

  // ---------------- 能力因子（10種） ----------------
  factors: {
    fire:     { name: '炎',       rarity: 'R',   icon: '🔥', color: '#ff6a2a', desc: '全ての炎系進化の基礎' },
    roll:     { name: '転がる',   rarity: 'R',   icon: '🌀', color: '#ffb347', desc: '高速移動・体当たり' },
    water:    { name: '水',       rarity: 'R',   icon: '💧', color: '#4fb3ff', desc: '複属性核と合わせて蒸気化' },
    poison:   { name: '毒',       rarity: 'R',   icon: '☠️', color: '#9be15d', desc: '複属性核と合わせて毒炎化' },
    harden:   { name: '硬化',     rarity: 'R',   icon: '🛡️', color: '#b0a089', desc: '被ダメ軽減。龍の派生に必要' },
    sense:    { name: '感知',     rarity: 'R',   icon: '👁️', color: '#c9a7ff', desc: '索敵範囲拡大（共鳴に使用）' },
    multiply: { name: '増殖',     rarity: 'SR',  icon: '🧬', color: '#ff7ab6', desc: '分裂して群れになる' },
    burst:    { name: '爆裂',     rarity: 'SR',  icon: '💥', color: '#ffd23f', desc: '倒した獲物が爆発する' },
    devour:   { name: '捕食',     rarity: 'SR',  icon: '🦷', color: '#e04848', desc: '巨大化・大物狙い' },
    core:     { name: '複属性核', rarity: 'SSR', icon: '💠', color: '#7af0ff', desc: '炎と別属性を融合させる' },
  },

  // ---------------- ガチャ ----------------
  // rates: 各因子の排出率(%)。合計100。画面にそのまま表示される。
  // 抽選は純粋な乱数。進化目標による裏操作は一切しない。保証は下記のみ（画面に明示）。
  gacha: {
    tenPullGuaranteeSR: true,     // 10連の10枠目はSR以上確定
    ssrCeiling: 60,               // SSRが出ないまま60回引くと次の1回がSSR確定（全ガチャ共通カウント）
    banners: [
      {
        id: 'standard', name: 'スタンダード招来', desc: '全因子がバランスよく出る基本ガチャ',
        cost1: 100, cost10: 1000, theme: '#6ab04c',
        rates: { fire: 14, roll: 13, water: 12, poison: 12, harden: 12, sense: 12,
                 multiply: 7.5, burst: 7, devour: 7.5, core: 3 },
      },
      {
        id: 'instinct', name: '本能の祭壇', desc: '行動因子（転がる・増殖・爆裂・捕食）が出やすい',
        cost1: 150, cost10: 1500, theme: '#e17055',
        rates: { fire: 12, roll: 22, water: 4, poison: 4, harden: 9, sense: 8,
                 multiply: 13, burst: 13, devour: 13, core: 2 },
      },
      {
        id: 'element', name: '元素の泉', desc: '属性因子（炎・水・毒）と複属性核が出やすい',
        cost1: 120, cost10: 1200, theme: '#0984e3',
        rates: { fire: 24, roll: 5, water: 20, poison: 20, harden: 7, sense: 6,
                 multiply: 4, burst: 4, devour: 4, core: 6 },
      },
    ],
  },

  // ---------------- 進化（形態） ----------------
  // recipe: 消費する因子 / mana: 消費魔素 / from: 進化元形態（nullなら基本スライムから）
  forms: {
    base: {
      name: 'スライム', tier: 0, from: null, recipe: {}, mana: 0,
      color: '#7fd36b', desc: 'のんびり近くの獲物を食べる。',
      speed: 55, accel: 140, hp: 50, atk: 9, r: 12, sense: 170, massCap: 2.2,
      weights: { hopper: 0.8, mite: 1, grub: 1.3, beast: 0 },
    },
    fireball: {
      name: '火達磨', tier: 1, from: 'base', recipe: { fire: 1, roll: 1 }, mana: 0,
      color: '#ff7a1a', desc: '炎をまとって高速回転。素早い小型の獲物を追い回して轢き狩る。炎の轍が残る。',
      speed: 280, accel: 380, hp: 55, atk: 0, impact: 16, r: 11, sense: 520, massCap: 1.8,
      weights: { hopper: 3.5, mite: 0.5, grub: 0.5, beast: 0 },
      trail: { every: 0.07, life: 1.1, r: 10, dps: 10 },
    },
    legion: {
      name: '炎の軍勢', tier: 1, from: 'base', recipe: { fire: 1, multiply: 1 }, mana: 0,
      color: '#ff5533', desc: '栄養を使って分裂し群れで狩る。数は力だが維持費がかかり、飢えると減る。',
      speed: 100, accel: 300, hp: 22, atk: 5, r: 7, sense: 230, massCap: 1,
      weights: { hopper: 0.8, mite: 1.2, grub: 1.6, beast: 0 },
      split: { cost: 9, upkeep: 0.5, cap: 16 },
    },
    chain: {
      name: '連鎖爆破', tier: 1, from: 'base', recipe: { fire: 1, burst: 1 }, mana: 0,
      color: '#d63031', desc: '倒した獲物が爆発し、周囲へ連鎖する。群れの密集地を探して突っ込む。',
      speed: 105, accel: 190, hp: 70, atk: 10, r: 14, sense: 360, massCap: 2.5,
      weights: { hopper: 0.4, mite: 3, grub: 0.8, beast: 0.1 },
      burst: { radius: 50, dmg: 18, delay: 0.09, falloff: 0.97, chainBonus: 0.1, chainBonusMax: 3 },
      seekDensity: true,
    },
    dragon: {
      name: '灼熱龍', tier: 1, from: 'base', recipe: { fire: 1, devour: 1 }, mana: 0,
      color: '#b3122e', desc: '巨大化し大型獣だけを狙う。炎の吐息で焼き、丸呑みにする。小物には見向きもしない。',
      speed: 60, accel: 90, hp: 280, atk: 18, r: 20, sense: 2000, massCap: 6,
      weights: { hopper: 0, mite: 0, grub: 0.6, beast: 8 },
      breath: { range: 120, dps: 32, arc: 0.7 },
      regenRest: 14,
    },
    // ---- 追加進化（基本形態 + 後から追加した因子）----
    fireDance: {
      name: '火の玉乱舞', tier: 2, from: 'fireball', recipe: { multiply: 1 }, mana: 400,
      color: '#ffc312', desc: '火達磨が分裂。複数の火の玉が跳ね回り、フィールドを炎の轍で埋める。',
      speed: 300, accel: 420, hp: 40, atk: 0, impact: 14, r: 9, sense: 520, massCap: 1.2,
      weights: { hopper: 3, mite: 1, grub: 0.8, beast: 0 },
      trail: { every: 0.07, life: 1.3, r: 10, dps: 10 },
      split: { cost: 16, upkeep: 0.45, cap: 7 },
    },
    march: {
      name: '火炎大行進', tier: 2, from: 'legion', recipe: { roll: 1 }, mana: 400,
      color: '#ff3d00', desc: '軍勢が隊列を組んで転がり進む。獲物の多い地帯を波のように掃討する。',
      speed: 160, accel: 360, hp: 26, atk: 7, impact: 9, r: 7, sense: 120, massCap: 1,
      weights: { hopper: 1, mite: 1.2, grub: 1.5, beast: 0 },
      split: { cost: 9, upkeep: 0.22, cap: 28 },
      trail: { every: 0.22, life: 0.9, r: 9, dps: 6 },
      flock: true,
    },
    infect: {
      name: '自爆感染体', tier: 2, from: 'chain', recipe: { multiply: 1 }, mana: 400,
      color: '#8e1b4d', desc: '体内で自爆する子体を産み、群れへ送り込んで連鎖爆発を起こす。',
      speed: 70, accel: 150, hp: 80, atk: 10, r: 15, sense: 420, massCap: 2.5,
      weights: { hopper: 0.4, mite: 3, grub: 0.8, beast: 0.1 },
      burst: { radius: 52, dmg: 16, delay: 0.09, falloff: 0.97, chainBonus: 0.1, chainBonusMax: 3 },
      seekDensity: true,
      infector: { cost: 6, cap: 8, speed: 130, life: 14, r: 4, radius: 62, dmg: 22 },
    },
    lavaTitan: {
      name: '溶岩巨龍', tier: 2, from: 'dragon', recipe: { harden: 1 }, mana: 400,
      color: '#5a1a0a', desc: '岩殻に覆われた超巨体。反撃をほぼ無効化し、溶岩の足跡と灼熱の領域で周囲を焼く。',
      speed: 50, accel: 70, hp: 420, atk: 22, r: 24, sense: 2000, massCap: 9,
      weights: { hopper: 0, mite: 0, grub: 0.6, beast: 8 },
      breath: { range: 140, dps: 36, arc: 0.8 },
      armor: 0.7, aura: { mul: 1.7, dps: 10 },
      trail: { every: 0.5, life: 4, r: 22, dps: 8, kind: 'lava' },
      regenRest: 18,
    },
  },

  // ---------------- 複合属性（SSR 複属性核 + 属性因子） ----------------
  // 炎系の形態（tier1以上）の血統に上乗せされる変異。
  elements: {
    steam: {
      name: '蒸気', recipe: { core: 1, water: 1 }, mana: 500, color: '#dfe9f3',
      desc: '炎＋水。周期的に蒸気を噴き出し、範囲内の獲物を大きく減速させる。',
      cloud: { every: 4, r: 120, life: 3, slow: 0.3, dmgMul: 1.3 },
    },
    toxic: {
      name: '毒炎', recipe: { core: 1, poison: 1 }, mana: 500, color: '#9be15d',
      desc: '炎＋毒。攻撃が毒を与え、毒で倒れた獲物は周囲へ毒を感染させる。',
      poison: { dps: 4, dur: 5, spread: 55, spreadMax: 3 },
    },
  },

  // 血統の行動方針
  policies: {
    aggressive: { name: '攻撃的', atkMul: 1.12, dmgTakenMul: 1.15, fleeHp: 0, beastBias: 1.5, splitReserve: 0 },
    normal:     { name: '標準',   atkMul: 1.0,  dmgTakenMul: 1.0,  fleeHp: 0.25, beastBias: 1, splitReserve: 0.3 },
    cautious:   { name: '慎重',   atkMul: 0.92, dmgTakenMul: 0.85, fleeHp: 0.5, beastBias: 0.5, splitReserve: 1.0 },
  },

  // 共鳴強化：レベル毎の倍率
  level: { atk: 0.15, hp: 0.10, ability: 0.08, cap: 0.12 },

  // ---------------- 獲物 ----------------
  prey: {
    hopper: { name: '跳ね虫', r: 5, hp: 6, speed: 140, flee: 130, mana: 5, nutri: 3, K: 70, birth: 0.08, immigrate: 0.4, color: '#c8e65a' },
    mite:   { name: '群れ蟲', r: 3, hp: 3, speed: 28, flee: 40, mana: 1.4, nutri: 1, nests: 6, perNest: 30, regrow: 1.1, color: '#6c4f9e' },
    grub:   { name: '丸虫',   r: 8, hp: 26, speed: 32, flee: 0, mana: 7, nutri: 6, K: 26, birth: 0.04, immigrate: 0.15, color: '#e8d3a8' },
    beast:  { name: '角獣',   r: 22, hp: 420, speed: 42, chargeSpeed: 135, atk: 24, atkCd: 1.1, mana: 90, nutri: 50, K: 4, respawn: 14, color: '#8a5a3c' },
  },
};

// 形態から派生先一覧を引く
export function childrenOf(formId) {
  return Object.entries(CONFIG.forms).filter(([, f]) => f.from === formId).map(([id]) => id);
}
