// 确定性随机源：hashSeed + mulberry32 + shuffle。
//
// 为什么单独成一个模块（而不是"谁要用谁自己写两行"）：本仓的**全部**读数都建立在
// 「同一串 seed 在 node 和 Chrome 里画出同一张盘」这句话上。两侧各写一份 PRNG，
// 这句话就只是一句愿望。
//
// 两条写死的纪律（都是别的仓踩过之后抬进来的）：
//   ① 比较器里不许抽随机数。`arr.sort(() => rnd() - 0.5)` 在 V8 的两条排序路径上会给出
//      两种结果（node/Chrome 画出两张盘），所以打乱一律走下面的 shuffle()：先抽一个
//      **和元素无关**的键，再按键排；键的抽取顺序只取决于 rnd 的调用次数。
//   ② 默认种子不许按日期算。"新的一局"配日期种子 = 界面上那句"这一局是…"说谎。
//      要"下一局"就用 seed + k 自增（js/engine/generate.js 的 shipPuzzle 就是这么做的），
//      并把 k 记进 stats，让"为了出这一盘重试了几次"是一条可对账的数。
export function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export function mulberry32(a) {
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 确定性打乱：Fisher–Yates，随机只来自传入的 rnd，比较器（这里根本没有比较器）不抽奖。
export function shuffle(list, rnd) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
}

// 串 = 标签 + 参数。所有参数都进串，所以「换个尺寸/换个球数」必然换一列种子，
// 不会出现两档共用同一批随机数而读数互相污染。
export function seeded(tag, ...parts) {
  return mulberry32(hashSeed(`${tag}|${parts.join('|')}`));
}
