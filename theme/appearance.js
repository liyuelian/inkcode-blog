/* 前台与写作后台共用的本机外观偏好；切换时不重建页面内容。 */
(function () {
'use strict';
var doc = document, root = doc.documentElement;
var NS = 'site:', BASE = doc.body.getAttribute('data-base') || '';
function store() {
  var s = null;
  try { s = window.localStorage; s.setItem('__t', '1'); s.removeItem('__t'); } catch (e) { s = null; }
  return {
    get: function (k) { try { return s ? s.getItem(k) : null; } catch (e) { return null; } },
    set: function (k, v) { try { if (s) { s.setItem(k, v); return true; } } catch (e) {} return false; },
    del: function (k) { try { if (s) { s.removeItem(k); return true; } } catch (e) {} return false; }
  };
}
var LS = store();
var $ = function (s, r) { return (r || doc).querySelector(s); };
var $$ = function (s, r) { return Array.prototype.slice.call((r || doc).querySelectorAll(s)); };
/* ---------- 访客主题：只保存本浏览器的选择，不改网站发布设置 ---------- */
var STYLE_NAMES = { paper: '书卷纸墨', minimal: '极简留白', terminal: '暗夜终端' };
var APPEARANCE = (function () {
  try { return JSON.parse(doc.getElementById('appearance-config').textContent); } catch (e) { return {}; }
})();
var transientStyle = null;
var STYLE_KEY = APPEARANCE.storageKey || NS + 'style:' + (BASE || '/');
function isStyle(k) { return Object.prototype.hasOwnProperty.call(STYLE_NAMES, k); }
function defaultStyle() {
  var fallback = root.getAttribute('data-default-style') || APPEARANCE.defaultStyle;
  return isStyle(fallback) ? fallback : 'paper';
}
function preferredStyle() {
  var saved = transientStyle || LS.get(STYLE_KEY);
  return isStyle(saved) ? saved : defaultStyle();
}
function applyVisitorStyle(choice) {
  var style = isStyle(choice) ? choice : defaultStyle();
  root.setAttribute('data-style', style);
  var href = APPEARANCE.fonts && APPEARANCE.fonts[style];
  if (href) {
    var link = doc.getElementById('font-link');
    if (!link) { link = doc.createElement('link'); link.id = 'font-link'; link.rel = 'stylesheet'; doc.head.appendChild(link); }
    if (link.getAttribute('href') !== href) link.setAttribute('href', href);
  }
  $$('#style-switch input[name="visitor-style"]').forEach(function (input) {
    input.checked = input.value === style;
    input.closest('label').classList.toggle('selected', input.checked);
  });
  // 字体、间距及导航高度变化后，重新计算阅读进度和目录位置。
  window.dispatchEvent(new Event('resize'));
  return style;
}
function chooseVisitorStyle(choice) {
  if (!isStyle(choice)) return;
  var saved = LS.set(STYLE_KEY, choice);
  transientStyle = saved ? null : choice;
  var style = applyVisitorStyle(choice);
  toast('已切换为' + STYLE_NAMES[style] +
    (saved ? '。' : '。当前浏览器无法记住选择。'));
}
var MODE_KEY = NS + 'mode';
function systemMode() {
  var t = root.getAttribute('data-theme');
  if (t === 'dark' || t === 'light') return t;
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
function preferredMode() {
  var mode = LS.get(MODE_KEY);
  var current = root.getAttribute('data-mode');
  return mode === 'light' || mode === 'dark' ? mode : (current === 'light' || current === 'dark' ? current : systemMode());
}
function applyMode(m) {
  root.setAttribute('data-mode', m === 'dark' || m === 'light' ? m : preferredMode());
  updateModeOptions();
}
function updateModeOptions() {
  var mode = root.getAttribute('data-mode');
  $$('#style-switch input[name="visitor-mode"]').forEach(function (input) {
    input.checked = input.value === mode;
    input.closest('label').classList.toggle('selected', input.checked);
  });
}
var modeAnimTimer = null;
function chooseMode(next) {
  if (next !== 'light' && next !== 'dark') return;
  root.classList.add('mode-anim');
  clearTimeout(modeAnimTimer);
  modeAnimTimer = setTimeout(function () { root.classList.remove('mode-anim'); }, 500);
  var saved = LS.set(MODE_KEY, next);
  applyMode(next);
  toast('已切换到' + (next === 'dark' ? '夜间' : '日间') + '模式' +
    (saved ? '。' : '。当前浏览器无法记住选择。'));
}


/* ---------- 页面挂载 ---------- */
var mounted = false, notify = function () {};
function toast(message) { notify(message); }
function mount(options) {
  options = options || {};
  if (typeof options.toast === 'function') notify = options.toast;
  if (isStyle(options.defaultStyle)) root.setAttribute('data-default-style', options.defaultStyle);
  applyVisitorStyle(preferredStyle());
  var mode = preferredMode();
  applyMode(mode);
  if (LS.get(MODE_KEY) !== mode) LS.set(MODE_KEY, mode);
  var picker = doc.getElementById('style-switch');
  if (picker) picker.hidden = false;
  if (mounted) return;
  mounted = true;
  // 后台切换页面会替换导航，委托给 document 可复用新菜单，且不重复绑定。
  doc.addEventListener('change', function (e) {
    if (!e.target.closest('#style-switch')) return;
    if (e.target.matches('input[name="visitor-style"]')) chooseVisitorStyle(e.target.value);
    if (e.target.matches('input[name="visitor-mode"]')) chooseMode(e.target.value);
  });
  doc.addEventListener('click', function (e) {
    var picker = doc.getElementById('style-switch');
    if (picker && !picker.contains(e.target)) picker.open = false;
  });
  doc.addEventListener('keydown', function (e) {
    var picker = doc.getElementById('style-switch');
    if (e.key === 'Escape' && picker && picker.open) {
      e.preventDefault(); picker.open = false; $('summary', picker).focus();
    }
  });
  window.addEventListener('storage', function (e) {
    if (e.key === STYLE_KEY || e.key === null) { transientStyle = null; applyVisitorStyle(preferredStyle()); }
    if (e.key === MODE_KEY || e.key === null) applyMode(preferredMode());
  });
}
window.SiteAppearance = { mount: mount };
})();
