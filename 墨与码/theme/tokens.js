/* 三种风格的字体与配色，生成 CSS 变量 */
const MONO = '"JetBrains Mono","SFMono-Regular",Menlo,Consolas,"Liberation Mono",monospace';
const SANS = '"Noto Sans SC","Noto Sans CJK SC","PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif';
const SERIF = '"Noto Serif SC","Noto Serif CJK SC","Source Han Serif SC","Songti SC","STSong","SimSun",serif';

const base = { maxw: '760px', 'prose-size': '17px' };
const vars = {
  paper: { 'font-body': SERIF, 'font-head': SERIF, 'font-ui': SERIF, 'font-display': SERIF, 'font-cover': SERIF, 'font-read': SERIF, 'font-mono': MONO,
    'head-weight': '900', 'title-weight': '700', 'head-track': '.04em', radius: '3px', 'btn-radius': '3px', 'code-radius': '4px',
    'read-lh': '1.95', 'body-size': '17px', surface: 'var(--bg2)' },
  minimal: { 'font-body': '"Inter",' + SANS, 'font-head': '"Inter",' + SANS, 'font-ui': '"Inter",' + SANS, 'font-display': '"Inter",' + SANS,
    'font-cover': '"Inter",' + SANS, 'font-read': SANS, 'font-mono': MONO,
    'head-weight': '800', 'title-weight': '700', 'head-track': '-.02em', radius: '8px', 'btn-radius': '999px', 'code-radius': '10px',
    'read-lh': '1.85', 'body-size': '16px', 'prose-size': '16.5px', surface: 'var(--bg)' },
  terminal: { 'font-body': SANS, 'font-head': MONO.replace('monospace', '') + SANS, 'font-ui': MONO.replace('monospace', '') + SANS,
    'font-display': MONO, 'font-cover': MONO, 'font-read': SANS, 'font-mono': MONO,
    'head-weight': '700', 'title-weight': '600', 'head-track': '0', radius: '4px', 'btn-radius': '4px', 'code-radius': '4px',
    'read-lh': '1.85', 'body-size': '16px', 'prose-size': '16px', surface: 'var(--bg)' }
};

const pal = {
  paper: {
    light: { bg: '#e7e2d6', bg2: '#f9f6ef', fg: '#1f2433', fg2: '#3f4556', muted: '#7d7a72', line: '#ddd5c4', accent: '#2b4c8c', 'accent-fg': '#f9f6ef',
      'accent-soft': 'rgba(43,76,140,.09)', sel: 'rgba(43,76,140,.18)', 'code-bg': '#f0ebdf', 'code-fg': '#26304a', shadow: 'rgba(60,45,20,.35)',
      wash: 'transparent', danger: '#a8322a', accent2: '#2b4c8c',
      'hl-kw': '#8a2f5b', 'hl-str': '#4d6b2f', 'hl-num': '#9a5b1e', 'hl-com': '#9a9384', 'hl-fn': '#2b4c8c', 'hl-type': '#6b4f8f' },
    dark: { bg: '#111316', bg2: '#1a1d21', fg: '#e6e2d9', fg2: '#c4c0b6', muted: '#8a877f', line: '#2d3036', accent: '#93b1e8', 'accent-fg': '#111316',
      'accent-soft': 'rgba(147,177,232,.12)', sel: 'rgba(147,177,232,.25)', 'code-bg': '#14161a', 'code-fg': '#dcd8cf', shadow: 'rgba(0,0,0,.7)',
      wash: 'transparent', danger: '#e0786e', accent2: '#93b1e8',
      'hl-kw': '#e39ac0', 'hl-str': '#b5cf8f', 'hl-num': '#e6b47a', 'hl-com': '#75726c', 'hl-fn': '#93b1e8', 'hl-type': '#c3a8e6' }
  },
  minimal: {
    light: { bg: '#fcfcfb', bg2: '#f2f2f0', fg: '#141414', fg2: '#3d3d3d', muted: '#86867f', line: '#e6e6e2', accent: '#002fa7', 'accent-fg': '#ffffff',
      'accent-soft': 'rgba(0,47,167,.07)', sel: 'rgba(0,47,167,.16)', 'code-bg': '#f3f3f1', 'code-fg': '#1f2328', shadow: 'rgba(0,0,0,.25)',
      wash: 'transparent', danger: '#c62828', accent2: '#002fa7',
      'hl-kw': '#cf222e', 'hl-str': '#0a3069', 'hl-num': '#0550ae', 'hl-com': '#8c959f', 'hl-fn': '#8250df', 'hl-type': '#953800' },
    dark: { bg: '#0f1011', bg2: '#18191b', fg: '#f1f1ef', fg2: '#cfcfcc', muted: '#8a8a86', line: '#26272a', accent: '#7f97ff', 'accent-fg': '#0f1011',
      'accent-soft': 'rgba(127,151,255,.12)', sel: 'rgba(127,151,255,.25)', 'code-bg': '#16171a', 'code-fg': '#e6edf3', shadow: 'rgba(0,0,0,.7)',
      wash: 'transparent', danger: '#ff7b72', accent2: '#7f97ff',
      'hl-kw': '#ff7b72', 'hl-str': '#a5d6ff', 'hl-num': '#79c0ff', 'hl-com': '#8b949e', 'hl-fn': '#d2a8ff', 'hl-type': '#ffa657' }
  },
  terminal: {
    light: { bg: '#f4f2ec', bg2: '#ffffff', fg: '#1d232b', fg2: '#3a4350', muted: '#707985', line: '#dcd8ce', accent: '#a85700', 'accent-fg': '#ffffff',
      'accent-soft': 'rgba(168,87,0,.08)', sel: 'rgba(168,87,0,.18)', 'code-bg': '#ebe8df', 'code-fg': '#1d232b', shadow: 'rgba(0,0,0,.25)',
      wash: 'transparent', danger: '#c62828', accent2: '#00748a',
      'hl-kw': '#b5410e', 'hl-str': '#4d7a12', 'hl-num': '#9a6700', 'hl-com': '#8a929b', 'hl-fn': '#0b6e99', 'hl-type': '#7a3db8' },
    dark: { bg: '#0d1015', bg2: '#141922', fg: '#d5dbe3', fg2: '#aeb7c2', muted: '#6e7a88', line: '#232b36', accent: '#f3a536', 'accent-fg': '#0d1015',
      'accent-soft': 'rgba(243,165,54,.1)', sel: 'rgba(243,165,54,.25)', 'code-bg': '#090c10', 'code-fg': '#d5dbe3', shadow: 'rgba(0,0,0,.7)',
      wash: 'transparent', danger: '#ff7b72', accent2: '#5fc4d8',
      'hl-kw': '#ff9e64', 'hl-str': '#9ece6a', 'hl-num': '#e0af68', 'hl-com': '#5c6773', 'hl-fn': '#7dcfff', 'hl-type': '#bb9af7' }
  }
};

