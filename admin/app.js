/* 墨与码手机后台：在浏览器里编辑内容，通过 GitHub 接口提交到仓库，GitHub Actions 随后自动生成并发布网站。 */
(function () {
'use strict';

var STYLE_META = {
  paper:    { name: '书卷纸墨', desc: '纸页与钢笔墨水，适合长篇阅读', sample: '一页纸，一支笔',
              fonts: 'family=Noto+Serif+SC:wght@400;700;900&family=Noto+Sans+SC:wght@700&family=JetBrains+Mono:wght@400' },
  minimal:  { name: '极简留白', desc: '大字号、留白与克莱因蓝', sample: '少一点，再少一点',
              fonts: 'family=Inter:wght@400;600;800&family=Noto+Sans+SC:wght@400;700;800&family=Noto+Serif+SC:wght@700;900&family=JetBrains+Mono:wght@400' },
  terminal: { name: '暗夜终端', desc: '等宽字与琥珀色光标', sample: '$ echo "hello"',
              fonts: 'family=JetBrains+Mono:wght@400;700&family=Noto+Sans+SC:wght@400;700&family=Noto+Serif+SC:wght@700;900' }
};
var STYLE_KEYS = ['paper', 'minimal', 'terminal'];

/* 构建时注入的配置：repo 仓库、branch 分支、siteUrl 网站地址、base 网站路径前缀 */
var CFG = window.SITE_CONFIG || {};
var LIB_PATHS = {
  marked: 'marked/4.3.0/marked.min.js',
  purify: 'dompurify/3.0.6/purify.min.js',
  hljs: 'highlight.js/11.9.0/highlight.min.js',
  jszip: 'jszip/3.10.1/jszip.min.js'
};
var LIB = {};
Object.keys(LIB_PATHS).forEach(function (k) {
  LIB[k] = CFG.libBase
    ? CFG.libBase.replace(/\/$/, '') + '/' + LIB_PATHS[k].split('/').pop()
    : 'https://cdnjs.cloudflare.com/ajax/libs/' + LIB_PATHS[k];
});
var FONT_BASE = typeof CFG.fontBase === 'string' ? CFG.fontBase : 'https://fonts.googleapis.com/css2';
function fontHref(style) {
  if (!FONT_BASE) return '';
  var m = STYLE_META[style] || STYLE_META.paper;
  return FONT_BASE + (FONT_BASE.indexOf('?') >= 0 ? '&' : '?') + m.fonts + '&display=swap';
}
function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

/* ===================================================================== */

var doc = document, root = doc.documentElement;
var app = doc.getElementById('app');
var NS = 'site:';
var COVERS = { ink: '墨', zhu: '朱', dai: '黛', zhuye: '竹', zhe: '赭', yue: '月' };
var TEMPLATES = { thread: '线装', night: '夜城', sun: '留白', star: '星海', note: '手札', deco: '民国' };
var AUTH = 'pending';            // pending | yes | no
var GH = null;                   // { repo, branch, token }，保存在这台设备上
var FILES = {};                  // 仓库里的内容文件（路径 → 文本）
var BASE_SHA = '';               // FILES 对应的提交
var LOCAL_IMAGES = {};           // 刚提交、网站还没生成好的图片，先用本地数据预览
var LOADED = false;
var PENDING_IMAGES = {};
var cleanups = [];
var busyNow = false;

function store(kind) {
  var s = null;
  try { s = window[kind]; s.setItem('__t', '1'); s.removeItem('__t'); } catch (e) { s = null; }
  return {
    get: function (k) { try { return s ? s.getItem(k) : null; } catch (e) { return null; } },
    set: function (k, v) { try { if (s) { s.setItem(k, v); return true; } } catch (e) {} return false; },
    del: function (k) { try { if (s) s.removeItem(k); } catch (e) {} }
  };
}
var LS = store('localStorage'), SS = store('sessionStorage');

/* ---------- 工具 ---------- */
var $ = function (s, r) { return (r || doc).querySelector(s); };
var $$ = function (s, r) { return Array.prototype.slice.call((r || doc).querySelectorAll(s)); };
var enc = encodeURIComponent;
function nowISO() { return new Date().toISOString(); }
function newPostId() {
  var d = new Date();
  return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + Math.random().toString(36).slice(2, 6);
}
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function clone(o) { return typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o)); }
function pad(n) { return n < 10 ? '0' + n : '' + n; }
function curStyle() { return root.getAttribute('data-style') || 'paper'; }
function fmtDate(iso) {
  var d = new Date(iso);
  if (isNaN(d)) return '';
  if (curStyle() === 'terminal') return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
}
function fmtTime(t) {
  var d = new Date(t), today = new Date();
  var hm = pad(d.getHours()) + ':' + pad(d.getMinutes());
  return d.toDateString() === today.toDateString() ? '今天 ' + hm : (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + hm;
}
function wordCount(t) {
  t = t || '';
  return (t.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length + (t.match(/[A-Za-z0-9_]+/g) || []).length;
}
function fmtWords(n) { return n >= 10000 ? (n / 10000).toFixed(1).replace(/\.0$/, '') + ' 万' : String(n); }
function readMins(t) { return Math.max(1, Math.round(wordCount(t) / 400)); }
function cnNum(n) {
  var d = '零一二三四五六七八九';
  if (n < 10) return d[n];
  if (n < 20) return '十' + (n % 10 ? d[n % 10] : '');
  if (n < 100) return d[Math.floor(n / 10)] + '十' + (n % 10 ? d[n % 10] : '');
  return String(n);
}
function sealText() {
  var s = (DATA.site.seal || '').trim();
  if (s) return s;
  return Array.from(DATA.site.name || '印').slice(0, 2).join('');
}
function paras(t) {
  return (t || '').split(/\n+/).map(function (l) { return l.trim(); }).filter(Boolean)
    .map(function (l) { return '<p>' + escHtml(l) + '</p>'; }).join('');
}
function safeUrl(u) {
  u = (u || '').trim();
  if (/^(https?:|mailto:)/i.test(u)) return u;
  if (/^[\w.-]+\.[a-z]{2,}/i.test(u)) return 'https://' + u;
  return '#';
}
function parseTags(s) {
  var seen = {};
  return (s || '').split(/[,，、;；\s]+/).map(function (t) { return t.replace(/^#/, '').trim(); })
    .filter(function (t) { if (!t || seen[t]) return false; seen[t] = 1; return true; }).slice(0, 8);
}
function debounce(fn, ms) {
  var h = null;
  var f = function () { clearTimeout(h); h = setTimeout(function () { h = null; fn(); }, ms); };
  f.flush = function () { if (h) { clearTimeout(h); h = null; fn(); } };
  return f;
}
function autoSummary(md) {
  var t = (md || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*(#{1,6}|>|[-*+]|\d+\.)\s*/gm, '')
    .replace(/\[![A-Za-z\u4e00-\u9fff]+\]/g, '')
    .replace(/[`*_~|]/g, '')
    .replace(/\s+/g, ' ').trim();
  return t.length > 90 ? t.slice(0, 90) + '…' : t;
}

/* ---------- 数据 ---------- */
function readData() {
  try { return JSON.parse(doc.getElementById('site-data').textContent || '{}'); } catch (e) { return {}; }
}
function normalize(d) {
  d = d && typeof d === 'object' ? d : {};
  var s = d.site || {};
  d.site = Object.assign({}, s, {
    name: s.name || CFG.siteName || '我的网站', seal: s.seal || '', tagline: s.tagline || '', bio: s.bio || '',
    links: Array.isArray(s.links) ? s.links.filter(function (l) { return l && l.url; }) : [],
    style: STYLE_META[s.style] ? s.style : (STYLE_META[CFG.style] ? CFG.style : 'paper')
  });
  d.posts = (Array.isArray(d.posts) ? d.posts : []).filter(function (p) { return p && p.id; });
  d.posts.forEach(function (p) {
    p.title = p.title || '无题'; p.content = p.content || ''; p.summary = p.summary || '';
    p.tags = Array.isArray(p.tags) ? p.tags : []; p.created = p.created || nowISO();
    p.updated = p.updated || p.created; p.pinned = !!p.pinned;
    p.series = typeof p.series === 'string' ? p.series.trim() : '';
  });
  d.novels = (Array.isArray(d.novels) ? d.novels : []).filter(function (n) { return n && n.id; });
  d.novels.forEach(function (n) {
    n.title = n.title || '无题'; n.genre = n.genre || ''; n.synopsis = n.synopsis || '';
    n.status = n.status === 'done' ? 'done' : 'serial'; n.cover = COVERS[n.cover] ? n.cover : 'dai';
    n.tpl = TEMPLATES[n.tpl] ? n.tpl : 'thread'; n.author = typeof n.author === 'string' ? n.author : '';
    n.chapters = (Array.isArray(n.chapters) ? n.chapters : []).filter(function (c) { return c && c.id; });
    n.chapters.forEach(function (c) { c.title = c.title || '无题'; c.content = c.content || ''; c.created = c.created || nowISO(); });
    /* 分卷：未分卷的章节排在最前，其余按卷的顺序分组，卷内保持原有顺序 */
    n.volumes = (Array.isArray(n.volumes) ? n.volumes : []).filter(function (v) { return v && v.id; })
      .map(function (v) { return { id: String(v.id), title: String(v.title || '').trim() || '未命名分卷' }; });
    var vi = {};
    n.volumes.forEach(function (v, i) { vi[v.id] = i; });
    n.chapters.forEach(function (c) { if (!Object.prototype.hasOwnProperty.call(vi, c.vol)) c.vol = ''; });
    n.chapters = n.chapters.map(function (c, i) { return { c: c, i: i, k: c.vol ? vi[c.vol] : -1 }; })
      .sort(function (a, b) { return a.k - b.k || a.i - b.i; }).map(function (x) { return x.c; });
  });
  d.images = d.images && typeof d.images === 'object' ? d.images : {};
  return d;
}
var DATA = normalize({});

function sortedPosts() {
  return DATA.posts.slice().sort(function (a, b) { return a.created < b.created ? 1 : a.created > b.created ? -1 : 0; });
}
/* 列表展示用：置顶文章在前 */
function listedPosts() {
  var s = sortedPosts();
  return s.filter(function (p) { return p.pinned; }).concat(s.filter(function (p) { return !p.pinned; }));
}
function seriesPosts(name) {
  return DATA.posts.filter(function (p) { return p.series === name; })
    .sort(function (a, b) { return a.created < b.created ? -1 : a.created > b.created ? 1 : 0; });
}
function volTitle(n, vid) {
  var v = n.volumes.find(function (x) { return x.id === vid; });
  return v ? v.title : '';
}
function findNovel(id) { return DATA.novels.find(function (n) { return n.id === id; }); }
function statusText(n) { return n.status === 'done' ? '已完结' : '连载中'; }

/* ---------- 按需加载外部库（不阻塞页面显示） ---------- */
var libCache = {};
function loadScript(url, globalName, timeout) {
  if (window[globalName]) return Promise.resolve(window[globalName]);
  if (libCache[url]) return libCache[url];
  var p = new Promise(function (res, rej) {
    var s = doc.createElement('script');
    var timer = setTimeout(function () { rej(new Error('timeout')); }, timeout || 12000);
    s.src = url;
    s.async = true;
    s.onload = function () { clearTimeout(timer); if (window[globalName]) res(window[globalName]); else rej(new Error('missing')); };
    s.onerror = function () { clearTimeout(timer); rej(new Error('load')); };
    doc.head.appendChild(s);
  });
  libCache[url] = p;
  p.catch(function () { if (libCache[url] === p) delete libCache[url]; });
  return p;
}
var mdLoad = null;
function ensureMarkdown() {
  if (mdReady) return Promise.resolve(true);
  if (!mdLoad) {
    mdLoad = Promise.all([
      loadScript(LIB.marked, 'marked'),
      loadScript(LIB.purify, 'DOMPurify').catch(function () { return null; })
    ]).then(function () { return setupMarked(); }, function () { mdLoad = null; return false; });
  }
  return mdLoad;
}
function highlightLater(codes) {
  if (!codes.length) return;
  loadScript(LIB.hljs, 'hljs').then(function (h) {
    try { h.configure({ ignoreUnescapedHTML: true }); } catch (e) {}
    codes.forEach(function (c) {
      if (c.isConnected && !c.classList.contains('hljs')) { try { h.highlightElement(c); } catch (e) {} }
    });
  }, function () {});
}

/* ---------- Markdown 渲染 ---------- */
var mdReady = false;
function resolveImg(href) {
  href = href || '';
  if (/^\/images\//.test(href)) return LOCAL_IMAGES[href] || (CFG.base || '') + href;
  if (href.indexOf('img:') === 0) {
    var id = href.slice(4);
    return PENDING_IMAGES[id] || DATA.images[id] || '';
  }
  return href;
}
function setupMarked() {
  if (mdReady) return true;
  if (!window.marked || !window.marked.Renderer) return false;
  var r = new window.marked.Renderer();
  r.image = function (href, title, text) {
    return '<img src="' + escHtml(resolveImg(href)) + '" alt="' + (text || '') + '" loading="lazy" decoding="async"' +
      (title ? ' title="' + escHtml(title) + '"' : '') + '>';
  };
  r.link = function (href, title, text) {
    href = href || '';
    if (/^\s*(javascript|vbscript|data):/i.test(href)) href = '#';
    var ext = /^https?:/i.test(href);
    return '<a href="' + escHtml(href) + '"' + (title ? ' title="' + escHtml(title) + '"' : '') +
      (ext ? ' target="_blank" rel="noopener"' : '') + '>' + text + '</a>';
  };
  r.code = function (code, info, escaped) {
    info = (info || '').trim();
    var first = (info.split(/\s+/)[0] || '');
    var lang = first.replace(/[^\w+#.-]/g, '');
    var rest = info.slice(first.length).trim();
    var m = /^title\s*=\s*["']?(.+?)["']?$/.exec(rest);
    var title = m ? m[1] : rest;
    return '<pre' + (title ? ' data-title="' + escHtml(title) + '"' : '') + '><code' +
      (lang ? ' class="language-' + escHtml(lang) + '"' : '') + '>' + (escaped ? code : escHtml(code)) + '</code></pre>\n';
  };
  window.marked.setOptions({ renderer: r, gfm: true, breaks: true, headerIds: false, mangle: false });
  mdReady = true;
  return true;
}
function fallbackMd(md) {
  var out = [], parts = (md || '').split(/(```[\s\S]*?```)/);
  parts.forEach(function (part) {
    if (/^```/.test(part)) {
      out.push('<pre><code>' + escHtml(part.replace(/^```[^\n]*\n?/, '').replace(/```$/, '')) + '</code></pre>');
      return;
    }
    part.split(/\n{2,}/).forEach(function (b) {
      b = b.trim();
      if (!b || /^!\[/.test(b)) return;
      var h = /^(#{1,3})\s+(.*)$/.exec(b);
      if (h) out.push('<h' + (h[1].length + 1) + '>' + escHtml(h[2]) + '</h' + (h[1].length + 1) + '>');
      else out.push('<p>' + escHtml(b).replace(/\n/g, '<br>') + '</p>');
    });
  });
  return out.join('');
}
function renderMarkdown(md) {
  var html;
  if (setupMarked()) {
    try { html = window.marked.parse(md || ''); } catch (e) { html = fallbackMd(md); }
  } else {
    html = fallbackMd(md);
  }
  if (window.DOMPurify && window.DOMPurify.sanitize) {
    html = window.DOMPurify.sanitize(html, { ADD_ATTR: ['target', 'loading', 'decoding'] });
  }
  return html;
}
var CALLOUTS = {
  NOTE: ['说明', 'note'], TIP: ['提示', 'tip'], IMPORTANT: ['重要', 'important'], WARNING: ['注意', 'warning'], CAUTION: ['警告', 'caution'],
  '说明': ['说明', 'note'], '提示': ['提示', 'tip'], '重要': ['重要', 'important'], '注意': ['注意', 'warning'], '警告': ['警告', 'caution']
};
var CALLOUT_ICONS = {
  note: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.5v.01"/>',
  tip: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3Z"/>',
  important: '<path d="M4 4h16v12H8l-4 4V4Z"/><path d="M12 7v4M12 13.5v.01"/>',
  warning: '<path d="M12 3 2 20h20L12 3Z"/><path d="M12 10v4M12 17v.01"/>',
  caution: '<path d="M8 3h8l5 5v8l-5 5H8l-5-5V8l5-5Z"/><path d="M12 8v5M12 16v.01"/>'
};
function makeCallouts(el) {
  $$('blockquote', el).forEach(function (bq) {
    var p = bq.firstElementChild;
    if (!p || p.tagName !== 'P') return;
    var m = /^\s*\[!([A-Za-z]+|[\u4e00-\u9fff]{2})\]([^<]*?)\s*(<br\s*\/?>|$)/.exec(p.innerHTML);
    if (!m) return;
    var def = CALLOUTS[/^[a-z]+$/i.test(m[1]) ? m[1].toUpperCase() : m[1]];
    if (!def) return;
    var tmp = doc.createElement('div');
    tmp.innerHTML = m[2];
    var title = tmp.textContent.trim() || def[0];
    p.innerHTML = p.innerHTML.slice(m[0].length);
    if (!p.textContent.trim() && !p.querySelector('img')) p.remove();
    var box = doc.createElement('div');
    box.className = 'callout callout-' + def[1];
    box.setAttribute('role', 'note');
    box.innerHTML = '<p class="callout-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      CALLOUT_ICONS[def[1]] + '</svg>' + escHtml(title) + '</p>';
    while (bq.firstChild) box.appendChild(bq.firstChild);
    bq.parentNode.replaceChild(box, bq);
  });
}
var FOLD_LINES = 24;
function enhanceProse(el) {
  makeCallouts(el);
  $$('pre > code', el).forEach(function (code) {
    var pre = code.parentNode;
    if (pre.closest('.code-block')) return;
    var lang = ((code.className || '').match(/language-([\w+#.-]+)/) || [])[1] || '';
    var title = pre.getAttribute('data-title') || '';
    var lines = code.textContent.replace(/\n$/, '').split('\n');
    var box = doc.createElement('div');
    box.className = 'code-block';
    var bar = doc.createElement('div');
    bar.className = 'code-bar';
    bar.innerHTML = (title ? '<span class="code-file">' + escHtml(title) + '</span>' : '') +
      '<span class="code-lang">' + escHtml(lang || (title ? '' : 'code')) + '</span>' +
      '<button type="button" class="code-copy">复制</button>';
    var body = doc.createElement('div');
    body.className = 'code-body';
    if (lines.length >= 5) {
      var gut = doc.createElement('div');
      gut.className = 'code-gutter';
      gut.setAttribute('aria-hidden', 'true');
      gut.textContent = lines.map(function (l, i) { return i + 1; }).join('\n');
      body.appendChild(gut);
    }
    if (lang === 'diff') {
      code.innerHTML = lines.map(function (l) {
        var c = l.charAt(0) === '+' ? ' add' : l.charAt(0) === '-' ? ' del' : l.charAt(0) === '@' ? ' hunk' : '';
        return '<span class="dl' + c + '">' + (escHtml(l) || ' ') + '</span>';
      }).join('');
      code.classList.add('hljs', 'is-diff');
    }
    pre.parentNode.insertBefore(box, pre);
    box.appendChild(bar);
    body.appendChild(pre);
    box.appendChild(body);
    if (lines.length > FOLD_LINES) {
      box.classList.add('folded');
      var more = doc.createElement('button');
      more.type = 'button';
      more.className = 'code-more';
      more.textContent = '展开全部 ' + lines.length + ' 行';
      more.addEventListener('click', function () {
        var folded = box.classList.toggle('folded');
        more.textContent = folded ? '展开全部 ' + lines.length + ' 行' : '收起';
        if (folded) {
          var top = box.getBoundingClientRect().top;
          if (top < 0) window.scrollBy(0, top - navHeight() - 12);
        }
      });
      box.appendChild(more);
    }
  });
  highlightLater($$('pre > code', el));
  $$('table', el).forEach(function (t) {
    if (t.parentNode.classList.contains('table-wrap')) return;
    var w = doc.createElement('div');
    w.className = 'table-wrap';
    t.parentNode.insertBefore(w, t);
    w.appendChild(t);
  });
}
function renderChapterText(t) {
  return (t || '').split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean).map(function (l) {
    if (/^([*＊]\s*){3,}$|^(-\s*){3,}$|^—{2,}$/.test(l)) return '<div class="scene-break" aria-hidden="true"></div>';
    return '<p>' + escHtml(l) + '</p>';
  }).join('');
}

/* ---------- 外观 ---------- */
function applyStyle(k) {
  if (!STYLE_META[k]) k = 'paper';
  if (root.getAttribute('data-style') !== k) root.setAttribute('data-style', k);
  var link = doc.getElementById('font-link');
  var href = fontHref(k);
  if (!href) { if (link) link.remove(); return; }
  if (!link) {
    link = doc.createElement('link');
    link.id = 'font-link';
    link.rel = 'stylesheet';
    doc.head.appendChild(link);
  }
  if (link.getAttribute('href') !== href) link.setAttribute('href', href);
}
function loadAllFonts() {
  STYLE_KEYS.forEach(function (k) {
    var id = 'font-all-' + k;
    if (doc.getElementById(id)) return;
    var l = doc.createElement('link');
    if (!fontHref(k)) return;
    l.id = id; l.rel = 'stylesheet'; l.href = fontHref(k);
    doc.head.appendChild(l);
  });
}

/* ---------- 提示、弹窗、发布中 ---------- */
function toast(msg) {
  var t = doc.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._h);
  t._h = setTimeout(function () { t.classList.remove('show'); }, Math.max(2400, msg.length * 110));
}
function busy(on, msg) {
  var b = doc.getElementById('busy');
  if (msg) $('.busy-text', b).textContent = msg;
  b.classList.toggle('show', !!on);
}
function confirmBox(msg, okText, danger) {
  return new Promise(function (res) {
    var m = doc.createElement('div');
    m.className = 'modal';
    m.innerHTML = '<div class="modal-card" role="dialog" aria-modal="true"><p>' + escHtml(msg) + '</p>' +
      '<div class="modal-actions"><button type="button" class="btn ghost" data-v="0">取消</button>' +
      '<button type="button" class="btn ' + (danger ? 'danger solid' : 'primary') + '" data-v="1">' + escHtml(okText) + '</button></div></div>';
    doc.body.appendChild(m);
    var done = function (v) { m.remove(); doc.removeEventListener('keydown', onKey); res(v); };
    var onKey = function (e) { if (e.key === 'Escape') done(false); };
    doc.addEventListener('keydown', onKey);
    m.addEventListener('click', function (e) {
      var b = e.target.closest('[data-v]');
      if (b) done(b.getAttribute('data-v') === '1');
      else if (e.target === m) done(false);
    });
    $('[data-v="1"]', m).focus();
  });
}
function choiceBox(msg, choices) {
  return new Promise(function (res) {
    var m = doc.createElement('div');
    m.className = 'modal';
    m.innerHTML = '<div class="modal-card" role="dialog" aria-modal="true"><p>' + escHtml(msg).replace(/\n/g, '<br>') + '</p>' +
      '<div class="modal-actions stack">' + choices.map(function (c, i) {
        return '<button type="button" class="btn ' + (c.cls || '') + '" data-c="' + i + '"' + (c.disabled ? ' disabled' : '') + '>' + escHtml(c.text) + '</button>';
      }).join('') + '<button type="button" class="btn ghost" data-c="-1">取消</button></div></div>';
    doc.body.appendChild(m);
    var done = function (v) { m.remove(); doc.removeEventListener('keydown', onKey); res(v); };
    var onKey = function (e) { if (e.key === 'Escape') done(null); };
    doc.addEventListener('keydown', onKey);
    m.addEventListener('click', function (e) {
      var b = e.target.closest('[data-c]');
      if (b) { var i = +b.getAttribute('data-c'); done(i < 0 ? null : choices[i].v); }
      else if (e.target === m) done(null);
    });
    $('[data-c="-1"]', m).focus();
  });
}
function copyText(t) {
  var legacy = function () {
    var ta = doc.createElement('textarea');
    ta.value = t; ta.setAttribute('readonly', '');
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    doc.body.appendChild(ta); ta.select();
    var ok = false;
    try { ok = doc.execCommand('copy'); } catch (e) {}
    ta.remove();
    return ok;
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(t).then(function () { return true; }, legacy);
  }
  return Promise.resolve(legacy());
}

/* ---------- 发布：把新数据写回页面本身 ---------- */
function gcImages(d) {
  var used = {};
  d.posts.forEach(function (p) {
    (p.content.match(/img:([a-z0-9]+)/gi) || []).forEach(function (m) { used[m.slice(4)] = 1; });
  });
  Object.keys(d.images).forEach(function (k) { if (!used[k]) delete d.images[k]; });
}
/* ---------- GitHub 接口 ---------- */
function gh(method, path, body) {
  var headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  if (GH && GH.token) headers.Authorization = 'Bearer ' + GH.token;
  if (body) headers['Content-Type'] = 'application/json';
  return fetch('https://api.github.com' + path, { method: method, headers: headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' })
    .then(function (res) {
      return res.text().then(function (t) {
        var j = null;
        try { j = t ? JSON.parse(t) : null; } catch (e) { j = null; }
        if (!res.ok) { var err = new Error((j && j.message) || ('HTTP ' + res.status)); err.status = res.status; throw err; }
        return j;
      });
    });
}
function repoPath(p) { return '/repos/' + GH.repo + p; }
function rawFile(sha, path) {
  return fetch('https://raw.githubusercontent.com/' + GH.repo + '/' + sha + '/' + path.split('/').map(encodeURIComponent).join('/'), { cache: 'no-store' })
    .then(function (r) { if (!r.ok) throw new Error('raw ' + r.status); return r.text(); });
}
function headSha() {
  return gh('GET', repoPath('/git/ref/heads/' + encodeURIComponent(GH.branch))).then(function (r) { return r.object.sha; });
}
/* 把一组变更文件从仓库读进 FILES */
function pullChanges(sha, list) {
  return Promise.all(list.map(function (f) {
    if (f.previous_filename && SiteFiles.isContentPath(f.previous_filename)) delete FILES[f.previous_filename];
    if (!SiteFiles.isContentPath(f.filename)) return null;
    if (f.status === 'removed') { delete FILES[f.filename]; return null; }
    return rawFile(sha, f.filename).then(function (t) { FILES[f.filename] = t; });
  }));
}
function pullAll(sha) {
  return gh('GET', repoPath('/git/trees/' + sha + '?recursive=1')).then(function (tree) {
    FILES = {};
    return Promise.all(tree.tree.filter(function (e) { return e.type === 'blob' && SiteFiles.isContentPath(e.path); }).map(function (e) {
      return rawFile(sha, e.path).then(function (t) { FILES[e.path] = t; });
    }));
  });
}
/* 读取内容：先用网站上生成好的快照，再补上快照之后的新提交 */
function loadContent() {
  return Promise.all([
    fetch('content.json', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
    headSha()
  ]).then(function (r) {
    var snap = r[0], head = r[1];
    var job;
    if (snap && snap.commit && snap.files) {
      FILES = snap.files;
      job = snap.commit === head ? Promise.resolve()
        : gh('GET', repoPath('/compare/' + snap.commit + '...' + head)).then(function (c) { return pullChanges(head, c.files || []); }, function () { return pullAll(head); });
    } else job = pullAll(head);
    return job.then(function () {
      BASE_SHA = head;
      DATA = normalize(SiteFiles.modelFromFiles(FILES));
      LOADED = true;
    });
  });
}
/* 一次提交多个文件：changes 为文本文件，binaries 为 base64 图片，deletions 为要删除的路径 */
function ghCommit(changes, binaries, deletions, message) {
  return headSha().then(function (head) {
    var upstream = head === BASE_SHA ? Promise.resolve([])
      : gh('GET', repoPath('/compare/' + BASE_SHA + '...' + head)).then(function (c) { return c.files || []; });
    return upstream.then(function (ups) {
      var names = {};
      ups.forEach(function (f) { names[f.filename] = 1; if (f.previous_filename) names[f.previous_filename] = 1; });
      var touched = Object.keys(changes).concat(Object.keys(binaries), deletions);
      if (touched.some(function (p) { return names[p]; })) { var e = new Error('conflict'); e.code = 'conflict'; throw e; }
      return gh('GET', repoPath('/git/commits/' + head)).then(function (hc) {
        return Promise.all(Object.keys(binaries).map(function (p) {
          return gh('POST', repoPath('/git/blobs'), { content: binaries[p], encoding: 'base64' }).then(function (b) {
            return { path: p, mode: '100644', type: 'blob', sha: b.sha };
          });
        })).then(function (bin) {
          var tree = bin.concat(Object.keys(changes).map(function (p) { return { path: p, mode: '100644', type: 'blob', content: changes[p] }; }))
            .concat(deletions.map(function (p) { return { path: p, mode: '100644', type: 'blob', sha: null }; }));
          return gh('POST', repoPath('/git/trees'), { base_tree: hc.tree.sha, tree: tree });
        }).then(function (t) {
          return gh('POST', repoPath('/git/commits'), { message: message, tree: t.sha, parents: [head] });
        }).then(function (nc) {
          return gh('PATCH', repoPath('/git/refs/heads/' + encodeURIComponent(GH.branch)), { sha: nc.sha }).then(function () {
            return { sha: nc.sha, upstream: ups };
          });
        });
      });
    });
  });
}
function publishError(err) {
  var msg;
  if (err && err.code === 'conflict') {
    msg = '这些内容刚在别处被修改过，已载入最新版本。草稿仍保存在这台设备上，可以恢复后再提交。';
    loadContent().then(function () { render(); }, function () {});
  } else if (err && (err.status === 401 || err.status === 403)) {
    msg = '访问令牌无效、已过期或没有写入权限。请到「写作 → 连接」重新设置。草稿仍保存在这台设备上。';
  } else if (err && err.status === 422) {
    msg = '提交时仓库正好有新的改动，请再点一次。';
  } else if (err && err.status === 404) {
    msg = '找不到仓库或分支，请检查「写作 → 连接」里的设置。';
  } else {
    msg = '提交没有成功，检查网络后再试一次。草稿仍保存在这台设备上。';
  }
  toast(msg);
}
var EXT = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif' };
function commit(mutate, opts) {
  if (busyNow) return;
  if (AUTH !== 'yes') { toast('请先连接 GitHub。'); setHash('#/login'); render(); return; }
  var next = clone(DATA);
  mutate(next);
  /* 新插入的图片：存成 static/images/ 里的文件，正文里的 img:编号 换成图片地址 */
  var binaries = {}, localImgs = {};
  Object.keys(next.images || {}).forEach(function (id) {
    var m = /^data:(image\/[a-z]+);base64,(.+)$/.exec(next.images[id] || '');
    if (!m || !EXT[m[1]]) return;
    var url = '/images/' + id + '.' + EXT[m[1]], used = false;
    next.posts.forEach(function (p) {
      if (p.content.indexOf('img:' + id) >= 0) { p.content = p.content.split('](img:' + id + ')').join('](' + url + ')'); used = true; }
    });
    if (used) { binaries['static' + url] = m[2]; localImgs[url] = next.images[id]; }
  });
  next.images = {};
  var oldF = SiteFiles.filesFromModel(DATA), newF = SiteFiles.filesFromModel(next);
  var changes = {}, deletions = Object.keys(oldF).filter(function (k) { return !(k in newF); });
  Object.keys(newF).forEach(function (k) { if (oldF[k] !== newF[k]) changes[k] = newF[k]; });
  if (!Object.keys(changes).length && !deletions.length && !Object.keys(binaries).length) { toast('没有需要提交的改动。'); return; }
  busyNow = true;
  busy(true, '正在提交…');
  var tries = 0;
  var run = function () {
    return ghCommit(changes, binaries, deletions, opts.message || '更新网站内容').catch(function (err) {
      if (err.status === 422 && tries++ < 1) return run();
      throw err;
    });
  };
  run().then(function (r) {
    Object.keys(changes).forEach(function (k) { FILES[k] = changes[k]; });
    deletions.forEach(function (k) { delete FILES[k]; });
    Object.keys(localImgs).forEach(function (k) { LOCAL_IMAGES[k] = localImgs[k]; });
    return (r.upstream.length ? pullChanges(r.sha, r.upstream) : Promise.resolve()).then(function () {
      BASE_SHA = r.sha;
      DATA = normalize(SiteFiles.modelFromFiles(FILES));
      if (opts.clearDraft) dropDraft(opts.clearDraft);
      busy(false); busyNow = false;
      if (opts.returnTo) setHash(opts.returnTo);
      render();
      toast(opts.toast || '已提交');
      watchBuild(r.sha, opts.live);
    });
  }).catch(function (err) {
    busy(false); busyNow = false;
    publishError(err);
  });
}
/* 提交之后跟踪 GitHub Actions 的构建进度 */
function buildBar(html, done) {
  var el = doc.getElementById('build-bar');
  if (!el) { el = doc.createElement('div'); el.id = 'build-bar'; el.className = 'build-bar'; el.setAttribute('role', 'status'); doc.body.appendChild(el); }
  el.innerHTML = html + '<button type="button" class="bb-x" aria-label="关闭">✕</button>';
  el.classList.toggle('done', !!done);
  el.querySelector('.bb-x').onclick = function () { el.remove(); };
}
var buildWatch = 0;
function watchBuild(sha, live) {
  var my = ++buildWatch, start = Date.now();
  buildBar('<span class="spin" aria-hidden="true"></span><span>已提交，正在生成网站，大约需要 1–2 分钟…</span>');
  var poll = function () {
    if (my !== buildWatch) return;
    gh('GET', repoPath('/actions/runs?head_sha=' + sha + '&per_page=5')).then(function (j) {
      var run = (j.workflow_runs || [])[0];
      if (run && run.status === 'completed') {
        if (run.conclusion === 'success') {
          buildBar('<span>已上线。</span><a href="' + escHtml((CFG.siteUrl || '') + (live || '/')) + '" target="_blank" rel="noopener">查看网站</a>', true);
          setTimeout(function () { var el = doc.getElementById('build-bar'); if (el && my === buildWatch) el.remove(); }, 12000);
        } else {
          buildBar('<span>网站生成失败。</span><a href="' + escHtml(run.html_url) + '" target="_blank" rel="noopener">查看原因</a>', true);
        }
        return;
      }
      if (Date.now() - start > 10 * 60000) { buildBar('<span>生成时间比平时长，稍后到网站上看看。</span>', true); return; }
      setTimeout(poll, 6000);
    }, function (err) {
      if (err.status === 403 || err.status === 404) buildBar('<span>已提交，大约 1–2 分钟后上线。</span>', true);
      else setTimeout(poll, 8000);
    });
  };
  setTimeout(poll, 5000);
}

function setHash(h) {
  if (!h || location.hash === h) return;
  try { history.replaceState(null, '', h); } catch (e) { location.hash = h; }
}
/* ---------- 草稿（只存在本机） ---------- */
function loadDraft(key) {
  var raw = LS.get(NS + 'draft:' + key);
  if (!raw) return null;
  try { var d = JSON.parse(raw); return d && d.data ? d : null; } catch (e) { return null; }
}
function saveDraft(key, data) {
  if (LS.set(NS + 'draft:' + key, JSON.stringify({ t: Date.now(), data: data }))) return true;
  var lite = Object.assign({}, data, { images: {} });
  return LS.set(NS + 'draft:' + key, JSON.stringify({ t: Date.now(), data: lite }));
}
function dropDraft(key) { LS.del(NS + 'draft:' + key); }

/* ---------- 日间 / 夜间 ---------- */
var MODE_KEY = NS + 'mode';
function systemMode() {
  var t = root.getAttribute('data-theme');
  if (t === 'dark' || t === 'light') return t;
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
function effectiveMode() {
  var m = root.getAttribute('data-mode');
  return m === 'dark' || m === 'light' ? m : systemMode();
}
function applyMode(m) {
  if (m === 'dark' || m === 'light') root.setAttribute('data-mode', m);
  else root.removeAttribute('data-mode');
}
function modeBtnHtml() {
  var dark = effectiveMode() === 'dark';
  return '<button type="button" class="mode-btn" id="mode-btn" aria-label="' + (dark ? '切换到日间模式' : '切换到夜间模式') + '" title="' +
    (dark ? '日间模式' : '夜间模式') + '">' + (dark ? SUN : MOON) + '</button>';
}
function updateModeBtn() {
  var b = doc.getElementById('mode-btn');
  if (b) b.outerHTML = modeBtnHtml();
}
var modeAnimTimer = null;
function toggleMode() {
  var next = effectiveMode() === 'dark' ? 'light' : 'dark';
  root.classList.add('mode-anim');
  clearTimeout(modeAnimTimer);
  modeAnimTimer = setTimeout(function () { root.classList.remove('mode-anim'); }, 500);
  /* 和系统一致时就不再记住，之后继续跟随系统 */
  if (next === systemMode()) { applyMode(null); LS.del(MODE_KEY); }
  else { applyMode(next); LS.set(MODE_KEY, next); }
  updateModeBtn();
  var b = doc.getElementById('mode-btn');
  if (b) b.focus();
}
function watchSystemMode() {
  var sync = function () {
    if (root.getAttribute('data-mode') && root.getAttribute('data-mode') === systemMode()) { applyMode(null); LS.del(MODE_KEY); }
    updateModeBtn();
  };
  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    if (mq.addEventListener) mq.addEventListener('change', sync); else if (mq.addListener) mq.addListener(sync);
  }
  if (window.MutationObserver) new MutationObserver(sync).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
}

/* ---------- 外壳 ---------- */
var SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/></svg>';
var MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.5 14.2A8.5 8.5 0 1 1 9.8 3.5a6.6 6.6 0 0 0 10.7 10.7Z"/></svg>';
var PEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';

function navHtml(active, progress) {
  var links = [['blog', '博客', '#/blog'], ['novels', '小说', '#/novels'], ['archive', '归档', '#/archive']];
  if (AUTH === 'yes') links.push(['admin', '写作', '#/admin']);
  return '<header class="nav"><div class="nav-in">' +
    '<a class="brand" href="#/"><span class="brand-name">' + escHtml(DATA.site.name) + '</span></a>' +
    '<nav class="nav-links" aria-label="主导航">' + links.map(function (l) {
      return '<a href="' + l[2] + '" class="' + (l[0] === active ? 'on' : '') + (l[0] === 'admin' ? ' write' : '') + '"' +
        (l[0] === active ? ' aria-current="page"' : '') + '>' + l[1] + '</a>';
    }).join('') + '</nav>' + modeBtnHtml() + '</div>' +
    (progress ? '<div class="read-progress" id="read-progress" aria-hidden="true"></div>' : '') + '</header>';
}
function footHtml() {
  return '<footer class="foot"><span>© ' + new Date().getFullYear() + ' ' + escHtml(DATA.site.name) + '</span>' +
    '<span class="foot-r">' + (CFG.siteUrl ? '<a href="' + escHtml(CFG.siteUrl) + '/" target="_blank" rel="noopener">查看网站</a>' : '') +
    '<button type="button" data-top>回到顶部</button></span></footer>';
}
function fabHtml(f) {
  if (!f || AUTH !== 'yes') return '';
  return '<a class="fab" href="' + f.href + '">' + PEN + '<span>' + escHtml(f.label) + '</span></a>';
}
function emptyHtml(msg, act) {
  return '<div class="empty">' + escHtml(msg) +
    (act && AUTH === 'yes' ? '<br><a class="btn primary sm" href="' + act[0] + '">' + escHtml(act[1]) + '</a>' : '') + '</div>';
}
function secHead(title, link) {
  return '<div class="sec-head"><h2>' + escHtml(title) + '</h2>' +
    (link ? '<a href="' + link[0] + '">' + escHtml(link[1]) + '</a>' : '') + '</div>';
}
function notFound(msg, act) {
  return {
    html: '<div class="page-head"><h1>找不到这个页面</h1><p>' + escHtml(msg || '这个地址没有内容。') + '</p></div>' +
      '<a class="btn" href="' + (act ? act[0] : '#/') + '">' + escHtml(act ? act[1] : '回到首页') + '</a>',
    nav: '', title: '找不到页面'
  };
}

/* ---------- 组件 ---------- */
function heroHtml() {
  var s = DATA.site;
  var links = s.links.map(function (l) {
    return '<a href="' + escHtml(safeUrl(l.url)) + '" target="_blank" rel="noopener">' + escHtml(l.label || l.url) + '</a>';
  }).join('');
  return '<header class="hero">' +
    '<div class="hero-prompt x-terminal" aria-hidden="true"><span class="pr">guest@home</span>:<span class="pa">~</span>$ cat about.md</div>' +
    '<h1 class="hero-name"><span>' + escHtml(s.name) + '</span><i class="cursor x-terminal" aria-hidden="true"></i></h1>' +
    (s.tagline ? '<p class="hero-tag">' + escHtml(s.tagline) + '</p>' : '') +
    (s.bio ? '<div class="hero-bio">' + paras(s.bio) + '</div>' : '') +
    (links ? '<div class="hero-links">' + links + '</div>' : '') +
    '</header>';
}
function postItem(p) {
  var sum = p.summary || autoSummary(p.content);
  return '<a class="post-item" href="#/post/' + enc(p.id) + '"><h3>' + (p.draft ? '<span class="draft-badge">草稿</span>' : '') + (p.pinned ? '<span class="pin-badge">置顶</span>' : '') + escHtml(p.title) + '</h3>' +
    (sum ? '<p class="pi-sum">' + escHtml(sum) + '</p>' : '') +
    '<div class="pi-meta"><time datetime="' + escHtml(p.created) + '">' + fmtDate(p.created) + '</time>' +
    '<span>' + readMins(p.content) + ' 分钟读完</span>' +
    (p.series ? '<span class="sr">系列：' + escHtml(p.series) + '</span>' : '') +
    p.tags.map(function (t) { return '<span class="tg">#' + escHtml(t) + '</span>'; }).join('') + '</div></a>';
}
function coverHtml(n) {
  var tpl = TEMPLATES[n.tpl] ? n.tpl : 'thread', col = COVERS[n.cover] ? n.cover : 'dai';
  var author = (n.author || DATA.site.name || '').trim();
  return '<div class="cover ct-' + tpl + ' cv-' + col + '" aria-hidden="true"><span class="cv-art"></span><span class="cv-text">' +
    '<span class="cv-title">' + escHtml(n.title || '书名') + '</span>' +
    (author ? '<span class="cv-sign"><i>' + escHtml(author) + ' 著</i><em>' + escHtml(sealText()) + '</em></span>' : '') +
    '</span></div>';
}
function novelWords(n) { return n.chapters.reduce(function (a, c) { return a + wordCount(c.content); }, 0); }
function novelCard(n) {
  return '<a class="novel-card" href="#/novel/' + enc(n.id) + '">' + coverHtml(n) +
    '<div class="nc-body"><h3>' + escHtml(n.title) + '</h3><p class="nc-meta">' +
    (n.genre ? '<span>' + escHtml(n.genre) + '</span>' : '') +
    '<span class="' + (n.status === 'done' ? '' : 'st-on') + '">' + statusText(n) + '</span>' +
    '<span>' + n.chapters.length + ' 章</span></p></div></a>';
}

/* ---------- 分页 ---------- */
var PER_PAGE = { posts: 8, novels: 12, chapters: 40, admin: 15 };
function pageCount(n, size) { return Math.max(1, Math.ceil(n / size)); }
function clampPage(pg, total) { pg = parseInt(pg, 10) || 1; return Math.min(Math.max(1, pg), total); }
function pageNums(cur, total) {
  var want = [1, total, cur - 1, cur, cur + 1].filter(function (n) { return n >= 1 && n <= total; });
  want = want.filter(function (n, i) { return want.indexOf(n) === i; }).sort(function (a, b) { return a - b; });
  var out = [], prev = 0;
  want.forEach(function (n) { if (n - prev > 1) out.push(0); out.push(n); prev = n; });
  return out;
}
/* base 为路由前缀时生成链接；base 为 null 时生成按钮（搜索结果在页面内翻页） */
function pagerHtml(cur, total, base) {
  if (total <= 1) return '';
  var href = function (n) { return base + (n > 1 ? '/p/' + n : ''); };
  var item = function (n, label, cls, rel) {
    if (n < 1 || n > total) return '<span class="' + cls + ' off" aria-hidden="true">' + label + '</span>';
    if (n === cur && cls === 'pg-num') return '<span class="pg-num on" aria-current="page">' + n + '</span>';
    return base !== null
      ? '<a class="' + cls + '" href="' + href(n) + '"' + (rel ? ' rel="' + rel + '"' : '') + (cls === 'pg-num' ? '' : ' aria-label="' + label + '"') + '>' + label + '</a>'
      : '<button type="button" class="' + cls + '" data-pg="' + n + '">' + label + '</button>';
  };
  return '<nav class="pagination" aria-label="分页，第 ' + cur + ' 页，共 ' + total + ' 页">' +
    item(cur - 1, '上一页', 'pg-btn', 'prev') +
    '<span class="pg-nums">' + pageNums(cur, total).map(function (n) {
      return n ? item(n, String(n), 'pg-num') : '<span class="pg-gap" aria-hidden="true">…</span>';
    }).join('') + '</span>' +
    item(cur + 1, '下一页', 'pg-btn', 'next') + '</nav>';
}
function pageTitle(t, pg) { return pg > 1 ? t + '（第 ' + pg + ' 页）' : t; }

/* ---------- 公开页面 ---------- */
var FAB_POST = { href: '#/edit/post/new', label: '写博客' };

function viewHome() {
  var posts = listedPosts(), novels = DATA.novels;
  var html = heroHtml();
  html += '<section class="sec">' + secHead('技术博客', posts.length ? ['#/blog', posts.length > 4 ? '全部 ' + posts.length + ' 篇' : '文章列表'] : null);
  html += posts.length ? '<div class="post-list">' + posts.slice(0, 4).map(postItem).join('') + '</div>'
    : emptyHtml('这里还没有文章。', ['#/edit/post/new', '写第一篇']);
  html += '</section><section class="sec">' + secHead('小说', novels.length ? ['#/novels', '全部作品'] : null);
  html += novels.length ? '<div class="novel-grid">' + novels.map(novelCard).join('') + '</div>'
    : emptyHtml('这里还没有作品。', ['#/edit/novel/new', '新建小说']);
  html += '</section>';
  return { html: html, nav: 'home', fab: FAB_POST };
}

var TAG_LIMIT = 12, tagsExpanded = false;
function viewBlog(opt, page) {
  var tag = opt.tag || null, series = opt.series || null;
  var posts = listedPosts();
  var counts = {}, lastUsed = {};
  posts.forEach(function (p) {
    p.tags.forEach(function (t) {
      counts[t] = (counts[t] || 0) + 1;
      if (!lastUsed[t] || p.created > lastUsed[t]) lastUsed[t] = p.created;
    });
  });
  /* 篇数多的在前；篇数相同时，最近用过的在前，新标签不会被埋到最后 */
  var tags = Object.keys(counts).sort(function (a, b) {
    return counts[b] - counts[a] || (lastUsed[b] > lastUsed[a] ? 1 : lastUsed[b] < lastUsed[a] ? -1 : 0);
  });
  var chips = tags.length ? '<div class="chips" id="chips"></div>' : '';
  if (series) chips = '';
  var head = series
    ? '<a class="back" href="#/blog">‹ 技术博客</a><div class="page-head"><h1>' + escHtml(series) + '</h1><p>系列文章，共 ' + seriesPosts(series).length + ' 篇，按发布顺序排列</p></div>'
    : '<div class="page-head"><h1>技术博客</h1><p>' + posts.length + ' 篇文章</p></div>';
  var html = head +
    (posts.length > 3 ? '<input class="input search" type="search" id="q" placeholder="搜索标题、标签或正文" autocomplete="off" aria-label="搜索文章">' : '') +
    chips + '<p class="result-note" id="pnote" hidden></p><div class="post-list" id="plist"></div><div id="ppager"></div>';
  var base = series ? '#/blog/series/' + enc(series) : tag ? '#/blog/tag/' + enc(tag) : '#/blog';
  var inTag = series ? seriesPosts(series) : posts.filter(function (p) { return !tag || p.tags.indexOf(tag) >= 0; });
  var routePage = clampPage(page, pageCount(inTag.length, PER_PAGE.posts));
  return {
    html: html, nav: 'blog', title: pageTitle(series || (tag ? '#' + tag : '技术博客'), routePage), fab: FAB_POST,
    mount: function (main) {
      var list = $('#plist', main), q = $('#q', main), pager = $('#ppager', main), note = $('#pnote', main);
      var chipBox = $('#chips', main);
      var drawChips = function () {
        if (!chipBox) return;
        var shown = tagsExpanded || tags.length <= TAG_LIMIT ? tags : tags.slice(0, TAG_LIMIT);
        if (tag && shown.indexOf(tag) < 0) shown = shown.concat([tag]);
        chipBox.innerHTML = '<a class="chip' + (!tag ? ' on' : '') + '" href="#/blog">全部</a>' +
          shown.map(function (t) {
            return '<a class="chip' + (t === tag ? ' on' : '') + '" href="#/blog/tag/' + enc(t) + '">' + escHtml(t) + '<small>' + counts[t] + '</small></a>';
          }).join('') +
          (tags.length > TAG_LIMIT ? '<button type="button" class="chip more" data-more aria-expanded="' + tagsExpanded + '">' +
            (tagsExpanded ? '收起' : '全部 ' + tags.length + ' 个标签') + '</button>' : '');
      };
      drawChips();
      if (chipBox) chipBox.addEventListener('click', function (e) {
        if (!e.target.closest('[data-more]')) return;
        tagsExpanded = !tagsExpanded;
        drawChips();
      });
      var searchPage = 1;
      var draw = function () {
        var k = q ? q.value.trim().toLowerCase() : '';
        var items = k ? inTag.filter(function (p) {
          return (p.title + ' ' + p.tags.join(' ') + ' ' + p.content).toLowerCase().indexOf(k) >= 0;
        }) : inTag;
        var total = pageCount(items.length, PER_PAGE.posts);
        var pg = k ? clampPage(searchPage, total) : routePage;
        var start = (pg - 1) * PER_PAGE.posts;
        list.innerHTML = items.length ? items.slice(start, start + PER_PAGE.posts).map(postItem).join('')
          : posts.length ? '<div class="empty">没有匹配的文章，换个关键词试试。</div>'
          : emptyHtml('这里还没有文章。', ['#/edit/post/new', '写第一篇']);
        pager.innerHTML = pagerHtml(pg, total, k ? null : base);
        note.hidden = !k || !items.length;
        note.textContent = k ? '找到 ' + items.length + ' 篇' : '';
      };
      draw();
      if (q) q.addEventListener('input', function () { searchPage = 1; draw(); });
      pager.addEventListener('click', function (e) {
        var b = e.target.closest('[data-pg]');
        if (!b) return;
        searchPage = +b.getAttribute('data-pg');
        draw();
        window.scrollTo(0, Math.max(0, list.getBoundingClientRect().top + window.scrollY - navHeight() - 16));
      });
    }
  };
}

var DAY = 86400000;
function viewPost(id) {
  var posts = sortedPosts();
  var i = posts.findIndex(function (p) { return p.id === id; });
  if (i < 0) return notFound('这篇文章不存在，可能已被删除。', ['#/blog', '回到博客']);
  var p = posts[i], prevP = posts[i + 1], nextP = posts[i - 1], label = ['上一篇', '下一篇'];
  var ser = p.series ? seriesPosts(p.series) : null, si = ser ? ser.indexOf(p) : -1;
  if (ser && ser.length > 1) { prevP = ser[si - 1]; nextP = ser[si + 1]; label = ['系列上一篇', '系列下一篇']; }
  var pager = (prevP || nextP) ? '<nav class="pager" aria-label="翻页">' +
    (prevP ? '<a href="#/post/' + enc(prevP.id) + '"><small>' + label[0] + '</small>' + escHtml(prevP.title) + '</a>' : '<span></span>') +
    (nextP ? '<a class="next" href="#/post/' + enc(nextP.id) + '"><small>' + label[1] + '</small>' + escHtml(nextP.title) + '</a>' : '<span></span>') +
    '</nav>' : '';
  var created = Date.parse(p.created), updated = Date.parse(p.updated) || created;
  var edited = updated - created > DAY;
  var age = Date.now() - updated, years = Math.floor(age / (365 * DAY));
  var stale = years >= 1 ? '<p class="stale-note">这篇文章' + (edited ? '最后更新于' : '写于') +
    (years >= 2 ? ' ' + years + ' 年前' : '一年多以前') + '，其中的内容可能已经过时。</p>' : '';
  var serBox = ser ? '<details class="series-box"' + (ser.length <= 6 ? ' open' : '') + '><summary>' +
    '<span>系列<a href="#/blog/series/' + enc(p.series) + '">' + escHtml(p.series) + '</a></span><small>第 ' + (si + 1) + ' 篇，共 ' + ser.length + ' 篇</small></summary>' +
    '<ol>' + ser.map(function (x) {
      return '<li' + (x === p ? ' class="on" aria-current="page"' : '') + '>' + (x === p ? '<span>' + escHtml(x.title) + '</span>' : '<a href="#/post/' + enc(x.id) + '">' + escHtml(x.title) + '</a>') + '</li>';
    }).join('') + '</ol></details>' : '';
  var html = '<article class="article"><a class="back" href="#/blog">‹ 技术博客</a>' +
    '<h1 class="art-title">' + escHtml(p.title) + '</h1>' +
    '<div class="art-meta">' + (p.draft ? '<span class="draft-badge">草稿</span>' : '') + '<time datetime="' + escHtml(p.created) + '">' + fmtDate(p.created) + '</time>' +
    (edited ? '<span>更新于 ' + fmtDate(p.updated) + '</span>' : '') +
    '<span>' + fmtWords(wordCount(p.content)) + ' 字</span>' +
    p.tags.map(function (t) { return '<a class="tg" href="#/blog/tag/' + enc(t) + '">#' + escHtml(t) + '</a>'; }).join('') +
    (AUTH === 'yes' ? '<a class="edit-link" href="#/edit/post/' + enc(p.id) + '">编辑</a>' : '') + '</div>' +
    stale + serBox +
    '<div id="toc-slot"></div>' +
    '<div class="prose">' + renderMarkdown(p.content) + '</div>' + pager + '</article>';
  return {
    html: html, nav: 'blog', title: p.title, fab: FAB_POST, progress: true,
    mount: function (main) {
      setupReading($('.article', main), { toc: true });
      if (!mdReady) ensureMarkdown().then(function (ok) { if (ok && parseHash()[0] === 'post' && parseHash()[1] === id) render(true); });
    }
  };
}

function viewNovels(page) {
  var words = DATA.novels.reduce(function (a, n) { return a + novelWords(n); }, 0);
  var total = pageCount(DATA.novels.length, PER_PAGE.novels), pg = clampPage(page, total);
  var html = '<div class="page-head"><h1>小说</h1><p>' + DATA.novels.length + ' 部作品' +
    (words ? '，共 ' + fmtWords(words) + ' 字' : '') + '</p></div>' +
    (DATA.novels.length ? '<div class="novel-grid">' + DATA.novels.slice((pg - 1) * PER_PAGE.novels, pg * PER_PAGE.novels).map(novelCard).join('') + '</div>' +
      pagerHtml(pg, total, '#/novels')
      : emptyHtml('这里还没有作品。', ['#/edit/novel/new', '新建小说']));
  return { html: html, nav: 'novels', title: pageTitle('小说', pg), fab: { href: '#/edit/novel/new', label: '新建小说' } };
}

function viewNovel(id, page) {
  var n = findNovel(id);
  if (!n) return notFound('这部作品不存在，可能已被删除。', ['#/novels', '回到小说']);
  var prog = LS.get(NS + 'progress:' + n.id);
  var ctotal = pageCount(n.chapters.length, PER_PAGE.chapters), cpg = clampPage(page, ctotal);
  var cur = n.chapters.find(function (c) { return c.id === prog; });
  var first = n.chapters[0];
  var pos = readPos(n.id);
  var pct = cur && pos && pos.cid === cur.id && pos.f > 0.03 ? Math.round(pos.f * 100) : 0;
  var readBtn = cur ? '<a class="btn primary" href="#/read/' + enc(n.id) + '/' + enc(cur.id) + '/resume">继续阅读</a>'
    : first ? '<a class="btn primary" href="#/read/' + enc(n.id) + '/' + enc(first.id) + '">开始阅读</a>' : '';
  var html = '<a class="back" href="#/novels">‹ 全部作品</a>' +
    '<div class="novel-hero">' + coverHtml(n) + '<div class="nh-info"><h1>' + escHtml(n.title) + '</h1>' +
    '<p class="nh-meta">' + (n.genre ? '<span>' + escHtml(n.genre) + '</span>' : '') +
    '<span class="' + (n.status === 'done' ? '' : 'st-on') + '">' + statusText(n) + '</span>' +
    (n.volumes.length ? '<span>' + n.volumes.length + ' 卷</span>' : '') +
    '<span>' + n.chapters.length + ' 章</span><span>' + fmtWords(novelWords(n)) + ' 字</span></p>' +
    (cur ? '<p class="nh-prog">读到：' + escHtml(cur.title) + (pct ? '，' + pct + '%' : '') + '</p>' : '') +
    '<div class="nh-actions">' + readBtn +
    (AUTH === 'yes' ? '<a class="btn" href="#/edit/novel/' + enc(n.id) + '">管理作品</a>' : '') + '</div></div></div>' +
    (n.synopsis ? '<div class="synopsis">' + paras(n.synopsis) + '</div>' : '') +
    '<h2 class="toc-title">目录' + (n.chapters.length > PER_PAGE.chapters ? '<small>共 ' + n.chapters.length + ' 章</small>' : '') + '</h2>' +
    (n.chapters.length ? '<ul class="toc">' + (function () {
      var lastVol = null, out = '';
      n.chapters.slice((cpg - 1) * PER_PAGE.chapters, cpg * PER_PAGE.chapters).forEach(function (c) {
        if (n.volumes.length && c.vol && c.vol !== lastVol) {
          var cnt = n.chapters.filter(function (x) { return x.vol === c.vol; }).length;
          out += '<li class="toc-vol"><span>' + escHtml(volTitle(n, c.vol)) + '</span><small>' + cnt + ' 章</small></li>';
        }
        lastVol = c.vol;
        out += '<li' + (c.id === prog ? ' class="cur"' : '') + '><a href="#/read/' + enc(n.id) + '/' + enc(c.id) + '">' +
          '<span>' + (c.draft ? '<span class="draft-badge">草稿</span>' : '') + escHtml(c.title) + '</span><span class="toc-n">' + fmtWords(wordCount(c.content)) + ' 字</span></a></li>';
      });
      return out;
    })() + '</ul>' + pagerHtml(cpg, ctotal, '#/novel/' + enc(n.id)) : emptyHtml('还没有章节。', ['#/edit/chapter/' + enc(n.id) + '/new', '写第一章']));
  return { html: html, nav: 'novels', title: pageTitle(n.title, cpg), fab: { href: '#/edit/chapter/' + enc(n.id) + '/new', label: '写新章' } };
}

var FONT_SIZES = [15, 16, 17, 18, 19, 20, 22, 24];
function readPos(nid) {
  try { var o = JSON.parse(LS.get(NS + 'pos:' + nid) || 'null'); return o && o.cid ? o : null; } catch (e) { return null; }
}
function viewRead(nid, cid, resume) {
  var n = findNovel(nid);
  var i = n ? n.chapters.findIndex(function (c) { return c.id === cid; }) : -1;
  if (i < 0) return notFound('这一章不存在，可能已被删除。', n ? ['#/novel/' + enc(n.id), '回到目录'] : ['#/novels', '回到小说']);
  var c = n.chapters[i], prev = n.chapters[i - 1], next = n.chapters[i + 1];
  LS.set(NS + 'progress:' + n.id, c.id);
  var base = '#/read/' + enc(n.id) + '/';
  var html = '<div class="reader"><div class="reader-top"><a href="#/novel/' + enc(n.id) + '">‹ ' + escHtml(n.title) + '</a>' +
    '<div class="fs-ctl" role="group" aria-label="字号"><button type="button" data-fs="-1" aria-label="缩小字号">A−</button>' +
    '<button type="button" data-fs="1" aria-label="放大字号">A+</button></div></div>' +
    (c.vol ? '<p class="ch-vol">' + escHtml(volTitle(n, c.vol)) + '</p>' : '') +
    '<h1 class="ch-title">' + escHtml(c.title) + '</h1>' +
    '<div class="ch-meta">' + (c.draft ? '<span class="draft-badge">草稿</span>' : '') + '<span>' + fmtWords(wordCount(c.content)) + ' 字</span><time>' + fmtDate(c.created) + '</time>' +
    (AUTH === 'yes' ? '<a class="edit-link" href="#/edit/chapter/' + enc(n.id) + '/' + enc(c.id) + '">编辑</a>' : '') + '</div>' +
    '<div class="chapter-body" id="cbody">' + renderChapterText(c.content) + '</div>' +
    '<nav class="ch-nav" aria-label="章节">' +
    (prev ? '<a class="btn" href="' + base + enc(prev.id) + '">上一章</a>' : '<span></span>') +
    '<a class="btn ghost" href="#/novel/' + enc(n.id) + '">目录</a>' +
    (next ? '<a class="btn primary" href="' + base + enc(next.id) + '">下一章</a>' : '<span class="ch-end">已是最新一章</span>') +
    '</nav></div>';
  return {
    html: html, nav: 'novels', title: c.title + ' - ' + n.title, progress: true,
    mount: function (main) {
      var body = $('#cbody', main);
      var saved = readPos(n.id);
      setupReading($('.reader', main), {
        onProgress: function (f) { LS.set(NS + 'pos:' + n.id, JSON.stringify({ cid: c.id, f: Math.round(f * 1000) / 1000 })); }
      });
      if (resume && saved && saved.cid === c.id && saved.f > 0.03 && saved.f < 0.98) {
        setTimeout(function () {
          var el = $('.reader', main);
          if (!el || !el.isConnected) return;
          var top = navHeight(), r = el.getBoundingClientRect();
          var range = r.height - (window.innerHeight - top);
          if (range <= 0) return;
          window.scrollTo(0, Math.max(0, Math.round(r.top + window.scrollY - top + saved.f * range)));
          toast('已回到上次读到的位置');
        }, 80);
      }
      var idx = parseInt(LS.get(NS + 'fs') || '3', 10);
      if (!(idx >= 0 && idx < FONT_SIZES.length)) idx = 3;
      var apply = function () { body.style.setProperty('--read-size', FONT_SIZES[idx] + 'px'); };
      apply();
      $('.fs-ctl', main).addEventListener('click', function (e) {
        var b = e.target.closest('[data-fs]');
        if (!b) return;
        idx = Math.max(0, Math.min(FONT_SIZES.length - 1, idx + parseInt(b.getAttribute('data-fs'), 10)));
        LS.set(NS + 'fs', String(idx));
        apply();
      });
    }
  };
}

/* ---------- 阅读进度与目录 ---------- */
var LIST_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11"/><path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01" stroke-width="3"/></svg>';
function navHeight() {
  var n = $('.nav');
  return n ? n.getBoundingClientRect().bottom : 56;
}
function jumpTo(id) {
  var h = doc.getElementById(id);
  if (!h) return;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  h.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
}
function setupReading(article, opts) {
  if (!article) return;
  var bar = doc.getElementById('read-progress');
  var heads = opts.toc ? $$('.prose h2, .prose h3', article) : [];
  var items = [], lists = [], fab = null, inline = null, active = -1;

  if (heads.length >= 2) {
    items = heads.map(function (h, i) {
      h.id = 'sec-' + (i + 1);
      return { id: h.id, text: h.textContent.trim(), lv: h.tagName === 'H3' ? 3 : 2 };
    });
    var listHtml = function () {
      return '<ol class="toc-list">' + items.map(function (it, i) {
        return '<li class="lv' + it.lv + '" data-i="' + i + '"><button type="button" data-jump="' + it.id + '">' + escHtml(it.text) + '</button></li>';
      }).join('') + '</ol>';
    };
    var slot = $('#toc-slot', article);
    if (slot) {
      slot.innerHTML = '<details class="art-toc"' + (items.length <= 6 ? ' open' : '') + '><summary>目录<span>' + items.length + ' 节</span></summary>' + listHtml() + '</details>';
      inline = $('.art-toc', slot);
    }
    var side = doc.createElement('nav');
    side.className = 'side-toc';
    side.setAttribute('aria-label', '文章目录');
    side.innerHTML = '<p>目录</p>' + listHtml();
    app.appendChild(side);
    fab = doc.createElement('button');
    fab.type = 'button';
    fab.className = 'toc-fab';
    fab.setAttribute('aria-label', '打开目录');
    fab.innerHTML = LIST_ICON + '<span>目录</span>';
    app.appendChild(fab);
    lists = $$('.toc-list', app);

    var onJump = function (e) {
      var b = e.target.closest('[data-jump]');
      if (!b) return;
      e.preventDefault();
      jumpTo(b.getAttribute('data-jump'));
    };
    if (inline) inline.addEventListener('click', onJump);
    side.addEventListener('click', onJump);
    fab.addEventListener('click', function () { openTocSheet(listHtml(), active); });
  }

  var setActive = function (i) {
    if (i === active) return;
    active = i;
    lists = $$('.toc-list', doc);
    lists.forEach(function (l) {
      $$('li', l).forEach(function (li) { li.classList.toggle('on', +li.getAttribute('data-i') === i); });
    });
  };

  var raf = 0;
  var update = function () {
    raf = 0;
    if (!article.isConnected) return;
    var top = navHeight();
    var r = article.getBoundingClientRect();
    var vh = window.innerHeight;
    var range = r.height - (vh - top);
    var f = range > 0 ? Math.min(1, Math.max(0, (top - r.top) / range)) : 1;
    if (bar) {
      bar.hidden = r.height < vh * 1.2;
      bar.style.transform = 'scaleX(' + f + ')';
    }
    if (items.length) {
      var i = -1;
      for (var k = 0; k < heads.length; k++) {
        if (heads[k].getBoundingClientRect().top <= top + 24) i = k; else break;
      }
      setActive(i);
      var past = inline ? inline.getBoundingClientRect().bottom < top : r.top < top - 200;
      fab.classList.toggle('show', past && f < 0.995);
    }
    if (opts.onProgress) saveSoon(f);
  };
  var lastF = 0;
  var saveSoon = debounce(function () { opts.onProgress(lastF); }, 600);
  if (opts.onProgress) {
    var inner = saveSoon;
    saveSoon = function (f) { lastF = f; inner(); };
    saveSoon.flush = inner.flush;
    cleanups.push(inner.flush);
  }
  var onScroll = function () { if (!raf) raf = requestAnimationFrame(update); };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  cleanups.push(function () {
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onScroll);
    if (raf) cancelAnimationFrame(raf);
    var sh = doc.querySelector('.sheet-wrap');
    if (sh) sh.remove();
  });
  setTimeout(onScroll, 0);
}
function openTocSheet(listHtml, active) {
  var m = doc.createElement('div');
  m.className = 'sheet-wrap';
  m.innerHTML = '<div class="sheet" role="dialog" aria-modal="true" aria-label="目录">' +
    '<div class="sheet-head"><strong>目录</strong><button type="button" class="sheet-x" aria-label="关闭目录">✕</button></div>' +
    listHtml + '</div>';
  doc.body.appendChild(m);
  var cur = $('li[data-i="' + active + '"]', m);
  if (cur) { cur.classList.add('on'); cur.scrollIntoView({ block: 'center' }); }
  var close = function () { m.remove(); doc.removeEventListener('keydown', onKey); };
  var onKey = function (e) { if (e.key === 'Escape') close(); };
  doc.addEventListener('keydown', onKey);
  m.addEventListener('click', function (e) {
    var b = e.target.closest('[data-jump]');
    if (b) { close(); jumpTo(b.getAttribute('data-jump')); return; }
    if (e.target === m || e.target.closest('.sheet-x')) close();
  });
  $('.sheet-x', m).focus();
}

/* ---------- 图片查看器 ---------- */
function openLightbox(list, index) {
  var prevFocus = doc.activeElement;
  var lb = doc.createElement('div');
  lb.className = 'lightbox';
  lb.setAttribute('role', 'dialog');
  lb.setAttribute('aria-modal', 'true');
  lb.setAttribute('aria-label', '查看图片');
  lb.innerHTML = '<div class="lb-stage"><img class="lb-img" alt=""></div>' +
    '<div class="lb-top"><span class="lb-count"></span><button type="button" class="lb-close" aria-label="关闭">✕</button></div>' +
    (list.length > 1 ? '<button type="button" class="lb-nav lb-prev" aria-label="上一张">‹</button><button type="button" class="lb-nav lb-next" aria-label="下一张">›</button>' : '') +
    '<p class="lb-cap"></p>';
  doc.body.appendChild(lb);
  var oldOverflow = doc.body.style.overflow;
  doc.body.style.overflow = 'hidden';
  var img = $('.lb-img', lb), stage = $('.lb-stage', lb), cap = $('.lb-cap', lb), cnt = $('.lb-count', lb);
  var st = { s: 1, x: 0, y: 0 }, cur = 0;
  var apply = function (anim) {
    img.classList.toggle('anim', !!anim);
    img.style.transform = 'translate(' + st.x + 'px,' + st.y + 'px) scale(' + st.s + ')';
  };
  var fadeBg = function (f) { lb.style.backgroundColor = f >= 1 ? '' : 'rgba(0,0,0,' + (0.92 * f).toFixed(3) + ')'; };
  var show = function (n) {
    cur = (n + list.length) % list.length;
    img.src = list[cur].src;
    var alt = (list[cur].alt || '').trim();
    img.alt = alt;
    cap.textContent = alt && alt !== '图片说明' ? alt : '';
    cnt.textContent = list.length > 1 ? (cur + 1) + ' / ' + list.length : '';
    st = { s: 1, x: 0, y: 0 };
    apply(false);
  };
  var clampPan = function () {
    var mx = Math.max(0, (img.offsetWidth * st.s - window.innerWidth) / 2);
    var my = Math.max(0, (img.offsetHeight * st.s - window.innerHeight) / 2);
    st.x = Math.min(mx, Math.max(-mx, st.x));
    st.y = Math.min(my, Math.max(-my, st.y));
  };
  var zoomAt = function (s, px, py) {
    var cx = window.innerWidth / 2, cy = window.innerHeight / 2;
    var qx = (px - cx - st.x) / st.s, qy = (py - cy - st.y) / st.s;
    st.s = s;
    st.x = px - cx - s * qx;
    st.y = py - cy - s * qy;
    if (s <= 1) { st.s = 1; st.x = 0; st.y = 0; }
    clampPan();
  };
  var inImage = function (x, y) {
    var r = img.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  };
  var close = function () {
    lb.remove();
    doc.body.style.overflow = oldOverflow;
    doc.removeEventListener('keydown', onKey);
    if (prevFocus && prevFocus.focus) { try { prevFocus.focus({ preventScroll: true }); } catch (e) {} }
  };
  lb._close = close;
  var onKey = function (e) {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowLeft' && list.length > 1) show(cur - 1);
    else if (e.key === 'ArrowRight' && list.length > 1) show(cur + 1);
  };
  doc.addEventListener('keydown', onKey);
  $('.lb-close', lb).addEventListener('click', close);
  if (list.length > 1) {
    $('.lb-prev', lb).addEventListener('click', function () { show(cur - 1); });
    $('.lb-next', lb).addEventListener('click', function () { show(cur + 1); });
  }

  /* 手势：单指拖动或滑动切换、下滑关闭，双指缩放，双击放大 */
  var pts = {}, g = null, lastTap = { t: 0, x: 0, y: 0 }, tapTimer = null;
  var list2 = function () { return Object.keys(pts).map(function (k) { return pts[k]; }); };
  var begin = function () {
    var p = list2();
    g = { s0: st.s, x0: st.x, y0: st.y, moved: g ? g.moved : false, pinched: g ? g.pinched : false, t: g ? g.t : Date.now() };
    if (p.length >= 2) {
      g.pinched = true;
      g.d0 = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) || 1;
      g.mx = (p[0].x + p[1].x) / 2; g.my = (p[0].y + p[1].y) / 2;
    } else if (p.length === 1) {
      g.px = p[0].x; g.py = p[0].y;
    }
  };
  stage.addEventListener('pointerdown', function (e) {
    try { stage.setPointerCapture(e.pointerId); } catch (err) {}
    if (!Object.keys(pts).length) g = null;
    pts[e.pointerId] = { x: e.clientX, y: e.clientY };
    begin();
  });
  stage.addEventListener('pointermove', function (e) {
    if (!pts[e.pointerId] || !g) return;
    pts[e.pointerId] = { x: e.clientX, y: e.clientY };
    var p = list2();
    if (p.length >= 2) {
      var d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
      var mx = (p[0].x + p[1].x) / 2, my = (p[0].y + p[1].y) / 2;
      var s = Math.min(4, Math.max(0.8, g.s0 * d / g.d0));
      var cx = window.innerWidth / 2, cy = window.innerHeight / 2;
      var qx = (g.mx - cx - g.x0) / g.s0, qy = (g.my - cy - g.y0) / g.s0;
      st.s = s; st.x = mx - cx - s * qx; st.y = my - cy - s * qy;
      g.moved = true;
      apply(false);
      return;
    }
    var dx = p[0].x - g.px, dy = p[0].y - g.py;
    if (Math.abs(dx) > 8 || Math.abs(dy) > 8) g.moved = true;
    if (!g.moved) return;
    if (st.s > 1.01) {
      st.x = g.x0 + dx; st.y = g.y0 + dy;
    } else if (g.dir === 'y' || (!g.dir && Math.abs(dy) > Math.abs(dx))) {
      g.dir = 'y';
      st.x = 0; st.y = Math.max(0, dy);
      fadeBg(1 - Math.min(1, st.y / 400));
    } else {
      g.dir = 'x';
      st.x = list.length > 1 ? dx : dx * 0.3; st.y = 0;
    }
    apply(false);
  });
  var end = function (e) {
    if (!pts[e.pointerId]) return;
    delete pts[e.pointerId];
    if (Object.keys(pts).length) { begin(); return; }
    var gg = g; g = null;
    if (!gg) return;
    if (gg.pinched) {
      if (st.s < 1.05) { st.s = 1; st.x = 0; st.y = 0; } else clampPan();
      apply(true);
      return;
    }
    if (!gg.moved) {
      var now = Date.now(), x = e.clientX, y = e.clientY;
      if (now - lastTap.t < 300 && Math.hypot(x - lastTap.x, y - lastTap.y) < 30) {
        clearTimeout(tapTimer);
        lastTap.t = 0;
        if (st.s > 1.01) zoomAt(1, x, y); else zoomAt(2.5, x, y);
        apply(true);
      } else {
        lastTap = { t: now, x: x, y: y };
        tapTimer = setTimeout(function () { if (st.s <= 1.01 && !inImage(x, y)) close(); }, 300);
      }
      return;
    }
    if (st.s > 1.01) { clampPan(); apply(true); return; }
    if (gg.dir === 'y') {
      if (st.y > 110) { close(); return; }
      fadeBg(1);
    } else if (gg.dir === 'x' && list.length > 1 && Math.abs(st.x) > 60) {
      show(cur + (st.x < 0 ? 1 : -1));
      return;
    }
    st.x = 0; st.y = 0;
    apply(true);
  };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);
  stage.addEventListener('wheel', function (e) {
    e.preventDefault();
    zoomAt(Math.min(4, Math.max(1, st.s * (e.deltaY < 0 ? 1.15 : 1 / 1.15))), e.clientX, e.clientY);
    apply(false);
  }, { passive: false });

  show(index);
  $('.lb-close', lb).focus();
}

/* ---------- 备份与恢复 ---------- */
var BACKUP_FORMAT = 'inkcode-site-backup';
function ymd(t) {
  var d = new Date(t);
  return isNaN(d) ? '' : d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}
function safeName(s) {
  return (s || '无题').replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || '无题';
}
function fmtSize(n) {
  return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
}
function saveFile(filename, data, type) {
  try {
    var blob = data instanceof Blob ? data : new Blob([data], { type: type || 'application/octet-stream' });
    var url = URL.createObjectURL(blob);
    var a = doc.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    doc.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 4000);
    return Promise.resolve(true);
  } catch (e) {
    toast('这个浏览器无法下载文件。');
    return Promise.resolve(false);
  }
}
function backupPayload() {
  var d = clone(DATA);
  return { format: BACKUP_FORMAT, version: 1, exportedAt: nowISO(), site: d.site, posts: d.posts, novels: d.novels, images: d.images };
}
function markBackedUp() { LS.set(NS + 'lastBackup', String(Date.now())); }
function lastBackup() { return parseInt(LS.get(NS + 'lastBackup') || '0', 10) || 0; }
function loadJSZip() { return loadScript(LIB.jszip, 'JSZip', 15000); }
function dataUriBytes(uri) {
  var m = /^data:([^;,]+);base64,(.*)$/.exec(uri || '');
  if (!m) return null;
  var bin = atob(m[2]), arr = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return { bytes: arr, ext: /png/.test(m[1]) ? 'png' : /webp/.test(m[1]) ? 'webp' : /gif/.test(m[1]) ? 'gif' : 'jpg' };
}
function imageBytes(src) {
  var b = dataUriBytes(src);
  if (b) return Promise.resolve(b);
  return fetch(src, { credentials: 'same-origin' }).then(function (r) {
    if (!r.ok) return null;
    var ext = (/\.(\w+)(\?|$)/.exec(src) || [])[1] || 'jpg';
    return r.arrayBuffer().then(function (buf) { return { bytes: new Uint8Array(buf), ext: ext }; });
  }).catch(function () { return null; });
}
/* 导出用：把正文里的 /images/xxx 换回 img:编号，图片单独列出，和旧版备份格式一致 */
function portableData() {
  var d = clone(DATA), images = {};
  d.posts.forEach(function (p) {
    p.content = p.content.replace(/\]\((\/images\/([A-Za-z0-9_-]+)\.(webp|jpe?g|png|gif))\)/g, function (all, url, id) { images[id] = url; return '](img:' + id + ')'; });
  });
  d.images = images;
  return d;
}
function blobToDataUri(b) {
  return new Promise(function (res) { var fr = new FileReader(); fr.onload = function () { res(fr.result); }; fr.onerror = function () { res(null); }; fr.readAsDataURL(b); });
}
function portableBackup() {
  var d = portableData(), ids = Object.keys(d.images);
  return Promise.all(ids.map(function (id) {
    var src = resolveImg(d.images[id]);
    if (/^data:/.test(src)) return src;
    return fetch(src).then(function (r) { return r.ok ? r.blob() : null; }).then(function (b) { return b ? blobToDataUri(b) : null; }).catch(function () { return null; });
  })).then(function (list) {
    var images = {};
    ids.forEach(function (id, i) { if (list[i]) images[id] = list[i]; });
    return JSON.stringify({ format: BACKUP_FORMAT, version: 1, exportedAt: nowISO(), site: d.site, posts: d.posts, novels: d.novels, images: images });
  });
}
function buildMarkdownZip(JSZip) {
  var d = portableData(), ids = Object.keys(d.images);
  return Promise.all(ids.map(function (id) { return imageBytes(resolveImg(d.images[id])); })).then(function (list) {
    var bytes = {};
    ids.forEach(function (id, i) { if (list[i]) bytes[id] = list[i]; });
    return buildZipWith(JSZip, bytes, d);
  });
}
function buildZipWith(JSZip, imgBytes, model) {
  var zip = new JSZip(), d = model, used = {};
  var unique = function (path) {
    var base = path.replace(/\.md$/, ''), p = path, n = 2;
    while (used[p]) p = base + '-' + (n++) + '.md';
    used[p] = 1;
    return p;
  };
  var exts = {};
  Object.keys(imgBytes).forEach(function (id) {
    var b = imgBytes[id];
    exts[id] = b.ext;
    zip.file('图片/' + id + '.' + b.ext, b.bytes);
  });
  var fixImgs = function (md) {
    return md.replace(/\]\(img:([a-z0-9_-]+)\)/gi, function (m, id) { return '](../图片/' + id + '.' + (exts[id] || 'jpg') + ')'; });
  };
  var y = function (s) { return JSON.stringify(String(s == null ? '' : s)); };
  // 导出已转换图片引用的数据，按发布时间排序。
  d.posts.slice().sort(function (a, b) { return a.created < b.created ? 1 : a.created > b.created ? -1 : 0; }).forEach(function (p) {
    var front = '---\ntitle: ' + y(p.title) + '\ndate: ' + p.created + '\ntags: ' + JSON.stringify(p.tags) +
      (p.summary ? '\nsummary: ' + y(p.summary) : '') + '\n---\n\n';
    zip.file(unique('文章/' + ymd(p.created) + ' ' + safeName(p.title) + '.md'), front + fixImgs(p.content) + '\n');
  });
  d.novels.forEach(function (n) {
    var dir = '小说/' + safeName(n.title) + '/';
    var digits = String(n.chapters.length).length < 2 ? 2 : String(n.chapters.length).length;
    zip.file(unique(dir + '00 作品信息.md'), '# ' + n.title + '\n\n' +
      (n.genre ? '- 类型：' + n.genre + '\n' : '') + '- 状态：' + statusText(n) + '\n' +
      '- 署名：' + (n.author || d.site.name) + '\n- 章节：' + n.chapters.length + ' 章，' + novelWords(n) + ' 字\n\n' +
      (n.synopsis ? '## 简介\n\n' + n.synopsis.split(/\n+/).join('\n\n') + '\n' : ''));
    n.chapters.forEach(function (c, i) {
      var no = String(i + 1);
      while (no.length < digits) no = '0' + no;
      var sub = c.vol ? safeName(volTitle(n, c.vol)) + '/' : '';
      zip.file(unique(dir + sub + no + ' ' + safeName(c.title) + '.md'),
        '# ' + c.title + '\n\n' + c.content.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean).join('\n\n') + '\n');
    });
  });
  zip.file('说明.md', '# ' + d.site.name + ' 文稿导出\n\n导出时间：' + new Date().toLocaleString('zh-CN') + '\n\n' +
    '- 文章：每篇一个 Markdown 文件，开头是标题、日期和标签。\n' +
    '- 小说：每部作品一个文件夹，每章一个文件，按顺序编号。\n' +
    '- 图片：文章里用到的图片。\n\n这个压缩包适合阅读和迁移。要恢复网站，请使用 .json 格式的完整备份。\n');
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}
function readBackupFile(file) {
  return new Promise(function (res, rej) {
    var fr = new FileReader();
    fr.onerror = function () { rej(new Error('读取文件失败。')); };
    fr.onload = function () {
      var o;
      try { o = JSON.parse(fr.result); } catch (e) { rej(new Error('这个文件不是有效的备份：内容无法解析。')); return; }
      if (!o || typeof o !== 'object' || !o.site || !Array.isArray(o.posts) || !Array.isArray(o.novels)) {
        rej(new Error('这个文件不是本站的备份。请选择「下载完整备份」得到的 .json 文件。')); return;
      }
      res({ at: o.exportedAt || '', data: normalize({ site: o.site, posts: o.posts, novels: o.novels, images: o.images || {} }) });
    };
    fr.readAsText(file);
  });
}
function missingFrom(b) {
  var postIds = {}, novelMap = {};
  DATA.posts.forEach(function (p) { postIds[p.id] = 1; });
  DATA.novels.forEach(function (n) { novelMap[n.id] = n; });
  var posts = b.posts.filter(function (p) { return !postIds[p.id]; });
  var novels = b.novels.filter(function (n) { return !novelMap[n.id]; });
  var chapters = [];
  b.novels.forEach(function (n) {
    var mine = novelMap[n.id];
    if (!mine) return;
    var have = {};
    mine.chapters.forEach(function (c) { have[c.id] = 1; });
    n.chapters.forEach(function (c) { if (!have[c.id]) chapters.push({ nid: n.id, c: c }); });
  });
  return { posts: posts, novels: novels, chapters: chapters, count: posts.length + novels.length + chapters.length };
}
function backupTab() {
  var d = DATA, chs = d.novels.reduce(function (a, n) { return a + n.chapters.length; }, 0);
  var last = lastBackup();
  var html = '<p class="notice">网站内容保存在 GitHub 仓库里，每次提交都有完整的历史记录。另外再定期下载一份备份到自己的设备上，最稳妥。</p>' +
    '<div class="bk-stat"><div><b>' + d.posts.length + '</b><span>篇文章</span></div><div><b>' + d.novels.length + '</b><span>部小说</span></div>' +
    '<div><b>' + chs + '</b><span>个章节</span></div><div><b>' + Object.keys(d.images).length + '</b><span>张图片</span></div></div>' +
    '<p class="bk-last">' + (last ? '这台设备上次备份：' + fmtTime(last) : '这台设备还没有下载过备份') + '</p>' +
    '<div class="bk-card"><h3>完整备份</h3><p>一个 .json 文件，包含所有文章、小说、图片和网站设置，用来恢复网站，也可以搬到另一台服务器。</p>' +
    '<button type="button" class="btn primary block" id="bk-json">下载完整备份</button></div>' +
    '<div class="bk-card"><h3>Markdown 文稿</h3><p>一个 .zip 压缩包：每篇文章、每个章节都是单独的 .md 文件，图片放在单独的文件夹里。适合直接阅读，或者搬到其他平台。</p>' +
    '<button type="button" class="btn block" id="bk-zip">下载 Markdown 文稿</button></div>' +
    '<div class="bk-card"><h3>从备份恢复</h3><p>选择之前下载的 .json 备份文件。可以用备份替换现在的全部内容，也可以只补回现在缺少的文章、小说和章节。</p>' +
    '<button type="button" class="btn block" id="bk-restore">选择备份文件</button><input type="file" accept=".json,application/json" id="bk-file" hidden></div>';
  return {
    html: html,
    mount: function (main) {
      var name = safeName(d.site.name);
      var jsonBtn = $('#bk-json', main);
      jsonBtn.addEventListener('click', function () {
        jsonBtn.disabled = true;
        jsonBtn.textContent = '正在准备…';
        portableBackup().then(function (json) {
          return saveFile(name + ' 备份 ' + ymd(Date.now()) + '.json', json, 'application/json');        }).then(function (ok) {
          if (!ok) return;
          markBackedUp();
          $('.bk-last', main).textContent = '这台设备上次备份：' + fmtTime(Date.now());
          toast('已下载完整备份');
        }, function () {
          toast('备份没有生成成功，稍后再试一次。');
        }).then(function () {
          jsonBtn.disabled = false;
          jsonBtn.textContent = '下载完整备份';
        });
      });
      var zipBtn = $('#bk-zip', main);
      zipBtn.addEventListener('click', function () {
        zipBtn.disabled = true;
        zipBtn.textContent = '正在打包…';
        loadJSZip().then(buildMarkdownZip).then(function (blob) {
          return saveFile(name + ' 文稿 ' + ymd(Date.now()) + '.zip', blob);
        }).then(function (ok) {
          if (ok) toast('已下载 Markdown 文稿');
        }, function () {
          toast('打包工具没有加载成功。检查网络后再试一次。');
        }).then(function () {
          zipBtn.disabled = false;
          zipBtn.textContent = '下载 Markdown 文稿';
        });
      });
      var file = $('#bk-file', main);
      $('#bk-restore', main).addEventListener('click', function () { file.click(); });
      file.addEventListener('change', function () {
        var f = file.files && file.files[0];
        file.value = '';
        if (!f) return;
        readBackupFile(f).then(function (r) {
          var b = r.data, miss = missingFrom(b);
          var chs2 = b.novels.reduce(function (a, n) { return a + n.chapters.length; }, 0);
          var msg = '备份时间：' + (r.at ? fmtTime(Date.parse(r.at)) + '（' + ymd(Date.parse(r.at)) + '）' : '未知') + '\n' +
            '包含 ' + b.posts.length + ' 篇文章、' + b.novels.length + ' 部小说（' + chs2 + ' 章）、' + Object.keys(b.images).length + ' 张图片。\n\n' +
            '「全部替换」会用备份覆盖现在的所有内容和设置。不确定的话，先下载一份当前的备份。';
          return choiceBox(msg, [
            { v: 'merge', text: miss.count ? '只补回缺少的 ' + miss.count + ' 项' : '没有缺少的内容', cls: 'primary', disabled: !miss.count },
            { v: 'replace', text: '全部替换', cls: 'danger solid' }
          ]).then(function (choice) {
            if (choice === 'replace') {
              commit(function (dd) {
                dd.site = b.site; dd.posts = b.posts; dd.novels = b.novels; dd.images = b.images;
              }, { returnTo: '#/admin/backup', toast: '已从备份恢复', message: '从备份恢复全部内容' });
            } else if (choice === 'merge') {
              commit(function (dd) {
                miss.posts.forEach(function (p) { dd.posts.push(p); });
                miss.novels.forEach(function (n) { dd.novels.push(n); });
                b.novels.forEach(function (bn) {
                  var n = dd.novels.find(function (y) { return y.id === bn.id; });
                  if (!n) return;
                  n.volumes = n.volumes || [];
                  bn.volumes.forEach(function (v) { if (!n.volumes.some(function (x) { return x.id === v.id; })) n.volumes.push(v); });
                });
                miss.chapters.forEach(function (x) {
                  var n = dd.novels.find(function (y) { return y.id === x.nid; });
                  if (n) n.chapters.push(x.c);
                });
                Object.keys(b.images).forEach(function (k) { if (!dd.images[k]) dd.images[k] = b.images[k]; });
              }, { returnTo: '#/admin/backup', toast: '已补回 ' + miss.count + ' 项内容', message: '从备份补回内容' });
            }
          });
        }, function (err) { toast(err.message); });
      });
    }
  };
}

/* ---------- 归档与写作热力图 ---------- */
function dayKey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function writingEvents() {
  var ev = [];
  DATA.posts.forEach(function (p) {
    var t = new Date(p.created);
    if (isNaN(t)) return;
    ev.push({ type: 'post', t: t, day: dayKey(t), title: p.title, href: '#/post/' + enc(p.id), words: wordCount(p.content) });
  });
  DATA.novels.forEach(function (n) {
    n.chapters.forEach(function (c) {
      var t = new Date(c.created);
      if (isNaN(t)) return;
      ev.push({ type: 'chapter', t: t, day: dayKey(t), title: c.title, novel: n.title, href: '#/read/' + enc(n.id) + '/' + enc(c.id), words: wordCount(c.content) });
    });
  });
  return ev.sort(function (a, b) { return b.t - a.t; });
}
function hmLevel(w) { return w <= 0 ? 0 : w <= 500 ? 1 : w <= 1500 ? 2 : w <= 3000 ? 3 : 4; }
var archiveMode = 'all';
function viewArchive() {
  var html = '<div class="page-head"><h1>归档</h1><p>过去一年的写作记录，以及全部文章和章节。</p></div>' +
    '<div class="seg small hm-seg" id="hm-mode"><button type="button" data-m="all">全部</button><button type="button" data-m="post">博客</button><button type="button" data-m="chapter">小说</button></div>' +
    '<div class="hm-stats" id="hm-stats"></div>' +
    '<div class="hm-wrap"><div class="hm-scroll" id="hm-scroll"></div></div>' +
    '<div class="hm-legend" id="hm-legend"></div>' +
    '<div class="hm-detail" id="hm-detail" aria-live="polite"><p class="muted">点一个格子，查看那天写了什么。</p></div>' +
    '<div id="arc-list"></div>';
  return {
    html: html, nav: 'archive', title: '归档',
    mount: function (main) {
      var all = writingEvents();
      var today = new Date(); today.setHours(0, 0, 0, 0);
      var start = new Date(today); start.setDate(start.getDate() - 364);
      start.setDate(start.getDate() - ((start.getDay() + 6) % 7));          // 从周一开始
      var selected = null;
      var draw = function () {
        $$('#hm-mode button', main).forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-m') === archiveMode); });
        var ev = all.filter(function (e) { return archiveMode === 'all' || e.type === archiveMode; });
        var byDay = {};
        ev.forEach(function (e) {
          var d = byDay[e.day] || (byDay[e.day] = { post: 0, chapter: 0, pw: 0, cw: 0, items: [] });
          if (e.type === 'post') { d.post++; d.pw += e.words; } else { d.chapter++; d.cw += e.words; }
          d.items.push(e);
        });
        /* 统计（过去一年） */
        var inYear = ev.filter(function (e) { return e.t >= start; });
        var days = {}, words = 0;
        inYear.forEach(function (e) { days[e.day] = 1; words += e.words; });
        var best = 0, run = 0, curRun = 0;
        for (var d0 = new Date(start); d0 <= today; d0.setDate(d0.getDate() + 1)) {
          if (days[dayKey(d0)]) { run++; best = Math.max(best, run); } else run = 0;
        }
        for (var d1 = new Date(today); days[dayKey(d1)]; d1.setDate(d1.getDate() - 1)) curRun++;
        var nPost = inYear.filter(function (e) { return e.type === 'post'; }).length, nCh = inYear.length - nPost;
        var unit = archiveMode === 'post' ? [nPost + '', '篇文章'] : archiveMode === 'chapter' ? [nCh + '', '章小说'] : [nPost + ' / ' + nCh, '文章 / 章节'];
        $('#hm-stats', main).innerHTML = '<div><b>' + unit[0] + '</b><span>' + unit[1] + '</span></div>' +
          '<div><b>' + fmtWords(words) + '</b><span>字</span></div>' +
          '<div><b>' + Object.keys(days).length + '</b><span>天有更新</span></div>' +
          '<div><b>' + best + '</b><span>最长连续天数' + (curRun > 1 ? '，当前 ' + curRun : '') + '</span></div>';
        /* 热力图 */
        var cols = [], months = [], lastM = -1;
        for (var w = new Date(start); w <= today; w.setDate(w.getDate() + 7)) {
          var col = '';
          for (var k = 0; k < 7; k++) {
            var dd = new Date(w); dd.setDate(dd.getDate() + k);
            if (dd > today) { col += '<span class="hm-cell hm-out"></span>'; continue; }
            var key = dayKey(dd), info = byDay[key];
            var cls = 'hm-cell', label = (dd.getMonth() + 1) + '月' + dd.getDate() + '日：';
            if (info) {
              var kind = info.post && info.chapter ? 'bn' : info.post ? 'b' : 'n';
              cls += ' ' + kind + ' l' + hmLevel(info.pw + info.cw);
              label += (info.post ? '博客 ' + info.post + ' 篇 ' : '') + (info.chapter ? '小说 ' + info.chapter + ' 章' : '');
            } else label += '没有更新';
            if (key === selected) cls += ' sel';
            col += '<button type="button" class="' + cls + '" data-day="' + key + '" aria-label="' + label.trim() + '"></button>';
          }
          var m = w.getMonth();
          months.push(m !== lastM ? '<span>' + (m + 1) + '月</span>' : '<span></span>');
          lastM = m;
          cols.push('<div class="hm-col">' + col + '</div>');
        }
        var sc = $('#hm-scroll', main), keepLeft = sc.scrollLeft, first = !sc.firstChild;
        sc.innerHTML = '<div class="hm-months">' + months.join('') + '</div>' +
          '<div class="hm-body"><div class="hm-days"><span></span><span>一</span><span></span><span>三</span><span></span><span>五</span><span></span></div>' +
          '<div class="hm-grid">' + cols.join('') + '</div></div>';
        sc.scrollLeft = first ? sc.scrollWidth : keepLeft;
        var levels = archiveMode === 'chapter' ? 'n' : archiveMode === 'post' ? 'b' : 'b';
        $('#hm-legend', main).innerHTML = '<span class="hm-scale">少' + [0, 1, 2, 3, 4].map(function (l) {
          return '<i class="hm-cell ' + (l ? levels + ' l' + l : '') + '"></i>';
        }).join('') + '多</span>' +
          (archiveMode === 'all' ? '<span class="hm-keys"><span><i class="hm-cell b l4"></i>博客</span><span><i class="hm-cell n l4"></i>小说</span><span><i class="hm-cell bn l4"></i>同一天都有</span></span>' : '') +
          '<span class="hm-note">颜色深浅按当天字数</span>';
        /* 选中某天的详情 */
        var det = $('#hm-detail', main);
        if (selected) {
          var di = byDay[selected], parts = selected.split('-');
          det.innerHTML = '<p class="hm-date">' + (+parts[0]) + '年' + (+parts[1]) + '月' + (+parts[2]) + '日</p>' +
            (di ? '<ul class="arc-items">' + di.items.map(arcItem).join('') + '</ul>' : '<p class="muted">这一天没有更新。</p>');
        }
        /* 全部归档列表 */
        var groups = {}, order = [];
        ev.forEach(function (e) {
          var g = e.t.getFullYear() + '-' + pad(e.t.getMonth() + 1);
          if (!groups[g]) { groups[g] = []; order.push(g); }
          groups[g].push(e);
        });
        var lastY = '';
        $('#arc-list', main).innerHTML = order.length ? order.map(function (g, i) {
          var y = g.slice(0, 4), m = +g.slice(5), items = groups[g];
          var yh = y !== lastY ? '<h2 class="arc-year">' + y + ' 年</h2>' : '';
          lastY = y;
          var np = items.filter(function (e) { return e.type === 'post'; }).length, nc = items.length - np;
          return yh + '<details class="arc-month"' + (i < 3 ? ' open' : '') + '><summary><span>' + m + ' 月</span><small>' +
            [np ? np + ' 篇文章' : '', nc ? nc + ' 章小说' : ''].filter(Boolean).join('，') + '</small></summary>' +
            '<ul class="arc-items">' + items.map(arcItem).join('') + '</ul></details>';
        }).join('') : '<div class="empty">还没有内容。</div>';
      };
      draw();
      $('#hm-mode', main).addEventListener('click', function (e) {
        var b = e.target.closest('[data-m]');
        if (!b) return;
        archiveMode = b.getAttribute('data-m');
        draw();
      });
      $('#hm-scroll', main).addEventListener('click', function (e) {
        var c = e.target.closest('[data-day]');
        if (!c) return;
        selected = selected === c.getAttribute('data-day') ? null : c.getAttribute('data-day');
        if (!selected) $('#hm-detail', main).innerHTML = '<p class="muted">点一个格子，查看那天写了什么。</p>';
        draw();
      });
    }
  };
}
function arcItem(e) {
  return '<li><time>' + pad(e.t.getMonth() + 1) + '-' + pad(e.t.getDate()) + '</time>' +
    '<span class="arc-type ' + (e.type === 'post' ? 'b' : 'n') + '">' + (e.type === 'post' ? '文章' : '小说') + '</span>' +
    '<a href="' + e.href + '">' + (e.novel ? '《' + escHtml(e.novel) + '》' : '') + escHtml(e.title) + '</a>' +
    '<small>' + fmtWords(e.words) + ' 字</small></li>';
}

/* ---------- 写作后台 ---------- */
function gate(fn) {
  return fn();
}

function viewAdmin(tab, page) {
  return gate(function () {
    if (['posts', 'novels', 'settings', 'backup'].indexOf(tab) < 0) tab = 'posts';
    var tabs = [['posts', '博客'], ['novels', '小说'], ['settings', '设置'], ['backup', '备份']];
    var lb = lastBackup(), hasContent = DATA.posts.length + DATA.novels.length > 0;
    var stale = hasContent && tab !== 'backup' && (!lb || Date.now() - lb > 30 * 86400000);
    var html = '<div class="page-head"><h1>写作</h1><p>提交后大约 1–2 分钟上线。草稿也保存在仓库里，换设备也能接着写。' +
      '<a class="link-btn" href="#/login">连接设置</a>' + (CFG.siteUrl ? '<a class="link-btn" href="' + escHtml(CFG.siteUrl) + '/" target="_blank" rel="noopener">查看网站</a>' : '') + '</p></div>' +

      (stale ? '<p class="notice">' + (lb ? '已经超过 30 天没有备份了。' : '这台设备还没有下载过备份。') + '<a href="#/admin/backup">去备份</a></p>' : '') +
      '<div class="seg">' + tabs.map(function (t) {
        return '<a href="#/admin/' + t[0] + '" class="' + (t[0] === tab ? 'on' : '') + '">' + t[1] + '</a>';
      }).join('') + '</div>';
    var mount = null;
    if (tab === 'posts') {
      var posts = sortedPosts();
      var atotal = pageCount(posts.length, PER_PAGE.admin), apg = clampPage(page, atotal);
      html += '<a class="btn primary block" href="#/edit/post/new">写新博客</a>' +
        (posts.length ? '<ul class="adm-list">' + posts.slice((apg - 1) * PER_PAGE.admin, apg * PER_PAGE.admin).map(function (p) {
          return '<li><div class="al-main"><a href="#/post/' + enc(p.id) + '">' + (p.draft ? '<span class="draft-badge">草稿</span>' : '') + escHtml(p.title) + '</a>' +
            '<span>' + (p.pinned ? '置顶　' : '') + fmtDate(p.created) + '　' + fmtWords(wordCount(p.content)) + ' 字' + (p.series ? '　' + escHtml(p.series) : '') + '</span></div>' +
            '<div class="al-act"><a class="btn sm" href="#/edit/post/' + enc(p.id) + '">编辑</a>' +
            '<button type="button" class="btn sm ghost danger" data-del-post="' + escHtml(p.id) + '">删除</button></div></li>';
        }).join('') + '</ul>' + pagerHtml(apg, atotal, '#/admin/posts') : '<div class="empty">还没有文章。</div>');
      mount = function (main) {
        main.addEventListener('click', function (e) {
          var b = e.target.closest('[data-del-post]');
          if (!b) return;
          var id = b.getAttribute('data-del-post');
          var p = DATA.posts.find(function (x) { return x.id === id; });
          if (!p) return;
          confirmBox('删除《' + p.title + '》？删除后无法恢复。', '删除', true).then(function (ok) {
            if (ok) commit(function (d) { d.posts = d.posts.filter(function (x) { return x.id !== id; }); },
              { returnTo: location.hash, toast: '已删除', message: '删除文章' });
          });
        });
      };
    } else if (tab === 'novels') {
      html += '<a class="btn primary block" href="#/edit/novel/new">新建小说</a>' +
        (DATA.novels.length ? '<ul class="adm-list">' + DATA.novels.map(function (n) {
          return '<li><div class="al-main"><a href="#/novel/' + enc(n.id) + '">' + escHtml(n.title) + '</a>' +
            '<span>' + n.chapters.length + ' 章　' + fmtWords(novelWords(n)) + ' 字　' + statusText(n) + '</span></div>' +
            '<div class="al-act"><a class="btn sm" href="#/edit/novel/' + enc(n.id) + '">管理</a>' +
            '<button type="button" class="btn sm ghost danger" data-del-novel="' + escHtml(n.id) + '">删除</button></div></li>';
        }).join('') + '</ul>' : '<div class="empty">还没有作品。</div>');
      mount = function (main) {
        main.addEventListener('click', function (e) {
          var b = e.target.closest('[data-del-novel]');
          if (!b) return;
          var id = b.getAttribute('data-del-novel');
          var n = findNovel(id);
          if (!n) return;
          confirmBox('删除《' + n.title + '》和它的 ' + n.chapters.length + ' 个章节？删除后无法恢复。', '删除', true).then(function (ok) {
            if (ok) commit(function (d) { d.novels = d.novels.filter(function (x) { return x.id !== id; }); },
              { returnTo: '#/admin/novels', toast: '已删除', message: '删除小说' });
          });
        });
      };
    } else if (tab === 'backup') {
      var bk = backupTab();
      html += bk.html;
      mount = bk.mount;
    } else {
      var r = settingsTab();
      html += r.html;
      mount = r.mount;
    }
    return { html: html, nav: 'admin', title: '写作', mount: mount, keepStyle: tab === 'settings' };
  });
}

function settingsTab() {
  var s = DATA.site;
  var linksText = s.links.map(function (l) { return (l.label ? l.label + ' | ' : '') + l.url; }).join('\n');
  var html = '<div class="settings">' +
    '<label class="field"><span>网站名称</span><input class="input" id="s-name" maxlength="40" autocomplete="off"></label>' +
    '<label class="field"><span>一句话介绍</span><input class="input" id="s-tag" maxlength="80" autocomplete="off"></label>' +
    '<label class="field"><span>关于我</span><textarea class="input" id="s-bio" rows="4" maxlength="600"></textarea></label>' +
    '<label class="field"><span>链接</span><textarea class="input" id="s-links" rows="3" placeholder="GitHub | https://github.com/你的用户名"></textarea>' +
    '<small class="hint">每行一个，格式：名称 | 网址</small></label>' +
    '<label class="field"><span>印章文字</span><input class="input" id="s-seal" maxlength="2" autocomplete="off">' +
    '<small class="hint">1 到 2 个字，盖在小说封面的印章上。留空则取网站名称的前两个字。</small></label>' +
    '<div class="field"><span>风格</span><div class="style-grid">' + STYLE_KEYS.map(function (k) {
      var m = STYLE_META[k];
      return '<button type="button" class="style-card' + (k === s.style ? ' on' : '') + '" data-pick="' + k + '" aria-pressed="' + (k === s.style) + '">' +
        '<span class="sc-prev" data-style="' + k + '"><b>' + escHtml(s.name) + '</b><i>' + escHtml(m.sample) + '</i><em></em></span>' +
        '<span class="sc-name"><strong>' + m.name + '</strong><small>' + m.desc + '</small></span></button>';
    }).join('') + '</div><small class="hint">点一下即可预览整个网站的效果。保存后，访客看到的就是这个风格。</small></div>' +
    '<div class="ed-bar"><span class="ed-count">改动保存后立即上线</span><button type="button" class="btn primary" id="s-save">保存并发布</button></div></div>';
  return {
    html: html,
    mount: function (main) {
      loadAllFonts();
      var picked = s.style;
      $('#s-name', main).value = s.name;
      $('#s-tag', main).value = s.tagline;
      $('#s-bio', main).value = s.bio;
      $('#s-links', main).value = linksText;
      $('#s-seal', main).value = s.seal;
      $('#s-seal', main).placeholder = Array.from(s.name).slice(0, 2).join('');
      main.addEventListener('click', function (e) {
        var b = e.target.closest('[data-pick]');
        if (!b) return;
        picked = b.getAttribute('data-pick');
        $$('[data-pick]', main).forEach(function (x) {
          x.classList.toggle('on', x === b);
          x.setAttribute('aria-pressed', String(x === b));
        });
        applyStyle(picked);
      });
      $('#s-save', main).addEventListener('click', function () {
        var name = $('#s-name', main).value.trim();
        if (!name) { toast('网站名称不能为空。'); $('#s-name', main).focus(); return; }
        var links = $('#s-links', main).value.split('\n').map(function (l) { return l.trim(); }).filter(Boolean).map(function (l) {
          var m = l.split(/\s*[|｜]\s*/);
          var url = (m.length > 1 ? m.slice(1).join('|') : m[0]).trim();
          var label = m.length > 1 ? m[0].trim() : url.replace(/^https?:\/\//, '').replace(/\/$/, '');
          return { label: label, url: safeUrl(url) };
        }).filter(function (l) { return l.url !== '#'; }).slice(0, 8);
        commit(function (d) {
          d.site = Object.assign({}, d.site, {
            name: name, tagline: $('#s-tag', main).value.trim(), bio: $('#s-bio', main).value.trim(),
            links: links, seal: $('#s-seal', main).value.trim(), style: picked
          });
        }, { returnTo: '#/admin/settings', toast: '已保存并提交', message: '更新网站设置' });
      });
    }
  };
}

/* ---------- 通用编辑器（博客 / 章节） ---------- */
var TOOLBAR = [['h2', '标题'], ['b', '粗体'], ['i', '斜体'], ['code', '行内代码'], ['block', '代码块'], ['callout', '提示框'],
  ['link', '链接'], ['ul', '列表'], ['quote', '引用'], ['img', '图片']];

function autoGrow(ta) {
  var y = window.scrollY;
  ta.style.height = 'auto';
  ta.style.height = ta.scrollHeight + 'px';
  window.scrollTo(0, y);
}
function mdAction(ta, kind) {
  var s = ta.selectionStart, e = ta.selectionEnd, v = ta.value, sel = v.slice(s, e);
  var wrap = function (a, b, ph) {
    var t = sel || ph;
    ta.setRangeText(a + t + b, s, e, 'end');
    ta.setSelectionRange(s + a.length, s + a.length + t.length);
  };
  var line = function (prefix) {
    var ls = v.lastIndexOf('\n', s - 1) + 1;
    ta.setRangeText(prefix, ls, ls, 'preserve');
    ta.setSelectionRange(s + prefix.length, e + prefix.length);
  };
  switch (kind) {
    case 'h2': line('## '); break;
    case 'b': wrap('**', '**', '粗体文字'); break;
    case 'i': wrap('*', '*', '斜体文字'); break;
    case 'code': wrap('`', '`', 'code'); break;
    case 'block': wrap((s > 0 && v[s - 1] !== '\n' ? '\n' : '') + '```\n', '\n```\n', '// 在这里粘贴代码'); break;
    case 'link': wrap('[', '](https://)', '链接文字'); break;
    case 'ul': line('- '); break;
    case 'quote': line('> '); break;
    case 'callout': wrap((s > 0 && v[s - 1] !== '\n' ? '\n' : '') + '> [!TIP]\n> ', '\n', '提示内容。类型还有 NOTE、IMPORTANT、WARNING、CAUTION'); break;
  }
  ta.focus();
}
function insertText(ta, text) {
  var s = ta.selectionStart, e = ta.selectionEnd;
  ta.setRangeText(text, s, e, 'end');
  ta.focus();
}
function encodeImage(img) {
  /* 依次尝试，直到图片小于约 200KB：优先 WebP，浏览器不支持时用 JPEG */
  var tries = [[1280, 0.8], [1280, 0.7], [1080, 0.68], [960, 0.62]], last = '';
  for (var i = 0; i < tries.length; i++) {
    var max = tries[i][0], q = tries[i][1];
    var w = img.naturalWidth, h = img.naturalHeight, r = Math.min(1, max / Math.max(w, h));
    var c = doc.createElement('canvas');
    c.width = Math.round(w * r); c.height = Math.round(h * r);
    var x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
    x.drawImage(img, 0, 0, c.width, c.height);
    var url = c.toDataURL('image/webp', q);
    if (url.indexOf('data:image/webp') !== 0) url = c.toDataURL('image/jpeg', q);
    last = url;
    if (url.length * 0.75 < 200 * 1024) break;
  }
  return last;
}
function compressImage(file) {
  return new Promise(function (res, rej) {
    if (!/^image\//.test(file.type)) { rej(new Error('只能插入图片文件。')); return; }
    var fr = new FileReader();
    fr.onerror = function () { rej(new Error('读取图片失败。')); };
    fr.onload = function () {
      var img = new Image();
      img.onerror = function () { rej(new Error('这张图片的格式无法识别。')); };
      img.onload = function () { res(encodeImage(img)); };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}

/*
 * cfg: { key, base:{...fields}, fields:{name:selector}, preview(state)->html, onPublish(state), withImages }
 */
function mountEditor(main, cfg) {
  var st = Object.assign({}, cfg.base, { images: {} });
  var els = {};
  Object.keys(cfg.fields).forEach(function (k) { els[k] = $(cfg.fields[k], main); });
  var body = els.content, prev = $('#f-prev', main), status = $('#ed-status', main), count = $('#ed-count', main);
  var tb = $('#tb', main), slot = $('#draft-slot', main);
  var keys = Object.keys(cfg.fields);
  var getV = function (el) { return el.type === 'checkbox' ? (el.checked ? '1' : '') : el.value; };
  var setV = function (el, v) { if (el.type === 'checkbox') el.checked = v === '1'; else el.value = v || ''; };
  var same = function (a) { return keys.every(function (k) { return (a[k] || '') === (cfg.base[k] || ''); }); };
  var updCount = function () { count.textContent = fmtWords(wordCount(st.content)) + ' 字'; };
  var fill = function () {
    keys.forEach(function (k) { setV(els[k], st[k]); });
    Object.keys(st.images || {}).forEach(function (k) { PENDING_IMAGES[k] = st.images[k]; });
    updCount();
    autoGrow(body);
  };
  fill();

  var save = debounce(function () {
    if (same(st) && !Object.keys(st.images).length) { dropDraft(cfg.key); status.textContent = ''; return; }
    status.textContent = saveDraft(cfg.key, st) ? '草稿已存在本机 ' + fmtTime(Date.now()).replace('今天 ', '') : '这台设备无法保存草稿';
  }, 700);
  cleanups.push(save.flush);

  var draft = loadDraft(cfg.key);
  if (draft && !same(draft.data)) {
    slot.innerHTML = '<div class="draft-banner"><span>这台设备上有一份 ' + fmtTime(draft.t) + ' 未发布的草稿。</span>' +
      '<button type="button" class="btn sm primary" data-d="r">恢复草稿</button>' +
      '<button type="button" class="btn sm ghost" data-d="x">丢弃</button></div>';
    slot.addEventListener('click', function (e) {
      var b = e.target.closest('[data-d]');
      if (!b) return;
      if (b.getAttribute('data-d') === 'r') {
        keys.forEach(function (k) { if (typeof draft.data[k] === 'string') st[k] = draft.data[k]; });
        st.images = draft.data.images || {};
        fill();
        status.textContent = '已恢复草稿';
      } else {
        dropDraft(cfg.key);
      }
      slot.innerHTML = '';
    });
  } else if (draft) {
    dropDraft(cfg.key);
  }

  var onInput = function () {
    keys.forEach(function (k) { st[k] = getV(els[k]); });
    updCount();
    if (slot.firstChild) slot.innerHTML = '';
    save();
  };
  keys.forEach(function (k) {
    els[k].addEventListener('input', onInput);
    if (els[k].tagName === 'SELECT' || els[k].type === 'checkbox') els[k].addEventListener('change', onInput);
  });
  body.addEventListener('input', function () { autoGrow(body); });

  $$('.ed-tabs button', main).forEach(function (b) {
    b.addEventListener('click', function () {
      var mode = b.getAttribute('data-tab');
      $$('.ed-tabs button', main).forEach(function (x) { x.classList.toggle('on', x === b); x.setAttribute('aria-selected', String(x === b)); });
      var write = mode === 'write';
      body.hidden = !write;
      if (tb) tb.hidden = !write;
      prev.hidden = write;
      if (!write) {
        prev.innerHTML = st.content.trim() ? cfg.preview(st) : '<p class="muted">正文还是空的。</p>';
        enhanceProse(prev);
        if (!mdReady && cfg.markdown) ensureMarkdown().then(function (ok) {
          if (ok && !prev.hidden && prev.isConnected) { prev.innerHTML = cfg.preview(st); enhanceProse(prev); }
        });
      } else {
        autoGrow(body);
      }
    });
  });

  if (tb) {
    tb.addEventListener('mousedown', function (e) { if (e.target.closest('[data-md]')) e.preventDefault(); });
    tb.addEventListener('click', function (e) {
      var b = e.target.closest('[data-md]');
      if (!b) return;
      if (b.getAttribute('data-md') === 'img') { $('#f-img', main).click(); return; }
      mdAction(body, b.getAttribute('data-md'));
      onInput();
      autoGrow(body);
    });
    var file = $('#f-img', main);
    file.addEventListener('change', function () {
      var f = file.files && file.files[0];
      file.value = '';
      if (!f) return;
      status.textContent = '正在压缩图片…';
      compressImage(f).then(function (url) {
        var id = uid();
        st.images[id] = url;
        PENDING_IMAGES[id] = url;
        insertText(body, '\n![图片说明](img:' + id + ')\n');
        onInput();
        autoGrow(body);
        status.textContent = '已插入图片，约 ' + Math.round(url.length * 0.75 / 1024) + ' KB';
      }, function (err) {
        status.textContent = '';
        toast(err.message);
      });
    });
  }

  var submit = function (draft) {
    keys.forEach(function (k) { st[k] = getV(els[k]); });
    if (!st.title.trim()) { toast('先写个标题。'); els.title.focus(); return; }
    if (!st.content.trim() && !draft) { toast('正文还是空的。'); return; }
    save.flush();
    cfg.onPublish(st, { draft: draft });
  };
  $('#ed-pub', main).addEventListener('click', function () { submit(false); });
  $('#ed-draft', main).addEventListener('click', function () { submit(true); });
}

function editorHtml(o) {
  return '<div class="editor"><div class="ed-head"><a class="back" href="' + o.back + '">‹ ' + escHtml(o.backText) + '</a>' +
    '<span class="ed-status" id="ed-status" aria-live="polite"></span></div>' +
    '<div id="draft-slot"></div>' +
    '<input class="ed-title" id="f-title" placeholder="' + o.titlePh + '" maxlength="120" autocomplete="off" aria-label="标题">' +
    (o.meta || '') +
    '<div class="ed-tabs" role="tablist"><button type="button" class="on" data-tab="write" aria-selected="true">' + o.writeTab + '</button>' +
    '<button type="button" data-tab="preview" aria-selected="false">预览</button></div>' +
    (o.toolbar ? '<div class="ed-toolbar" id="tb" aria-label="格式">' + TOOLBAR.map(function (t) {
      return '<button type="button" data-md="' + t[0] + '">' + t[1] + '</button>';
    }).join('') + '</div><input type="file" accept="image/*" id="f-img" hidden>' : '') +
    '<textarea class="ed-body' + (o.novel ? ' ed-novel' : '') + '" id="f-body" placeholder="' + o.bodyPh + '" aria-label="正文"></textarea>' +
    '<div class="ed-preview ' + (o.novel ? 'chapter-body' : 'prose') + '" id="f-prev" hidden></div>' +
    '<div class="ed-bar"><span class="ed-count" id="ed-count"></span>' +
    '<span class="ed-btns"><button type="button" class="btn ghost" id="ed-draft">' + o.draftText + '</button>' +
    '<button type="button" class="btn primary" id="ed-pub">' + o.pubText + '</button></span></div></div>';
}

function viewEditPost(id) {
  return gate(function () {
    var isNew = id === 'new';
    var post = isNew ? null : DATA.posts.find(function (p) { return p.id === id; });
    if (!isNew && !post) return notFound('要编辑的文章不存在。', ['#/admin/posts', '回到后台']);
    var html = editorHtml({
      back: isNew ? '#/admin/posts' : '#/post/' + enc(post.id), backText: '返回', titlePh: '标题',
      meta: '<div class="ed-meta"><input class="input" id="f-tags" placeholder="标签，用逗号分隔（可选）" autocomplete="off" aria-label="标签">' +
        '<textarea class="input" id="f-sum" rows="2" placeholder="摘要（可选，留空则自动截取正文开头）" aria-label="摘要"></textarea>' +
        '<details class="ed-more"' + (post && (post.series || post.pinned) ? ' open' : '') + '><summary>系列与置顶</summary>' +
        '<label class="field"><span>所属系列</span><input class="input" id="f-series" list="series-list" maxlength="40" autocomplete="off" placeholder="例如：Rust 入门（可选）">' +
        '<datalist id="series-list">' + Object.keys(DATA.posts.reduce(function (a, x) { if (x.series) a[x.series] = 1; return a; }, {})).map(function (n) {
          return '<option value="' + escHtml(n) + '">';
        }).join('') + '</datalist><small class="hint">同一系列的文章会互相链接，按发布顺序排列。</small></label>' +
        '<label class="check"><input type="checkbox" id="f-pin"><span>置顶这篇文章</span></label></details></div>',
      writeTab: '编辑', toolbar: true, bodyPh: '正文，支持 Markdown。',
      pubText: isNew || post.draft ? '发布' : '发布更新', draftText: isNew || post.draft ? '存草稿' : '转为草稿'
    });
    return {
      html: html, nav: 'admin', bare: true, title: isNew ? '写新博客' : '编辑文章',
      mount: function (main) {
        var key = 'post:' + (isNew ? 'new' : post.id);
        mountEditor(main, {
          key: key,
          base: { title: post ? post.title : '', tags: post ? post.tags.join('，') : '', summary: post ? post.summary : '',
            series: post ? post.series : '', pinned: post && post.pinned ? '1' : '', content: post ? post.content : '' },
          fields: { title: '#f-title', tags: '#f-tags', summary: '#f-sum', series: '#f-series', pinned: '#f-pin', content: '#f-body' },
          preview: function (st) { return renderMarkdown(st.content); },
          markdown: true,
          onPublish: function (st, o) {
            var draft = !!(o && o.draft);
            var pid = isNew ? newPostId() : post.id;
            var imgs = st.images;
            commit(function (d) {
              var now = nowISO();
              var old = d.posts.find(function (p) { return p.id === pid; });
              var firstPublish = !draft && (!old || old.draft);   // 第一次发布时，日期用发布这一刻
              var np = { id: pid, title: st.title.trim(), tags: parseTags(st.tags), summary: st.summary.trim(),
                series: (st.series || '').trim(), pinned: st.pinned === '1', draft: draft,
                content: st.content, created: old && !firstPublish ? old.created : now, updated: now };
              if (old) Object.assign(old, np); else d.posts.push(np);
              Object.keys(imgs).forEach(function (k) { d.images[k] = imgs[k]; });
            }, {
              returnTo: '#/post/' + enc(pid), clearDraft: key, live: draft ? '/' : '/posts/' + pid + '/',
              toast: draft ? '已存为草稿' : (isNew || post.draft ? '已发布' : '已发布更新'),
              message: (draft ? '草稿：' : '发布：') + st.title.trim()
            });
          }
        });
      }
    };
  });
}

function viewEditChapter(nid, cid) {
  return gate(function () {
    var n = findNovel(nid);
    if (!n) return notFound('这部作品不存在。', ['#/admin/novels', '回到后台']);
    var isNew = cid === 'new';
    var c = isNew ? null : n.chapters.find(function (x) { return x.id === cid; });
    if (!isNew && !c) return notFound('要编辑的章节不存在。', ['#/edit/novel/' + enc(n.id), '回到作品']);
    var html = editorHtml({
      back: '#/edit/novel/' + enc(n.id), backText: n.title, titlePh: '章节标题',
      writeTab: '写作', toolbar: false, novel: true,
      meta: n.volumes.length ? '<label class="field ed-vol"><span>所属分卷</span><select class="input" id="f-vol">' +
        '<option value="">未分卷</option>' + n.volumes.map(function (v) { return '<option value="' + escHtml(v.id) + '">' + escHtml(v.title) + '</option>'; }).join('') +
        '</select></label>' : '',
      bodyPh: '直接写正文，一行就是一段。单独一行写 *** 表示场景转换。',
      pubText: isNew || c.draft ? '发布' : '发布更新', draftText: isNew || c.draft ? '存草稿' : '转为草稿'
    });
    return {
      html: html, nav: 'admin', bare: true, title: isNew ? '写新章节' : '编辑章节',
      mount: function (main) {
        var key = 'ch:' + n.id + ':' + (isNew ? 'new' : c.id);
        mountEditor(main, {
          key: key,
          base: { title: c ? c.title : '第' + cnNum(n.chapters.length + 1) + '章 ', content: c ? c.content : '',
            vol: c ? c.vol : (n.volumes.length ? n.volumes[n.volumes.length - 1].id : '') },
          fields: n.volumes.length ? { title: '#f-title', vol: '#f-vol', content: '#f-body' } : { title: '#f-title', content: '#f-body' },
          preview: function (st) { return renderChapterText(st.content); },
          onPublish: function (st, o) {
            var draft = !!(o && o.draft);
            var chId = isNew ? uid() : c.id;
            commit(function (d) {
              var nn = d.novels.find(function (x) { return x.id === n.id; });
              if (!nn) return;
              var now = nowISO();
              var old = nn.chapters.find(function (x) { return x.id === chId; });
              var vol = st.vol || '';
              var firstPublish = !draft && (!old || old.draft);
              if (old) {
                old.title = st.title.trim(); old.content = st.content; old.updated = now; old.draft = draft;
                if (firstPublish) old.created = now;
                if (nn.volumes.length) old.vol = vol;
              } else nn.chapters.push({ id: chId, title: st.title.trim(), content: st.content, vol: vol, draft: draft, created: now, updated: now });
              if (!draft) nn.updated = now;
            }, {
              returnTo: '#/read/' + enc(n.id) + '/' + enc(chId), clearDraft: key, live: draft ? '/' : '/novels/' + n.id + '/' + chId + '/',
              toast: draft ? '已存为草稿' : (isNew || c.draft ? '已发布' : '已发布更新'),
              message: (draft ? '草稿：' : '发布：') + n.title + ' ' + st.title.trim()
            });
          }
        });
      }
    };
  });
}

function viewEditNovel(id) {
  return gate(function () {
    var isNew = id === 'new';
    var n = isNew ? null : findNovel(id);
    if (!isNew && !n) return notFound('这部作品不存在。', ['#/admin/novels', '回到后台']);
    var cur = { title: n ? n.title : '', genre: n ? n.genre : '', status: n ? n.status : 'serial', synopsis: n ? n.synopsis : '', cover: n ? n.cover : 'dai', tpl: n ? n.tpl : 'thread', author: n ? n.author : '' };
    var html = '<div class="editor"><div class="ed-head"><a class="back" href="' + (isNew ? '#/admin/novels' : '#/novel/' + enc(n.id)) + '">‹ 返回</a></div>' +
      '<h1 class="ed-h">' + (isNew ? '新建小说' : '管理作品') + '</h1>' +
      '<div class="novel-form"><div id="nf-cover"></div><div>' +
      '<label class="field"><span>书名</span><input class="input" id="n-title" maxlength="40" autocomplete="off"></label>' +
      '<label class="field"><span>类型</span><input class="input" id="n-genre" maxlength="20" placeholder="例如：都市奇幻" autocomplete="off"></label>' +
      '<label class="field"><span>署名</span><input class="input" id="n-author" maxlength="20" autocomplete="off" placeholder="' + escHtml(DATA.site.name) + '"></label>' +
      '<div class="field"><span>状态</span><div class="seg small" id="n-status">' +
      '<button type="button" data-v="serial">连载中</button><button type="button" data-v="done">已完结</button></div></div>' +
      '</div></div>' +
      '<label class="field"><span>简介</span><textarea class="input" id="n-syn" rows="4" maxlength="800"></textarea></label>' +
      '<div class="field"><span>封面样式</span><div class="tpl-grid" id="n-tpl"></div>' +
      '<small class="hint">书名和署名会自动排进封面。署名留空时使用网站名称。</small></div>' +
      '<div class="field"><span>封面主色</span><div class="swatches" id="n-cover">' + Object.keys(COVERS).map(function (k) {
        return '<button type="button" class="sw cv-' + k + '" data-v="' + k + '" aria-label="' + COVERS[k] + '色">' + COVERS[k] + '</button>';
      }).join('') + '</div></div>' +
      '<button type="button" class="btn primary block" id="n-save">' + (isNew ? '创建作品' : '保存作品信息') + '</button>' +
      (isNew ? '' : '<div class="row-head"><h2>章节与分卷</h2>' +
        '<a class="btn sm primary" href="#/edit/chapter/' + enc(n.id) + '/new">写新章节</a></div>' +
        '<p class="hint vol-hint">章节多了可以分卷，目录会按卷分组。改完顺序或分卷后，点下方按钮保存。</p>' +
        '<div id="ch-area"></div>' +
        '<button type="button" class="btn block" id="vol-add">新建分卷</button>' +
        '<div class="ch-save-bar" id="ch-save-bar" hidden><span>章节或分卷有改动，还没保存</span>' +
        '<button type="button" class="btn ghost sm" id="ch-reset">撤销</button><button type="button" class="btn primary sm" id="ch-save">保存</button></div>') +
      '</div>';
    return {
      html: html, nav: 'admin', title: isNew ? '新建小说' : '管理作品',
      mount: function (main) {
        var t = $('#n-title', main), g = $('#n-genre', main), syn = $('#n-syn', main), au = $('#n-author', main);
        t.value = cur.title; g.value = cur.genre; syn.value = cur.synopsis; au.value = cur.author;
        var drawCover = function () {
          var info = { title: t.value.trim() || '书名', cover: cur.cover, tpl: cur.tpl, author: au.value.trim() };
          $('#nf-cover', main).innerHTML = coverHtml(info);
          $('#n-tpl', main).innerHTML = Object.keys(TEMPLATES).map(function (k) {
            return '<button type="button" class="tpl' + (k === cur.tpl ? ' on' : '') + '" data-v="' + k + '" aria-pressed="' + (k === cur.tpl) + '">' +
              coverHtml(Object.assign({}, info, { tpl: k })) + '<span>' + TEMPLATES[k] + '</span></button>';
          }).join('');
        };
        var drawPick = function () {
          $$('#n-status button', main).forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-v') === cur.status); });
          $$('#n-cover button', main).forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-v') === cur.cover); });
        };
        drawCover(); drawPick();
        t.addEventListener('input', drawCover);
        au.addEventListener('input', drawCover);
        $('#n-tpl', main).addEventListener('click', function (e) {
          var b = e.target.closest('[data-v]'); if (!b) return; cur.tpl = b.getAttribute('data-v'); drawCover();
        });
        $('#n-status', main).addEventListener('click', function (e) {
          var b = e.target.closest('[data-v]'); if (!b) return; cur.status = b.getAttribute('data-v'); drawPick();
        });
        $('#n-cover', main).addEventListener('click', function (e) {
          var b = e.target.closest('[data-v]'); if (!b) return; cur.cover = b.getAttribute('data-v'); drawPick(); drawCover();
        });
        $('#n-save', main).addEventListener('click', function () {
          var title = t.value.trim();
          if (!title) { toast('先写书名。'); t.focus(); return; }
          var nid = isNew ? uid() : n.id;
          commit(function (d) {
            var now = nowISO();
            var info = { title: title, genre: g.value.trim(), status: cur.status, synopsis: syn.value.trim(), cover: cur.cover, tpl: cur.tpl, author: au.value.trim(), updated: now };
            var old = d.novels.find(function (x) { return x.id === nid; });
            if (old) Object.assign(old, info);
            else d.novels.push(Object.assign({ id: nid, created: now, chapters: [] }, info));
          }, { returnTo: '#/edit/novel/' + enc(nid), toast: isNew ? '已创建作品，开始写第一章吧' : '已保存作品信息', message: (isNew ? '新建小说：' : '更新小说信息：') + title });
        });

        var area = $('#ch-area', main);
        if (!area) return;
        var initial = function () {
          return { vols: n.volumes.map(function (v) { return { id: v.id, title: v.title }; }),
            order: n.chapters.map(function (c) { return { id: c.id, vol: c.vol }; }) };
        };
        var stt = initial(), snap = JSON.stringify(stt);
        var chap = function (id) { return n.chapters.find(function (x) { return x.id === id; }); };
        var regroup = function () {
          var vi = {};
          stt.vols.forEach(function (v, i) { vi[v.id] = i; });
          stt.order.forEach(function (o) { if (!Object.prototype.hasOwnProperty.call(vi, o.vol)) o.vol = ''; });
          stt.order = stt.order.map(function (o, i) { return { o: o, i: i, k: o.vol ? vi[o.vol] : -1 }; })
            .sort(function (a, b) { return a.k - b.k || a.i - b.i; }).map(function (x) { return x.o; });
        };
        var dirty = function () { return JSON.stringify(stt) !== snap; };
        var draw = function () {
          regroup();
          var groups = [{ id: '', title: '未分卷' }].concat(stt.vols);
          var opts = function (sel) {
            return '<option value=""' + (sel ? '' : ' selected') + '>未分卷</option>' + stt.vols.map(function (v) {
              return '<option value="' + escHtml(v.id) + '"' + (v.id === sel ? ' selected' : '') + '>' + escHtml(v.title) + '</option>';
            }).join('');
          };
          area.innerHTML = groups.map(function (g, gi) {
            var items = stt.order.filter(function (o) { return o.vol === g.id; });
            if (!g.id && !items.length && stt.vols.length) return '';
            var head = '';
            if (g.id) {
              head = '<div class="vol-head"><input class="input vol-name" data-vname="' + escHtml(g.id) + '" value="' + escHtml(g.title) + '" maxlength="40" aria-label="分卷名称">' +
                '<button type="button" class="btn sm ghost icon" data-vmv="' + escHtml(g.id) + ':-1"' + (gi === 1 ? ' disabled' : '') + ' aria-label="分卷上移">↑</button>' +
                '<button type="button" class="btn sm ghost icon" data-vmv="' + escHtml(g.id) + ':1"' + (gi === groups.length - 1 ? ' disabled' : '') + ' aria-label="分卷下移">↓</button>' +
                '<button type="button" class="btn sm ghost danger" data-vdel="' + escHtml(g.id) + '">删除卷</button></div>';
            } else if (stt.vols.length) {
              head = '<div class="vol-head plain">未分卷</div>';
            }
            var list = items.length ? '<ul class="adm-list">' + items.map(function (o, i) {
              var c = chap(o.id);
              return '<li><div class="al-main"><a href="#/read/' + enc(n.id) + '/' + enc(c.id) + '">' + (c.draft ? '<span class="draft-badge">草稿</span>' : '') + escHtml(c.title) + '</a>' +
                '<span>' + fmtWords(wordCount(c.content)) + ' 字　' + fmtDate(c.created) + '</span></div>' +
                '<div class="al-act">' +
                (stt.vols.length ? '<select class="input vol-pick" data-chvol="' + escHtml(c.id) + '" aria-label="移到分卷">' + opts(o.vol) + '</select>' : '') +
                '<button type="button" class="btn sm ghost icon" data-mv="' + escHtml(c.id) + ':-1"' + (i === 0 ? ' disabled' : '') + ' aria-label="上移">↑</button>' +
                '<button type="button" class="btn sm ghost icon" data-mv="' + escHtml(c.id) + ':1"' + (i === items.length - 1 ? ' disabled' : '') + ' aria-label="下移">↓</button>' +
                '<a class="btn sm" href="#/edit/chapter/' + enc(n.id) + '/' + enc(c.id) + '">编辑</a>' +
                '<button type="button" class="btn sm ghost danger" data-delch="' + escHtml(c.id) + '">删除</button></div></li>';
            }).join('') + '</ul>' : '<p class="vol-empty">' + (g.id ? '这一卷还没有章节。用章节右侧的下拉框把章节移进来。' : '还没有章节。') + '</p>';
            return '<section class="vol-group">' + head + list + '</section>';
          }).join('');
          $('#ch-save-bar', main).hidden = !dirty();
        };
        draw();
        area.addEventListener('input', function (e) {
          var inp = e.target.closest('[data-vname]');
          if (!inp) return;
          var v = stt.vols.find(function (x) { return x.id === inp.getAttribute('data-vname'); });
          if (v) v.title = inp.value;
          $('#ch-save-bar', main).hidden = !dirty();
        });
        area.addEventListener('change', function (e) {
          var sel = e.target.closest('[data-chvol]');
          if (!sel) return;
          var id = sel.getAttribute('data-chvol');
          var idx = stt.order.findIndex(function (o) { return o.id === id; });
          var item = stt.order.splice(idx, 1)[0];
          item.vol = sel.value;
          stt.order.push(item);
          draw();
        });
        area.addEventListener('click', function (e) {
          var mv = e.target.closest('[data-mv]');
          if (mv) {
            var p = mv.getAttribute('data-mv').split(':'), id = p[0], dir = +p[1];
            var i = stt.order.findIndex(function (o) { return o.id === id; }), vol = stt.order[i].vol, j = i + dir;
            while (j >= 0 && j < stt.order.length && stt.order[j].vol !== vol) j += dir;
            if (j >= 0 && j < stt.order.length) { var t = stt.order[i]; stt.order[i] = stt.order[j]; stt.order[j] = t; }
            draw();
            return;
          }
          var vmv = e.target.closest('[data-vmv]');
          if (vmv) {
            var q = vmv.getAttribute('data-vmv').split(':'), vi = stt.vols.findIndex(function (v) { return v.id === q[0]; }), vj = vi + (+q[1]);
            if (vj >= 0 && vj < stt.vols.length) { var tv = stt.vols[vi]; stt.vols[vi] = stt.vols[vj]; stt.vols[vj] = tv; }
            draw();
            return;
          }
          var vdel = e.target.closest('[data-vdel]');
          if (vdel) {
            var vid = vdel.getAttribute('data-vdel');
            stt.vols = stt.vols.filter(function (v) { return v.id !== vid; });
            stt.order.forEach(function (o) { if (o.vol === vid) o.vol = ''; });
            draw();
            toast('分卷已删除，里面的章节移到了「未分卷」。保存后生效。');
            return;
          }
          var del = e.target.closest('[data-delch]');
          if (del) {
            if (dirty()) { toast('先保存或撤销章节和分卷的改动，再删除章节。'); return; }
            var cid = del.getAttribute('data-delch');
            var c = chap(cid);
            confirmBox('删除「' + c.title + '」？删除后无法恢复。', '删除', true).then(function (ok) {
              if (ok) commit(function (d) {
                var nn = d.novels.find(function (x) { return x.id === n.id; });
                if (nn) nn.chapters = nn.chapters.filter(function (x) { return x.id !== cid; });
              }, { returnTo: '#/edit/novel/' + enc(n.id), toast: '已删除', message: '删除章节' });
            });
          }
        });
        $('#vol-add', main).addEventListener('click', function () {
          stt.vols.push({ id: 'v' + uid(), title: '第' + cnNum(stt.vols.length + 1) + '卷 ' });
          draw();
          var inputs = $$('[data-vname]', area);
          var last = inputs[inputs.length - 1];
          if (last) { last.focus(); last.setSelectionRange(last.value.length, last.value.length); }
        });
        $('#ch-reset', main).addEventListener('click', function () { stt = initial(); draw(); });
        $('#ch-save', main).addEventListener('click', function () {
          regroup();
          commit(function (d) {
            var nn = d.novels.find(function (x) { return x.id === n.id; });
            if (!nn) return;
            nn.volumes = stt.vols.map(function (v) { return { id: v.id, title: v.title.trim() || '未命名分卷' }; });
            nn.chapters = stt.order.map(function (o) {
              var c = nn.chapters.find(function (x) { return x.id === o.id; });
              if (c) c.vol = o.vol;
              return c;
            }).filter(Boolean).concat(nn.chapters.filter(function (c) {
              return !stt.order.some(function (o) { return o.id === c.id; });
            }));
          }, { returnTo: '#/edit/novel/' + enc(n.id), toast: '已保存章节和分卷', message: '调整章节与分卷' });
        });
      }
    };
  });
}

/* ---------- 路由 ---------- */
function parseHash() {
  return location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(function (p) {
    try { return decodeURIComponent(p); } catch (e) { return p; }
  });
}
function resolveView(p) {
  if (p[0] === 'login' || AUTH === 'no') return viewLogin();
  if (AUTH === 'pending' || !LOADED) return { html: '<div class="empty">正在读取仓库内容…</div>', nav: 'admin', bare: true, title: '写作' };
  switch (p[0]) {
    case undefined: return viewHome();
    case 'blog':
      if (p[1] === 'tag') return viewBlog({ tag: p[2] }, p[3] === 'p' ? p[4] : 1);
      if (p[1] === 'series') return viewBlog({ series: p[2] }, p[3] === 'p' ? p[4] : 1);
      return viewBlog({}, p[1] === 'p' ? p[2] : 1);
    case 'post': return viewPost(p[1]);
    case 'novels': return viewNovels(p[1] === 'p' ? p[2] : 1);
    case 'novel': return viewNovel(p[1], p[2] === 'p' ? p[3] : 1);
    case 'read': return viewRead(p[1], p[2], p[3] === 'resume');
    case 'archive': return viewArchive();
    case 'admin': return viewAdmin(p[1] || 'posts', p[2] === 'p' ? p[3] : 1);
    case 'edit':
      if (p[1] === 'post') return viewEditPost(p[2] || 'new');
      if (p[1] === 'novel') return viewEditNovel(p[2] || 'new');
      if (p[1] === 'chapter') return viewEditChapter(p[2], p[3] || 'new');
      return notFound();
    default: return notFound();
  }
}
function render(keepScroll) {
  cleanups.splice(0).forEach(function (f) { try { f(); } catch (e) {} });
  var openLb = doc.querySelector('.lightbox');
  if (openLb && openLb._close) openLb._close();
  var y = window.scrollY;
  var v = resolveView(parseHash());
  if (!v.keepStyle) applyStyle(DATA.site.style);
  app.innerHTML = navHtml(v.nav, v.progress) + '<main class="main" id="main">' + v.html + '</main>' +
    (v.bare ? '' : footHtml()) + fabHtml(v.fab);
  doc.title = v.title ? v.title + ' - ' + DATA.site.name : DATA.site.name;
  var main = doc.getElementById('main');
  $$('.prose', main).forEach(enhanceProse);
  if (v.mount) v.mount(main);
  window.scrollTo(0, keepScroll ? y : 0);
}

/* ---------- 站长身份 ---------- */
/* ---------- 连接 GitHub ---------- */
var GH_KEY = NS + 'github';
function loadGh() {
  try { var g = JSON.parse(LS.get(GH_KEY) || 'null'); return g && g.repo && g.token ? g : null; } catch (e) { return null; }
}
function viewLogin() {
  var g = GH || loadGh() || {};
  return {
    html: '<div class="login"><h1>连接 GitHub</h1><p>后台通过访问令牌把内容提交到你的 GitHub 仓库。令牌只保存在这台设备上。</p>' +
      '<label class="field"><span>仓库</span><input class="input" id="gh-repo" autocomplete="off" autocapitalize="off" placeholder="用户名/仓库名"></label>' +
      '<label class="field"><span>分支</span><input class="input" id="gh-branch" autocomplete="off" autocapitalize="off" placeholder="main"></label>' +
      '<label class="field"><span>访问令牌</span><input class="input" type="password" id="gh-token" autocomplete="off" placeholder="github_pat_…"></label>' +
      '<button type="button" class="btn primary block" id="gh-save">连接</button><p class="login-msg" id="gh-msg" aria-live="polite"></p>' +
      '<div class="token-help"><p><b>还没有令牌？</b>点下面的按钮，GitHub 会打开一个已经填好的创建页面。你只需要在「Repository access」里选「Only select repositories」并选中这个网站的仓库，然后点页面底部的「Generate token」，把生成的令牌复制回来粘贴到上面。</p>' +
      '<a class="btn block" id="gh-newtoken" target="_blank" rel="noopener">去 GitHub 创建令牌</a></div>' +
      (GH ? '<button type="button" class="btn ghost block" id="gh-forget">断开连接，删除这台设备上的令牌</button>' : '') + '</div>',
    nav: 'admin', title: '连接 GitHub', bare: true,
    mount: function (main) {
      var repo = $('#gh-repo', main), br = $('#gh-branch', main), tk = $('#gh-token', main), msg = $('#gh-msg', main), btn = $('#gh-save', main);
      repo.value = g.repo || CFG.repo || '';
      var tokenLink = $('#gh-newtoken', main);
      var updLink = function () {
        var owner = (repo.value.trim().split('/')[0] || '').replace(/[^\w.-]/g, '');
        tokenLink.href = 'https://github.com/settings/personal-access-tokens/new?name=' + encodeURIComponent('blog-admin') +
          '&description=' + encodeURIComponent('墨与码手机后台：提交文章并查看网站生成进度') +
          (owner ? '&target_name=' + encodeURIComponent(owner) : '') + '&expires_in=365&contents=write&actions=read';
      };
      updLink();
      repo.addEventListener('input', updLink);
      br.value = g.branch || CFG.branch || 'main';
      tk.value = g.token || '';
      btn.addEventListener('click', function () {
        var cfg = { repo: repo.value.trim().replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/+$/, ''), branch: br.value.trim() || 'main', token: tk.value.trim() };
        if (!/^[\w.-]+\/[\w.-]+$/.test(cfg.repo)) { msg.textContent = '仓库的格式是「用户名/仓库名」。'; return; }
        if (!cfg.token) { msg.textContent = '请填写访问令牌。'; return; }
        btn.disabled = true;
        msg.textContent = '正在连接…';
        var prev = GH;
        GH = cfg;
        gh('GET', repoPath('/branches/' + encodeURIComponent(cfg.branch))).then(function () {
          LS.set(GH_KEY, JSON.stringify(cfg));
          AUTH = 'yes';
          msg.textContent = '正在读取内容…';
          return loadContent();
        }).then(function () {
          btn.disabled = false;
          setHash('#/admin');
          render();
          toast('已连接');
        }, function (err) {
          GH = prev;
          btn.disabled = false;
          msg.textContent = err.status === 401 ? '令牌无效或已过期。' : err.status === 404 ? '找不到这个仓库或分支，或者令牌没有访问这个仓库的权限。' : '连接失败：' + err.message;
        });
      });
      var forget = $('#gh-forget', main);
      if (forget) forget.addEventListener('click', function () {
        LS.del(GH_KEY);
        GH = null; AUTH = 'no'; LOADED = false;
        DATA = normalize({});
        render();
        toast('已断开连接');
      });
    }
  };
}
function initAuth() {
  GH = loadGh();
  if (!GH) { AUTH = 'no'; if (!/^#\/login/.test(location.hash)) setHash('#/login'); render(); return; }
  AUTH = 'yes';
  loadContent().then(function () { render(); }, function (err) {
    if (err.status === 401 || err.status === 404) { AUTH = 'no'; setHash('#/login'); }
    render();
    toast(err.status === 401 ? '访问令牌已失效，请重新连接。' : '内容没有加载成功：' + err.message);
  });
}

/* ---------- 启动 ---------- */
function boot() {
  var t = doc.createElement('div');
  t.id = 'toast'; t.className = 'toast'; t.setAttribute('role', 'status'); t.setAttribute('aria-live', 'polite');
  doc.body.appendChild(t);
  var b = doc.createElement('div');
  b.id = 'busy'; b.className = 'busy';
  b.innerHTML = '<div class="busy-card"><span class="spin" aria-hidden="true"></span><span class="busy-text">正在发布…</span></div>';
  doc.body.appendChild(b);

  app.addEventListener('click', function (e) {
    var cp = e.target.closest('.code-copy');
    if (cp) {
      var code = cp.closest('.code-block').querySelector('code');
      copyText(code.innerText).then(function (ok) { toast(ok ? '已复制' : '复制失败，请长按代码手动选择。'); });
      return;
    }
    if (e.target.closest('[data-top]')) window.scrollTo({ top: 0, behavior: 'smooth' });
    var im = e.target.closest('.prose img');
    if (im && !im.closest('a')) {
      var imgs = $$('img', im.closest('.prose')).filter(function (x) { return !x.closest('a'); });
      openLightbox(imgs.map(function (x) { return { src: x.currentSrc || x.src, alt: x.getAttribute('alt') || '' }; }), imgs.indexOf(im));
    }
    if (e.target.closest('#mode-btn')) toggleMode();
  });
  window.addEventListener('hashchange', function () { render(); });
  window.addEventListener('pagehide', function () { cleanups.forEach(function (f) { try { f(); } catch (e) {} }); });

  applyStyle(DATA.site.style);
  var saved = LS.get(MODE_KEY);
  if (saved === 'dark' || saved === 'light') applyMode(saved === systemMode() ? null : saved);
  watchSystemMode();
  if (!location.hash || location.hash === '#' || location.hash === '#/') setHash('#/admin');
  render();
  initAuth();
  ensureMarkdown();
}
boot();
})();
