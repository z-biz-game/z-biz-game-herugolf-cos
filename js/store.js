// localStorage 存档：设置、纪录、seed 游标、续局快照。
//
// 两条写在这里的规矩：
//  * 默认 seed 取自 seedCounter 这个**小整数游标**，绝不取 Date.now()。页面上印着 "seed 7"
//    就必须能用同一个 7 + 同一档重出同一张盘（闸量的是这条，见 tools/scenarios.js 的 play 段）。
//  * 存档读坏了不许把整个应用带走：每一条通道各自 try/catch，坏的那一条退回默认值，
//    并把"坏在哪一条"留在 lastLoad 里给界面说。
const KEY = 'herugolf-cos:v1';

const DEFAULTS = () => ({
  v: 1,
  settings: { sound: true, motion: true },
  best: {}, // tier -> {strokes, hints, ms, at}
  totals: { solved: 0, hints: 0, ms: 0, shipped: 0 },
  seedCounter: 1,
  resume: null, // {tier, seed, codes, strokes, hints, elapsedMs, savedAt}
});

export class Store {
  constructor(storage = globalThis.localStorage) {
    this.storage = storage;
    this.data = DEFAULTS();
    this.lastLoad = { ok: true, why: '', raw: '' };
    this.load();
  }
  load() {
    let raw = null;
    try {
      raw = this.storage ? this.storage.getItem(KEY) : null;
    } catch (e) {
      this.lastLoad = { ok: false, why: `读不到存档（${e.name}）`, raw: '' };
      return this.data;
    }
    if (!raw) {
      this.lastLoad = { ok: true, why: '没有存档', raw: '' };
      return this.data;
    }
    try {
      const d = JSON.parse(raw);
      if (!d || typeof d !== 'object' || d.v !== 1) throw new Error('版本不对或不是对象');
      const base = DEFAULTS();
      this.data = {
        ...base,
        ...d,
        settings: { ...base.settings, ...(d.settings || {}) },
        best: d.best && typeof d.best === 'object' ? d.best : {},
        totals: { ...base.totals, ...(d.totals || {}) },
      };
      if (!Number.isInteger(this.data.seedCounter) || this.data.seedCounter < 1) this.data.seedCounter = 1;
      this.lastLoad = { ok: true, why: 'ok', raw };
    } catch (e) {
      // 坏档：整份退回默认，但把原文留在 lastLoad.raw 里 —— 界面要能说出"档是坏的"，
      // 而不是静悄悄变成第一次打开。
      this.data = DEFAULTS();
      this.lastLoad = { ok: false, why: `存档解析失败（${e.message}）`, raw };
    }
    return this.data;
  }
  save() {
    try {
      if (this.storage) this.storage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* 隐私模式 / 配额：存档写不进去不影响这一局能玩 */
    }
    return this.data;
  }
  // 换一局用的游标：先读现在这一号，再把游标推后一位，所以 peekSeed() > 当前 seed 恒成立。
  peekSeed() {
    return this.data.seedCounter;
  }
  takeSeed() {
    const s = this.data.seedCounter;
    this.data.seedCounter = s + 1;
    this.save();
    return s;
  }
  set(key, value) {
    this.data.settings[key] = value;
    this.save();
  }
  get(key) {
    return this.data.settings[key];
  }
  // resume 是**整份替换**的：局一开局就写一次，之后每次落子更新。
  // 坏档通道（corrupt 腿）要能读到我们没写过的东西，所以这里不合并、不猜。
  // 这里只验"形状"（类型对不对、档位认不认得）；盘面串能不能落地，由 ui/game.js 的
  // setCodes 走同一条状态机重放来判 —— 形状对而内容坏的档（cells:'zzz'）就是在那一步判掉的。
  putResume(resume) {
    this.data.resume = resume;
    this.save();
  }
  clearResume() {
    this.data.resume = null;
    this.save();
  }
  // tierOf 由调用方传进来（档位表住在 ui/game.js，这里不 import 引擎，免得存档层能改盘面）
  resume(tierOf) {
    const r = this.data.resume;
    if (!r || typeof r !== 'object') return null;
    if (typeof r.tier !== 'string' || !Number.isInteger(r.seed) || typeof r.cells !== 'string') return null;
    if (!Number.isInteger(r.strokes) || !Number.isInteger(r.hints)) return null;
    if (!tierOf(r.tier)) return null;
    return r;
  }
  record(tier, { strokes, hints, ms }) {
    const prev = this.data.best[tier];
    // 同档比：先看不求提示几次，再看动数，最后看时间。
    const better = !prev || hints < prev.hints || (hints === prev.hints && (strokes < prev.strokes || (strokes === prev.strokes && ms < prev.ms)));
    if (better) this.data.best[tier] = { strokes, hints, ms, at: Date.now() };
    this.data.totals.solved += 1;
    this.data.totals.hints += hints;
    this.data.totals.ms += ms;
    this.save();
    return { improved: better, best: this.data.best[tier] };
  }
  reset() {
    this.data = DEFAULTS();
    this.save();
    return this.data;
  }
}

export const STORAGE_KEY = KEY;
