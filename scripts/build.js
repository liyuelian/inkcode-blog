/* 网站生成脚本：读取 content/ 里的 Markdown，生成完整的静态网站到 dist/。
 * GitHub Actions 每次有新提交时自动运行；本地预览用 npm run dev。
 *
 * 环境变量：
 *   SITE_URL           网站地址，例如 https://用户名.github.io/仓库名（Actions 里自动获取）
 *   GITHUB_REPOSITORY  仓库全名，手机后台用来连接仓库（Actions 里自动提供）
 *   GITHUB_REF_NAME    分支名
 *   GITHUB_SHA         本次构建对应的提交
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { marked } = require('marked');
const hljs = require('highlight.js');
const SiteFiles = require('../admin/files.js');
const { taxonomyPaths } = require('./taxonomy-paths.js');
const { tokens } = require('../theme/tokens.js');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'dist');
const NOW = new Date();

/* ---------- 读取内容 ---------- */
function walk(dir, base, out) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const rel = base ? base + '/' + name : name;
    if (fs.statSync(full).isDirectory()) walk(full, rel, out);
    else out[rel] = full;
  }
  return out;
}
const contentFiles = {};
for (const [rel, full] of Object.entries(walk(path.join(ROOT, 'content'), 'content', {}))) {
  if (SiteFiles.isContentPath(rel)) contentFiles[rel] = fs.readFileSync(full, 'utf8');
}
const model = SiteFiles.modelFromFiles(contentFiles);
const site = Object.assign({ name: '我的网站', tagline: '', bio: '', links: [], seal: '', style: 'paper', timezone: 'Asia/Shanghai' }, model.site);
if (!['paper', 'minimal', 'terminal'].includes(site.style)) site.style = 'paper';

const SITE_URL = (process.env.SITE_URL || site.url || 'http://localhost:4000').replace(/\/+$/, '');
const BASE = new URL(SITE_URL + '/').pathname.replace(/\/+$/, '');
const u = (p) => BASE + p;                       // 站内地址
const abs = (p) => SITE_URL + p;                 // 完整地址

const posts = model.posts.filter((p) => !p.draft).sort((a, b) => (a.created < b.created ? 1 : -1));
const listed = posts.filter((p) => p.pinned).concat(posts.filter((p) => !p.pinned));
const novels = model.novels.map((n) => Object.assign({}, n, { chapters: n.chapters.filter((c) => !c.draft) }));