const HM = {"paper": [{"hm-blog": "#2b4c8c", "hm-novel": "#b5532b", "hm-empty": "#ebe5d8"}, {"hm-blog": "#93b1e8", "hm-novel": "#e0905f", "hm-empty": "#262a30"}], "minimal": [{"hm-blog": "#002fa7", "hm-novel": "#e4572e", "hm-empty": "#ececea"}, {"hm-blog": "#7f97ff", "hm-novel": "#ff8a5c", "hm-empty": "#222326"}], "terminal": [{"hm-blog": "#a85700", "hm-novel": "#00748a", "hm-empty": "#e6e2d8"}, {"hm-blog": "#f3a536", "hm-novel": "#5fc4d8", "hm-empty": "#1a212b"}]};
for (const k of Object.keys(HM)) { Object.assign(pal[k].light, HM[k][0]); Object.assign(pal[k].dark, HM[k][1]); }
const decl = (o) => Object.entries(o).map(([k, v]) => `--${k}:${v};`).join('');
let tokens = '';
for (const k of Object.keys(pal)) {
  tokens += `[data-style="${k}"]{${decl(base)}${decl(vars[k])}${decl(pal[k].light)}color-scheme:light}\n`;
  tokens += `@media (prefers-color-scheme: dark){:root:not([data-theme="light"])[data-style="${k}"],:root:not([data-theme="light"]) [data-style="${k}"]{${decl(pal[k].dark)}color-scheme:dark}}\n`;
  tokens += `:root[data-theme="dark"][data-style="${k}"],:root[data-theme="dark"] [data-style="${k}"]{${decl(pal[k].dark)}color-scheme:dark}\n`;
  // 访客手动选择的日间 / 夜间模式，优先于系统设置
  tokens += `:root[data-mode="light"][data-style="${k}"],:root[data-mode="light"] [data-style="${k}"]{${decl(pal[k].light)}color-scheme:light}\n`;
  tokens += `:root[data-mode="dark"][data-style="${k}"],:root[data-mode="dark"] [data-style="${k}"]{${decl(pal[k].dark)}color-scheme:dark}\n`;
}


module.exports = { tokens };
