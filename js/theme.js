// 调色板与主题变量。画布只吃 Palette（JS 里的数），DOM 只吃 CSS 自定义属性，
// 两边由同一份 applyThemeVars 喂 —— 于是"画出来的绿"和"文字绿"不会各说各话。
export const Palette = {
  bg: '#0A0D14',
  panel: '#111725',
  line: '#243049',
  cell: '#F5F1E6',
  cellAlt: '#EDE7D6',
  grid: '#8C8674',
  pond: '#3A4A63',
  pondEdge: '#20304a',
  hole: '#1A1F2B',
  holeRing: '#0d1119',
  ball: '#FFFFFF',
  ballEdge: '#20242c',
  ballText: '#101418',
  route: '#4CC38A',
  routeShadow: 'rgba(76,195,138,0.28)',
  selected: '#FFC24B',
  target: '#5AB0FF',
  done: '#4CC38A',
  text: '#E7ECF5',
  dim: '#8B97AD',
  bad: '#FF6B6B',
};

const KEYS = {
  bg: '--c-bg',
  panel: '--c-panel',
  line: '--c-line',
  cell: '--c-cell',
  grid: '--c-grid',
  pond: '--c-pond',
  hole: '--c-hole',
  ball: '--c-ball',
  route: '--c-route',
  selected: '--c-selected',
  target: '--c-target',
  text: '--c-text',
  dim: '--c-dim',
  bad: '--c-bad',
};

export function applyThemeVars(root = document.documentElement) {
  for (const [k, v] of Object.entries(KEYS)) root.style.setProperty(v, Palette[k]);
}

export function systemPrefersReducedMotion() {
  return !!(globalThis.matchMedia && globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

// 动效开关：关掉之后渲染不再排 requestAnimationFrame，只画一次。
// 闸在注入场景时会把 document.hidden 掰成 false（headless 把页面报成后台，
// 于是一个等动画的场景会对着一个"假装在后台"的浏览器超时），所以这里不许再依赖 hidden。
export function setReduceMotion(on, root = document.documentElement) {
  root.dataset.motion = on ? 'off' : 'on';
}