/* ---------- 小工具 ---------- */
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const wordCount = (t) => ((t || '').match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length + ((t || '').match(/[A-Za-z0-9_]+/g) || []).length;
const fmtWords = (n) => (n >= 10000 ? (n / 10000).toFixed(1).replace(/\.0$/, '') + ' 万' : String(n));
const readMins = (t) => Math.max(1, Math.round(wordCount(t) / 400));
const paras = (t) => (t || '').split(/\n+/).map((l) => l.trim()).filter(Boolean).map((l) => '<p>' + esc(l) + '</p>').join('');
const tagPaths = taxonomyPaths(posts.flatMap((p) => p.tags));
const seriesPaths = taxonomyPaths(posts.map((p) => p.series).filter(Boolean));
const novelWords = (n) => n.chapters.reduce((a, c) => a + wordCount(c.content), 0);
function dateParts(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return null;
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: site.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const [y, m, day] = f.split('-');
  return { y: +y, m: +m, d: +day, key: f };
}
function fmtDate(iso) {
  const p = dateParts(iso);
  if (!p) return '';
  return site.style === 'terminal' ? p.key : p.y + '年' + p.m + '月' + p.d + '日';
}
function autoSummary(md) {
  const t = (md || '').replace(/```[\s\S]*?```/g, ' ').replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*(#{1,6}|>|[-*+]|\d+\.)\s*/gm, '').replace(/\[![A-Za-z\u4e00-\u9fff]+\]/g, '').replace(/[`*_~|]/g, '').replace(/\s+/g, ' ').trim();
  return t.length > 90 ? t.slice(0, 90) + '…' : t;
}
const sealText = () => (site.seal || '').trim() || Array.from(site.name || '印').slice(0, 2).join('');
const postUrl = (p) => u('/posts/' + p.id + '/');
const novelUrl = (n) => u('/novels/' + n.id + '/');
const chapterUrl = (n, c) => u('/novels/' + n.id + '/' + c.id + '/');
const tagUrl = (t) => u('/tags/' + encodeURIComponent(tagPaths.get(t)) + '/');
const seriesUrl = (s) => u('/series/' + encodeURIComponent(seriesPaths.get(s)) + '/');

/* ---------- Markdown ---------- */
const CALLOUTS = {
  NOTE: ['说明', 'note'], TIP: ['提示', 'tip'], IMPORTANT: ['重要', 'important'], WARNING: ['注意', 'warning'], CAUTION: ['警告', 'caution'],
  说明: ['说明', 'note'], 提示: ['提示', 'tip'], 重要: ['重要', 'important'], 注意: ['注意', 'warning'], 警告: ['警告', 'caution']
};
const ICONS = {
  note: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.5v.01"/>',
  tip: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3Z"/>',
  important: '<path d="M4 4h16v12H8l-4 4V4Z"/><path d="M12 7v4M12 13.5v.01"/>',
  warning: '<path d="M12 3 2 20h20L12 3Z"/><path d="M12 10v4M12 17v.01"/>',
  caution: '<path d="M8 3h8l5 5v8l-5 5H8l-5-5V8l5-5Z"/><path d="M12 8v5M12 16v.01"/>'
};
const FOLD_LINES = 24;
const fixUrl = (href) => (/^\/(?!\/)/.test(href || '') ? u(href) : href);
const renderer = new marked.Renderer();
renderer.code = function (code, info) {
  info = (info || '').trim();
  const first = info.split(/\s+/)[0] || '';
  const lang = first.replace(/[^\w+#.-]/g, '');
  const rest = info.slice(first.length).trim();
  const tm = /^title\s*=\s*["']?(.+?)["']?$/.exec(rest);
  const title = tm ? tm[1] : rest;
  const lines = code.replace(/\n$/, '').split('\n');
  let inner;
  if (lang === 'diff') {
    inner = lines.map((l) => {
      const c = l[0] === '+' ? ' add' : l[0] === '-' ? ' del' : l[0] === '@' ? ' hunk' : '';
      return '<span class="dl' + c + '">' + (esc(l) || ' ') + '</span>';
    }).join('');
  } else if (lang && hljs.getLanguage(lang)) {
    try { inner = hljs.highlight(code, { language: lang, ignoreIllegals: true }).value; } catch (e) { inner = esc(code); }
  } else inner = esc(code);
  const folded = lines.length > FOLD_LINES;
  return '<div class="code-block' + (folded ? ' folded' : '') + '"><div class="code-bar">' +
    (title ? '<span class="code-file">' + esc(title) + '</span>' : '') +
    '<span class="code-lang">' + esc(lang || (title ? '' : 'code')) + '</span><button type="button" class="code-copy">复制</button></div>' +
    '<div class="code-body">' + (lines.length >= 5 ? '<div class="code-gutter" aria-hidden="true">' + lines.map((l, i) => i + 1).join('\n') + '</div>' : '') +
    '<pre><code class="hljs' + (lang ? ' language-' + esc(lang) : '') + (lang === 'diff' ? ' is-diff' : '') + '">' + inner + '</code></pre></div>' +
    (folded ? '<button type="button" class="code-more" data-lines="' + lines.length + '">展开全部 ' + lines.length + ' 行</button>' : '') + '</div>\n';
};
renderer.blockquote = function (quote) {
  const m = /^\s*<p>\s*\[!([A-Za-z]+|[\u4e00-\u9fff]{2})\]([^<]*?)\s*(<br\s*\/?>\s*|<\/p>\s*)/.exec(quote);
  const def = m && CALLOUTS[/^[a-z]+$/i.test(m[1]) ? m[1].toUpperCase() : m[1]];
  if (!def) return '<blockquote>\n' + quote + '</blockquote>\n';
  const title = m[2].trim() || def[0];
  let rest = quote.slice(m[0].length);
  rest = /<\/p>/.test(m[3]) ? rest : '<p>' + rest;
  return '<div class="callout callout-' + def[1] + '" role="note"><p class="callout-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    ICONS[def[1]] + '</svg>' + title + '</p>' + rest.replace(/<p>\s*<\/p>/g, '') + '</div>\n';
};
renderer.image = function (href, title, text) {
  return '<img src="' + esc(fixUrl(href)) + '" alt="' + (text || '') + '" loading="lazy" decoding="async"' + (title ? ' title="' + esc(title) + '"' : '') + '>';
};
renderer.link = function (href, title, text) {
  href = href || '';
  if (/^\s*(javascript|vbscript|data):/i.test(href)) href = '#';
  const ext = /^https?:/i.test(href);
  return '<a href="' + esc(fixUrl(href)) + '"' + (title ? ' title="' + esc(title) + '"' : '') + (ext ? ' target="_blank" rel="noopener"' : '') + '>' + text + '</a>';
};
marked.setOptions({ renderer, gfm: true, breaks: true, headerIds: false, mangle: false });
const md = (s) => marked.parse(s || '').replace(/<table>/g, '<div class="table-wrap"><table>').replace(/<\/table>/g, '</table></div>');
function chapterHtml(t) {
  return (t || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) =>
    /^([*＊]\s*){3,}$|^(-\s*){3,}$|^—{2,}$/.test(l) ? '<div class="scene-break" aria-hidden="true"></div>' : '<p>' + esc(l) + '</p>').join('');
}
const firstImage = (s) => { const m = /!\[[^\]]*\]\((\/[^)\s]+)/.exec(s || ''); return m ? abs(m[1]) : ''; };

/* ---------- 资源文件 ---------- */
const STYLE_FONTS = {
  paper: 'family=Noto+Serif+SC:wght@400;700;900&family=Noto+Sans+SC:wght@700&family=JetBrains+Mono:wght@400',
  minimal: 'family=Inter:wght@400;600;800&family=Noto+Sans+SC:wght@400;700;800&family=Noto+Serif+SC:wght@700;900&family=JetBrains+Mono:wght@400',
  terminal: 'family=JetBrains+Mono:wght@400;700&family=Noto+Sans+SC:wght@400;700&family=Noto+Serif+SC:wght@700;900'
};
const fontBase = typeof site.fontBase === 'string' ? site.fontBase : 'https://fonts.googleapis.com/css2';
const fontHref = fontBase ? fontBase + (fontBase.includes('?') ? '&' : '?') + STYLE_FONTS[site.style] + '&display=swap' : '';
const css = tokens + fs.readFileSync(path.join(ROOT, 'theme', 'style.css'), 'utf8') + '\n' + fs.readFileSync(path.join(ROOT, 'theme', 'extra.css'), 'utf8');
const siteJs = fs.readFileSync(path.join(ROOT, 'theme', 'site.js'), 'utf8');
const hash = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 10);
const CSS_URL = u('/assets/site.css?v=' + hash(css));
const JS_URL = u('/assets/site.js?v=' + hash(siteJs));

/* ---------- 页面外壳 ---------- */
const ICON = 'data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 100 100%27%3E%3Ctext y=%27.9em%27 font-size=%2790%27%3E%F0%9F%96%8B%3C/text%3E%3C/svg%3E';
const SEARCH_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';
const MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.5 14.2A8.5 8.5 0 1 1 9.8 3.5a6.6 6.6 0 0 0 10.7 10.7Z"/></svg>';
function layout(o) {
  const title = o.title ? o.title + ' - ' + site.name : site.name;
  const desc = o.desc || site.tagline || '';
  const nav = [['blog', '博客', '/blog/'], ['novels', '小说', '/novels/'], ['archive', '归档', '/archive/']].map(([k, label, p]) =>
    '<a href="' + u(p) + '"' + (k === o.nav ? ' class="on" aria-current="page"' : '') + '>' + label + '</a>').join('');
  return '<!doctype html>\n<html lang="zh-CN" data-style="' + site.style + '">\n<head>\n<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n' +
    '<title>' + esc(title) + '</title>\n' +
    (desc ? '<meta name="description" content="' + esc(desc) + '">\n' : '') +
    '<link rel="canonical" href="' + esc(abs(o.path)) + '">\n' +
    '<meta property="og:site_name" content="' + esc(site.name) + '">\n<meta property="og:title" content="' + esc(o.title || site.name) + '">\n' +
    '<meta property="og:type" content="' + (o.type || 'website') + '">\n<meta property="og:url" content="' + esc(abs(o.path)) + '">\n' +
    (desc ? '<meta property="og:description" content="' + esc(desc) + '">\n' : '') +
    (o.image ? '<meta property="og:image" content="' + esc(o.image) + '">\n<meta name="twitter:card" content="summary_large_image">\n' : '<meta name="twitter:card" content="summary">\n') +
    '<link rel="alternate" type="application/rss+xml" title="' + esc(site.name) + '" href="' + u('/feed.xml') + '">\n' +
    '<link rel="icon" href="' + ICON + '">\n' +
    '<script>try{var m=localStorage.getItem("site:mode");if(m==="dark"||m==="light")document.documentElement.setAttribute("data-mode",m)}catch(e){}</script>\n' +
    (fontHref ? '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n<link rel="stylesheet" href="' + esc(fontHref) + '" media="print" onload="this.media=\'all\'">\n' : '') +
    '<link rel="stylesheet" href="' + CSS_URL + '">\n' +
    '<script defer src="' + JS_URL + '"></script>\n' +
    '</head>\n<body data-page="' + (o.page || '') + '" data-base="' + esc(BASE) + '"' + (o.attrs || '') + '>\n' +
    '<header class="nav"><div class="nav-in"><a class="brand" href="' + u('/') + '"><span class="brand-name">' + esc(site.name) + '</span></a>' +
    '<nav class="nav-links" aria-label="主导航">' + nav + '</nav>' +
    '<a class="mode-btn" href="' + u('/search/') + '" aria-label="搜索">' + SEARCH_ICON + '</a>' +
    '<button type="button" class="mode-btn" id="mode-btn" aria-label="切换日间或夜间模式">' + MOON + '</button></div>' +
    (o.progress ? '<div class="read-progress" id="read-progress" aria-hidden="true"></div>' : '') + '</header>\n' +
    '<main class="main" id="main">' + o.body + '</main>\n' +
    '<footer class="foot"><span>© ' + NOW.getFullYear() + ' ' + esc(site.name) + '</span><span class="foot-r">' +
    '<a href="' + u('/feed.xml') + '">RSS</a><button type="button" data-top>回到顶部</button></span></footer>\n' +
    (o.data ? '<script type="application/json" id="page-data">' + JSON.stringify(o.data).replace(/</g, '\\u003c') + '</script>\n' : '') +
    '</body>\n</html>\n';
}
const written = [];
function write(p, html, inSitemap = true) {
  const file = path.join(OUT, p.endsWith('/') ? p + 'index.html' : p);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, html);
  if (inSitemap && p.endsWith('/')) written.push(p);
}

/* ---------- 组件 ---------- */
function postItem(p) {
  const sum = p.summary || autoSummary(p.content);
  return '<a class="post-item" href="' + postUrl(p) + '"><h3>' + (p.pinned ? '<span class="pin-badge">置顶</span>' : '') + esc(p.title) + '</h3>' +
    (sum ? '<p class="pi-sum">' + esc(sum) + '</p>' : '') +
    '<div class="pi-meta"><time datetime="' + esc(p.created) + '">' + fmtDate(p.created) + '</time><span>' + readMins(p.content) + ' 分钟读完</span>' +
    (p.series ? '<span class="sr">系列：' + esc(p.series) + '</span>' : '') +
    p.tags.map((t) => '<span class="tg">#' + esc(t) + '</span>').join('') + '</div></a>';
}
const COVERS = ['ink', 'zhu', 'dai', 'zhuye', 'zhe', 'yue'], TPLS = ['thread', 'night', 'sun', 'star', 'note', 'deco'];
function coverHtml(n) {
  const author = (n.author || site.name || '').trim();
  return '<div class="cover ct-' + (TPLS.includes(n.tpl) ? n.tpl : 'thread') + ' cv-' + (COVERS.includes(n.cover) ? n.cover : 'dai') + '" aria-hidden="true">' +
    '<span class="cv-art"></span><span class="cv-text"><span class="cv-title">' + esc(n.title) + '</span>' +
    (author ? '<span class="cv-sign"><i>' + esc(author) + ' 著</i><em>' + esc(sealText()) + '</em></span>' : '') + '</span></div>';
}
const statusText = (n) => (n.status === 'done' ? '已完结' : '连载中');
function novelCard(n) {
  return '<a class="novel-card" href="' + novelUrl(n) + '">' + coverHtml(n) + '<div class="nc-body"><h3>' + esc(n.title) + '</h3><p class="nc-meta">' +
    (n.genre ? '<span>' + esc(n.genre) + '</span>' : '') + '<span class="' + (n.status === 'done' ? '' : 'st-on') + '">' + statusText(n) + '</span>' +
    '<span>' + n.chapters.length + ' 章</span></p></div></a>';
}
function pager(cur, total, base) {
  if (total <= 1) return '';
  const href = (n) => base + (n > 1 ? 'page/' + n + '/' : '');
  const nums = [...new Set([1, total, cur - 1, cur, cur + 1])].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
  let prev = 0, out = '';
  for (const n of nums) {
    if (n - prev > 1) out += '<span class="pg-gap" aria-hidden="true">…</span>';
    out += n === cur ? '<span class="pg-num on" aria-current="page">' + n + '</span>' : '<a class="pg-num" href="' + href(n) + '">' + n + '</a>';
    prev = n;
  }
  const btn = (n, label, rel) => (n < 1 || n > total ? '<span class="pg-btn off" aria-hidden="true">' + label + '</span>' : '<a class="pg-btn" rel="' + rel + '" href="' + href(n) + '">' + label + '</a>');
  return '<nav class="pagination" aria-label="分页，第 ' + cur + ' 页，共 ' + total + ' 页">' + btn(cur - 1, '上一页', 'prev') + '<span class="pg-nums">' + out + '</span>' + btn(cur + 1, '下一页', 'next') + '</nav>';
}
function paginate(items, size, basePath, render) {
  const total = Math.max(1, Math.ceil(items.length / size));
  for (let i = 1; i <= total; i++) render(items.slice((i - 1) * size, i * size), i, total, basePath + (i > 1 ? 'page/' + i + '/' : ''));
}
const empty = (msg) => '<div class="empty">' + esc(msg) + '</div>';

/* ---------- 开始生成 ---------- */
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(path.join(OUT, 'assets'), { recursive: true });
fs.writeFileSync(path.join(OUT, 'assets', 'site.css'), css);
fs.writeFileSync(path.join(OUT, 'assets', 'site.js'), siteJs);
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
const STATIC = path.join(ROOT, 'static');
if (fs.existsSync(STATIC)) fs.cpSync(STATIC, OUT, { recursive: true });

// 首页
{
  const links = (site.links || []).map((l) => '<a href="' + esc(l.url) + '" target="_blank" rel="noopener">' + esc(l.label || l.url) + '</a>').join('');
  const hero = '<header class="hero"><div class="hero-prompt x-terminal" aria-hidden="true"><span class="pr">guest@home</span>:<span class="pa">~</span>$ cat about.md</div>' +
    '<h1 class="hero-name"><span>' + esc(site.name) + '</span><i class="cursor x-terminal" aria-hidden="true"></i></h1>' +
    (site.tagline ? '<p class="hero-tag">' + esc(site.tagline) + '</p>' : '') + (site.bio ? '<div class="hero-bio">' + paras(site.bio) + '</div>' : '') +
    (links ? '<div class="hero-links">' + links + '</div>' : '') + '</header>';
  const sec = (title, href, label) => '<div class="sec-head"><h2>' + title + '</h2>' + (href ? '<a href="' + href + '">' + label + '</a>' : '') + '</div>';
  const body = hero +
    '<section class="sec">' + sec('技术博客', posts.length ? u('/blog/') : '', posts.length > 4 ? '全部 ' + posts.length + ' 篇' : '文章列表') +
    (posts.length ? '<div class="post-list">' + listed.slice(0, 4).map(postItem).join('') + '</div>' : empty('这里还没有文章。')) + '</section>' +
    '<section class="sec">' + sec('小说', novels.length ? u('/novels/') : '', '全部作品') +
    (novels.length ? '<div class="novel-grid">' + novels.map(novelCard).join('') + '</div>' : empty('这里还没有作品。')) + '</section>';
  write('/', layout({ path: '/', body, nav: 'home', page: 'home' }));
}

// 标签
const tagCount = Object.create(null), tagLast = Object.create(null);
posts.forEach((p) => p.tags.forEach((t) => {
  tagCount[t] = (tagCount[t] || 0) + 1;
  if (!tagLast[t] || p.created > tagLast[t]) tagLast[t] = p.created;
}));
const allTags = Object.keys(tagCount).sort((a, b) => tagCount[b] - tagCount[a] || (tagLast[b] > tagLast[a] ? 1 : tagLast[b] < tagLast[a] ? -1 : 0));
function chips(active) {
  if (!allTags.length) return '';
  return '<div class="chips" data-limit="12"><a class="chip' + (!active ? ' on' : '') + '" href="' + u('/blog/') + '">全部</a>' +
    allTags.map((t, i) => '<a class="chip' + (t === active ? ' on' : '') + (i >= 12 && t !== active ? ' extra' : '') + '" href="' + tagUrl(t) + '">' + esc(t) + '<small>' + tagCount[t] + '</small></a>').join('') +
    (allTags.length > 12 ? '<button type="button" class="chip more" data-more>全部 ' + allTags.length + ' 个标签</button>' : '') + '</div>';
}
const searchBox = '<form class="blog-search" action="' + u('/search/') + '" method="get" role="search"><input class="input search" type="search" name="q" placeholder="搜索文章和小说" aria-label="搜索"></form>';

// 博客列表、标签页、系列页
paginate(listed, 8, '/blog/', (items, pg, total, p) => {
  write(p, layout({
    path: p, nav: 'blog', page: 'blog', title: pg > 1 ? '技术博客（第 ' + pg + ' 页）' : '技术博客',
    body: '<div class="page-head"><h1>技术博客</h1><p>' + posts.length + ' 篇文章</p></div>' + (posts.length > 3 ? searchBox : '') + chips('') +
      '<div class="post-list">' + (items.length ? items.map(postItem).join('') : empty('这里还没有文章。')) + '</div>' + pager(pg, total, u('/blog/'))
  }));
});
for (const t of allTags) {
  const base = '/tags/' + tagPaths.get(t) + '/';
  paginate(listed.filter((p) => p.tags.includes(t)), 8, base, (items, pg, total, p) => {
    write(p, layout({
      path: p, nav: 'blog', page: 'blog', title: '#' + t,
      body: '<div class="page-head"><h1>技术博客</h1><p>标签「' + esc(t) + '」下的 ' + tagCount[t] + ' 篇文章</p></div>' + chips(t) +
        '<div class="post-list">' + items.map(postItem).join('') + '</div>' + pager(pg, total, tagUrl(t))
    }));
  });
}
const seriesMap = Object.create(null);
posts.forEach((p) => { if (p.series) (seriesMap[p.series] = seriesMap[p.series] || []).push(p); });
Object.values(seriesMap).forEach((l) => l.sort((a, b) => (a.created < b.created ? -1 : 1)));
for (const [name, list] of Object.entries(seriesMap)) {
  const p = '/series/' + seriesPaths.get(name) + '/';
  write(p, layout({
    path: p, nav: 'blog', page: 'blog', title: name,
    body: '<a class="back" href="' + u('/blog/') + '">‹ 技术博客</a><div class="page-head"><h1>' + esc(name) + '</h1><p>系列文章，共 ' + list.length + ' 篇，按发布顺序排列</p></div>' +
      '<div class="post-list">' + list.map(postItem).join('') + '</div>'
  }));
}

// 文章页
const DAY = 86400000;
posts.forEach((p, i) => {
  let prev = posts[i + 1], next = posts[i - 1], label = ['上一篇', '下一篇'];
  const ser = p.series ? seriesMap[p.series] : null, si = ser ? ser.indexOf(p) : -1;
  if (ser && ser.length > 1) { prev = ser[si - 1]; next = ser[si + 1]; label = ['系列上一篇', '系列下一篇']; }
  const pagerHtml = prev || next ? '<nav class="pager" aria-label="翻页">' +
    (prev ? '<a href="' + postUrl(prev) + '"><small>' + label[0] + '</small>' + esc(prev.title) + '</a>' : '<span></span>') +
    (next ? '<a class="next" href="' + postUrl(next) + '"><small>' + label[1] + '</small>' + esc(next.title) + '</a>' : '<span></span>') + '</nav>' : '';
  const created = Date.parse(p.created), updated = Date.parse(p.updated) || created;
  const edited = updated - created > DAY;
  const years = Math.floor((NOW - updated) / (365 * DAY));
  const stale = years >= 1 ? '<p class="stale-note">这篇文章' + (edited ? '最后更新于' : '写于') + (years >= 2 ? ' ' + years + ' 年前' : '一年多以前') + '，其中的内容可能已经过时。</p>' : '';
  const serBox = ser ? '<details class="series-box"' + (ser.length <= 6 ? ' open' : '') + '><summary><span>系列<a href="' + seriesUrl(p.series) + '">' + esc(p.series) + '</a></span>' +
    '<small>第 ' + (si + 1) + ' 篇，共 ' + ser.length + ' 篇</small></summary><ol>' +
    ser.map((x) => '<li' + (x === p ? ' class="on" aria-current="page"><span>' + esc(x.title) + '</span>' : '><a href="' + postUrl(x) + '">' + esc(x.title) + '</a>') + '</li>').join('') + '</ol></details>' : '';
  const body = '<article class="article"><a class="back" href="' + u('/blog/') + '">‹ 技术博客</a><h1 class="art-title">' + esc(p.title) + '</h1>' +
    '<div class="art-meta"><time datetime="' + esc(p.created) + '">' + fmtDate(p.created) + '</time>' + (edited ? '<span>更新于 ' + fmtDate(p.updated) + '</span>' : '') +
    '<span>' + fmtWords(wordCount(p.content)) + ' 字</span>' + p.tags.map((t) => '<a class="tg" href="' + tagUrl(t) + '">#' + esc(t) + '</a>').join('') + '</div>' +
    stale + serBox + '<div id="toc-slot"></div><div class="prose">' + md(p.content) + '</div>' + pagerHtml + '</article>';
  write('/posts/' + p.id + '/', layout({
    path: '/posts/' + p.id + '/', nav: 'blog', page: 'post', progress: true, type: 'article',
    title: p.title, desc: p.summary || autoSummary(p.content), image: firstImage(p.content), body
  }));
});

// 小说
paginate(novels, 12, '/novels/', (items, pg, total, p) => {
  const words = novels.reduce((a, n) => a + novelWords(n), 0);
  write(p, layout({
    path: p, nav: 'novels', page: 'novels', title: pg > 1 ? '小说（第 ' + pg + ' 页）' : '小说',
    body: '<div class="page-head"><h1>小说</h1><p>' + novels.length + ' 部作品' + (words ? '，共 ' + fmtWords(words) + ' 字' : '') + '</p></div>' +
      (items.length ? '<div class="novel-grid">' + items.map(novelCard).join('') + '</div>' : empty('这里还没有作品。')) + pager(pg, total, u('/novels/'))
  }));
});
for (const n of novels) {
  const volTitle = (vid) => (n.volumes.find((v) => v.id === vid) || {}).title || '';
  const first = n.chapters[0];
  paginate(n.chapters, 40, '/novels/' + n.id + '/', (items, pg, total, p) => {
    let last = null, toc = '';
    for (const c of items) {
      if (n.volumes.length && c.vol && c.vol !== last) {
        toc += '<li class="toc-vol"><span>' + esc(volTitle(c.vol)) + '</span><small>' + n.chapters.filter((x) => x.vol === c.vol).length + ' 章</small></li>';
      }
      last = c.vol;
      toc += '<li data-cid="' + esc(c.id) + '"><a href="' + chapterUrl(n, c) + '"><span>' + esc(c.title) + '</span><span class="toc-n">' + fmtWords(wordCount(c.content)) + ' 字</span></a></li>';
    }
    const body = '<a class="back" href="' + u('/novels/') + '">‹ 全部作品</a><div class="novel-hero">' + coverHtml(n) + '<div class="nh-info"><h1>' + esc(n.title) + '</h1>' +
      '<p class="nh-meta">' + (n.genre ? '<span>' + esc(n.genre) + '</span>' : '') + '<span class="' + (n.status === 'done' ? '' : 'st-on') + '">' + statusText(n) + '</span>' +
      (n.volumes.length ? '<span>' + n.volumes.length + ' 卷</span>' : '') + '<span>' + n.chapters.length + ' 章</span><span>' + fmtWords(novelWords(n)) + ' 字</span></p>' +
      '<p class="nh-prog" id="nh-prog" hidden></p><div class="nh-actions">' +
      (first ? '<a class="btn primary" id="read-btn" href="' + chapterUrl(n, first) + '">开始阅读</a>' : '') + '</div></div></div>' +
      (n.synopsis ? '<div class="synopsis">' + paras(n.synopsis) + '</div>' : '') +
      '<h2 class="toc-title">目录' + (n.chapters.length > 40 ? '<small>共 ' + n.chapters.length + ' 章</small>' : '') + '</h2>' +
      (items.length ? '<ul class="toc">' + toc + '</ul>' + pager(pg, total, novelUrl(n)) : empty('还没有章节。'));
    write(p, layout({
      path: p, nav: 'novels', page: 'novel', title: n.title, desc: (n.synopsis || '').split('\n')[0], body,
      attrs: ' data-novel="' + esc(n.id) + '"', data: { chapters: n.chapters.map((c) => [c.id, c.title, chapterUrl(n, c)]) }
    }));
  });
  n.chapters.forEach((c, i) => {
    const prev = n.chapters[i - 1], next = n.chapters[i + 1];
    const body = '<div class="reader"><div class="reader-top"><a href="' + novelUrl(n) + '">‹ ' + esc(n.title) + '</a>' +
      '<div class="fs-ctl" role="group" aria-label="字号"><button type="button" data-fs="-1" aria-label="缩小字号">A−</button><button type="button" data-fs="1" aria-label="放大字号">A+</button></div></div>' +
      (c.vol ? '<p class="ch-vol">' + esc(volTitle(c.vol)) + '</p>' : '') + '<h1 class="ch-title">' + esc(c.title) + '</h1>' +
      '<div class="ch-meta"><span>' + fmtWords(wordCount(c.content)) + ' 字</span><time>' + fmtDate(c.created) + '</time></div>' +
      '<div class="chapter-body" id="cbody">' + chapterHtml(c.content) + '</div><nav class="ch-nav" aria-label="章节">' +
      (prev ? '<a class="btn" href="' + chapterUrl(n, prev) + '">上一章</a>' : '<span></span>') + '<a class="btn ghost" href="' + novelUrl(n) + '">目录</a>' +
      (next ? '<a class="btn primary" href="' + chapterUrl(n, next) + '">下一章</a>' : '<span class="ch-end">已是最新一章</span>') + '</nav></div>';
    write('/novels/' + n.id + '/' + c.id + '/', layout({
      path: '/novels/' + n.id + '/' + c.id + '/', nav: 'novels', page: 'read', progress: true, type: 'article',
      title: c.title + ' - ' + n.title, desc: (c.content || '').replace(/\s+/g, ' ').slice(0, 90), body,
      attrs: ' data-novel="' + esc(n.id) + '" data-chapter="' + esc(c.id) + '"'
    }));
  });
}

// 归档与热力图
{
  const events = [];
  posts.forEach((p) => events.push({ type: 'post', t: p.created, title: p.title, href: postUrl(p), words: wordCount(p.content) }));
  novels.forEach((n) => n.chapters.forEach((c) => events.push({ type: 'chapter', t: c.created, title: c.title, novel: n.title, href: chapterUrl(n, c), words: wordCount(c.content) })));
  const body = '<div class="page-head"><h1>归档</h1><p>过去一年的写作记录，以及全部文章和章节。</p></div>' +
    '<div class="seg small hm-seg" id="hm-mode"><button type="button" data-m="all">全部</button><button type="button" data-m="post">博客</button><button type="button" data-m="chapter">小说</button></div>' +
    '<div class="hm-stats" id="hm-stats"></div><div class="hm-wrap"><div class="hm-scroll" id="hm-scroll"></div></div><div class="hm-legend" id="hm-legend"></div>' +
    '<div class="hm-detail" id="hm-detail" aria-live="polite"><p class="muted">点一个格子，查看那天写了什么。</p></div><div id="arc-list"></div>' +
    '<noscript><ul class="arc-items">' + events.sort((a, b) => (a.t < b.t ? 1 : -1)).map((e) => '<li><a href="' + e.href + '">' + (e.novel ? '《' + esc(e.novel) + '》' : '') + esc(e.title) + '</a></li>').join('') + '</ul></noscript>';
  write('/archive/', layout({ path: '/archive/', nav: 'archive', page: 'archive', title: '归档', body, data: { events } }));
}

// 搜索
{
  const plain = (t) => String(t || '').replace(/```[\s\S]*?```/g, ' ').replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[![A-Za-z\u4e00-\u9fff]+\]/g, ' ').replace(/[#>*_`~|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 20000);
  const index = posts.map((p) => ({ type: 'post', title: p.title, url: postUrl(p), date: p.created, tags: p.tags, text: plain(p.content) }))
    .concat(novels.flatMap((n) => [{ type: 'novel', title: n.title, url: novelUrl(n), date: n.created, tags: [n.genre].filter(Boolean), text: n.synopsis }]
      .concat(n.chapters.map((c) => ({ type: 'chapter', title: c.title, novel: n.title, url: chapterUrl(n, c), date: c.created, tags: [], text: c.content.replace(/\s+/g, ' ').slice(0, 20000) })))));
  fs.writeFileSync(path.join(OUT, 'search.json'), JSON.stringify(index));
  write('/search/', layout({
    path: '/search/', nav: '', page: 'search', title: '搜索',
    body: '<div class="page-head"><h1>搜索</h1><p>搜索全部文章、小说和章节。</p></div>' +
      '<form class="blog-search" action="' + u('/search/') + '" method="get" role="search"><input class="input search" type="search" name="q" id="q" placeholder="输入关键词" aria-label="搜索" autocomplete="off"></form>' +
      '<p class="result-note" id="s-note"></p><div class="post-list" id="s-list"></div>',
    attrs: ' data-index="' + u('/search.json') + '"'
  }));
}

// 404
write('/404.html', layout({
  path: '/404.html', title: '找不到页面', page: '404',
  body: '<div class="page-head"><h1>找不到这个页面</h1><p>这个地址没有内容，可能已经被删除或改了网址。</p></div><a class="btn" href="' + u('/') + '">回到首页</a>'
}), false);

// RSS
{
  const items = posts.map((p) => ({ title: p.title, url: abs(postUrl(p).slice(BASE.length)), date: p.created, desc: p.summary || autoSummary(p.content), html: md(p.content) }))
    .concat(novels.flatMap((n) => n.chapters.map((c) => ({ title: n.title + '：' + c.title, url: abs(chapterUrl(n, c).slice(BASE.length)), date: c.created, desc: (c.content || '').slice(0, 120), html: chapterHtml(c.content) }))))
    .sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 30);
  const cdata = (s) => '<![CDATA[' + String(s).replace(/]]>/g, ']]]]><![CDATA[>') + ']]>';
  const rss = '<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel>' +
    '<title>' + esc(site.name) + '</title><link>' + esc(abs('/')) + '</link><description>' + esc(site.tagline || site.name) + '</description><language>zh-CN</language>' +
    items.map((i) => '<item><title>' + esc(i.title) + '</title><link>' + esc(i.url) + '</link><guid>' + esc(i.url) + '</guid><pubDate>' + new Date(i.date).toUTCString() + '</pubDate>' +
      '<description>' + esc(i.desc) + '</description><content:encoded>' + cdata(i.html) + '</content:encoded></item>').join('') + '</channel></rss>\n';
  fs.writeFileSync(path.join(OUT, 'feed.xml'), rss);
}

// 站点地图
fs.writeFileSync(path.join(OUT, 'sitemap.xml'), '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
  written.filter((p) => !p.startsWith('/search')).map((p) => '<url><loc>' + esc(abs(encodeURI(p))) + '</loc></url>').join('') + '</urlset>\n');
fs.writeFileSync(path.join(OUT, 'robots.txt'), 'User-agent: *\nDisallow: /admin/\nSitemap: ' + abs('/sitemap.xml') + '\n');

/* ---------- 手机后台 ---------- */
require('./build-admin.js')({
  OUT, ROOT, css, contentFiles, siteUrl: SITE_URL, base: BASE,
  repo: process.env.GITHUB_REPOSITORY || site.repo || '', branch: process.env.GITHUB_REF_NAME || site.branch || 'main',
  commit: process.env.GITHUB_SHA || ''
});

console.log('网站已生成到 dist/：' + posts.length + ' 篇文章，' + novels.length + ' 部小说，' + novels.reduce((a, n) => a + n.chapters.length, 0) + ' 个章节，' + written.length + ' 个页面。');
