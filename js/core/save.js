// 存档：**两段式解码**。一条坏记录只丢那一条，不许把整局冻死。
//
// 为什么不是 `Object.assign(defaults, JSON.parse(raw))`：那一写法在 JSON.parse 抛错时整局没救，
// 而更阴的是它不抛错 —— 记录里 `runs: null` 会把默认值的数组盖成 null，
// 于是下一次 runs.push(...) 才炸，炸在离坏数据最远的地方（玩家看到的是"点开就白屏"）。
// 所以这里：第一段只管"这串是不是 JSON"，第二段逐条记录自己认领自己的形状，坏一条丢一条。
//
// 版本：KEY 带 v1；结构再变就换 key，不换 key 的迁移是下一次事故的入口。
import { TIER_MENU } from './game.js';

export const SAVE_KEY = 'herugolf.save.v1';
export const SAVE_VERSION = 1;

const INT = (v, lo, hi, dflt) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v !== '' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return dflt;
  const i = Math.round(n);
  return i < lo || i > hi ? dflt : i;
};
const NUM = (v, lo, hi, dflt) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= lo && n <= hi ? n : dflt;
};
const STR = (v, max, dflt) => (typeof v === 'string' && v.length && v.length <= max ? v : dflt);

export function defaultStore() {
  return {
    v: SAVE_VERSION,
    prefs: { muted: false, tier: TIER_MENU[0], hintOn: true },
    runs: [],
    best: {},
    wins: 0,
    played: 0,
  };
}

// 第二段：一条记录 → 干净记录 | null（null = 只丢这一条）
function sanitizeRun(rec) {
  if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return null;
  const tier = STR(rec.tier, 16, '');
  if (!TIER_MENU.includes(tier)) return null;
  const seed = INT(rec.seed, 0, 2147483647, NaN);
  if (!Number.isFinite(seed)) return null;
  if (typeof rec.board !== 'string' || rec.board.length > 324) return null;
  const lines = Array.isArray(rec.lines) ? rec.lines : null;
  if (!lines || lines.length > 12) return null;
  const clean = [];
  for (const l of lines) {
    if (!l || typeof l !== 'object') return null;
    const start = INT(l.start, 0, 323, NaN);
    if (!Number.isFinite(start)) return null;
    const stops = Array.isArray(l.stops) ? l.stops : null;
    if (!stops || stops.length > 9) return null;
    const cs = [];
    for (const s of stops) {
      const v = INT(s, 0, 323, NaN);
      if (!Number.isFinite(v)) return null;
      cs.push(v);
    }
    clean.push({ start, stops: cs });
  }
  return {
    seed,
    tier,
    board: rec.board,
    lines: clean,
    moves: INT(rec.moves, 0, 9999, 0),
    blocked: INT(rec.blocked, 0, 9999, 0),
    winSecs: NUM(rec.winSecs, 0, 86400, 0),
    state: STR(rec.state, 12, 'playing'),
  };
}

function sanitizePrefs(p) {
  const d = defaultStore().prefs;
  if (!p || typeof p !== 'object') return d;
  return {
    muted: typeof p.muted === 'boolean' ? p.muted : d.muted,
    tier: TIER_MENU.includes(p.tier) ? p.tier : d.tier,
    hintOn: typeof p.hintOn === 'boolean' ? p.hintOn : d.hintOn,
  };
}

function sanitizeBest(b) {
  const out = {};
  if (!b || typeof b !== 'object') return out;
  for (const tier of TIER_MENU) {
    const rec = b[tier];
    if (!rec || typeof rec !== 'object') continue;
    const moves = INT(rec.moves, 1, 9999, NaN);
    const secs = NUM(rec.secs, 0, 86400, NaN);
    if (!Number.isFinite(moves) || !Number.isFinite(secs)) continue;
    out[tier] = { moves, secs };
  }
  return out;
}

// 第一段 + 第二段。storage 读不到/解不出都退默认值，且**如实报告丢了几条**。
export function loadStore(storage) {
  const report = { parsed: false, droppedRuns: 0, keptRuns: 0, reason: '' };
  let raw = null;
  try {
    raw = storage && typeof storage.getItem === 'function' ? storage.getItem(SAVE_KEY) : null;
  } catch (e) {
    report.reason = 'storage-unavailable';
    return { store: defaultStore(), report };
  }
  if (raw == null || raw === '') {
    report.reason = 'empty';
    return { store: defaultStore(), report };
  }
  let obj = null;
  try {
    obj = JSON.parse(raw); // 段一：只判"是不是合法 JSON"
  } catch (e) {
    report.reason = 'bad-json';
    return { store: defaultStore(), report };
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    report.reason = 'not-an-object';
    return { store: defaultStore(), report };
  }
  report.parsed = true;
  const store = defaultStore();
  store.prefs = sanitizePrefs(obj.prefs); // 段二：每个字段自己认领形状
  store.best = sanitizeBest(obj.best);
  const runs = Array.isArray(obj.runs) ? obj.runs : [];
  for (const rec of runs.slice(0, 24)) {
    const clean = sanitizeRun(rec);
    if (clean) {
      store.runs.push(clean);
      report.keptRuns++;
    } else {
      report.droppedRuns++;
    }
  }
  report.droppedRuns += Math.max(0, runs.length - 24);
  store.wins = INT(obj.wins, 0, 999999, 0);
  store.played = INT(obj.played, 0, 999999, 0);
  return { store, report };
}

export function writeStore(storage, store) {
  const payload = JSON.stringify({ ...store, v: SAVE_VERSION });
  try {
    if (storage && typeof storage.setItem === 'function') {
      storage.setItem(SAVE_KEY, payload);
      return { ok: true, bytes: payload.length };
    }
  } catch (e) {
    return { ok: false, reason: e && e.name ? e.name : 'write-failed', bytes: payload.length };
  }
  return { ok: false, reason: 'no-storage', bytes: payload.length };
}

// 把"这一局"并进存档：同 seed 同 tier 就地覆盖，别的记录一条都不许掉。
// 记录里**不挂时间戳**：数组下标就是"最近优先"，而一个由帧循环顺手抓的 now() 会让同一局在
// 30Hz 与 120Hz 落下两个不同的数 —— 那是尺的相位，不是玩家的战绩。
export function upsertRun(store, snap) {
  const rec = { ...snap };
  const i = store.runs.findIndex((r) => r.seed === rec.seed && r.tier === rec.tier);
  if (i >= 0) store.runs[i] = rec;
  else store.runs.unshift(rec);
  if (store.runs.length > 24) store.runs.length = 24;
  return store.runs.length;
}

export function recordWin(store, snap) {
  store.wins = Math.min(999999, store.wins + 1);
  const cand = { moves: INT(snap.moves, 1, 9999, 9999), secs: NUM(snap.winSecs, 0, 86400, 0) };
  const prev = store.best[snap.tier];
  const better = !prev || cand.moves < prev.moves || (cand.moves === prev.moves && cand.secs < prev.secs);
  if (better) store.best[snap.tier] = cand;
  return store.best[snap.tier];
}
