/* 读者端脚本：日夜模式、目录与阅读进度、看图、代码块、小说阅读记录、归档热力图、搜索。
 * 页面本身由构建脚本生成，这里只负责交互，没有这个脚本页面也能正常阅读。 */
(function () {
'use strict';
var doc = document, root = doc.documentElement, body = doc.body;
var NS = 'site:';
var BASE = body.getAttribute('data-base') || '';
var cleanups = [];
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
function pad(n) { return n < 10 ? '0' + n : '' + n; }
function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
}
function fmtWords(n) { return n >= 10000 ? (n / 10000).toFixed(1).replace(/\.0$/, '') + ' 万' : String(n); }
function debounce(fn, ms) {
  var h = null;
  var f = function () { clearTimeout(h); h = setTimeout(function () { h = null; fn(); }, ms); };
  f.flush = function () { if (h) { clearTimeout(h); h = null; fn(); } };
  return f;
}
function pageData() {
  var el = doc.getElementById('page-data');
  try { return el ? JSON.parse(el.textContent) : {}; } catch (e) { return {}; }
}
function toast(msg) {
  var t = doc.getElementById('toast');
  if (!t) {
    t = doc.createElement('div');
    t.id = 'toast'; t.className = 'toast'; t.setAttribute('role', 'status'); t.setAttribute('aria-live', 'polite');
    body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._h);
  t._h = setTimeout(function () { t.classList.remove('show'); }, Math.max(2400, msg.length * 110));
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
    doc.body.appendChild(side);
    fab = doc.createElement('button');
    fab.type = 'button';
    fab.className = 'toc-fab';
    fab.setAttribute('aria-label', '打开目录');
    fab.innerHTML = LIST_ICON + '<span>目录</span>';
    doc.body.appendChild(fab);
    lists = $$('.toc-list', doc);

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


function dayKey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function writingEvents() {
  return (pageData().events || []).map(function (e) {
    var t = new Date(e.t);
    return { type: e.type, t: t, day: dayKey(t), title: e.title, novel: e.novel, href: e.href, words: e.words };
  }).filter(function (e) { return !isNaN(e.t); }).sort(function (a, b) { return b.t - a.t; });
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


/* ---------- 小说阅读记录 ---------- */
var FONT_SIZES = [15, 16, 17, 18, 19, 20, 22, 24];
function readPos(nid) {
  try { var o = JSON.parse(LS.get(NS + 'pos:' + nid) || 'null'); return o && o.cid ? o : null; } catch (e) { return null; }
}
function initNovel() {
  var nid = body.getAttribute('data-novel'), chs = pageData().chapters || [];
  var prog = LS.get(NS + 'progress:' + nid);
  var ch = chs.filter(function (c) { return c[0] === prog; })[0];
  if (!ch) return;
  var pos = readPos(nid);
  var pct = pos && pos.cid === ch[0] && pos.f > 0.03 ? Math.round(pos.f * 100) : 0;
  var p = $('#nh-prog');
  if (p) { p.hidden = false; p.textContent = '读到：' + ch[1] + (pct ? '，' + pct + '%' : ''); }
  var btn = $('#read-btn');
  if (btn) { btn.textContent = '继续阅读'; btn.href = ch[2] + '?resume=1'; }
  var li = $('.toc li[data-cid="' + ch[0] + '"]');
  if (li) li.classList.add('cur');
}
function initReader() {
  var nid = body.getAttribute('data-novel'), cid = body.getAttribute('data-chapter');
  var saved = readPos(nid);
  LS.set(NS + 'progress:' + nid, cid);
  setupReading($('.reader'), {
    onProgress: function (f) { LS.set(NS + 'pos:' + nid, JSON.stringify({ cid: cid, f: Math.round(f * 1000) / 1000 })); }
  });
  if (/[?&]resume=1/.test(location.search)) {
    try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) {}
    if (saved && saved.cid === cid && saved.f > 0.03 && saved.f < 0.98) {
      setTimeout(function () {
        var el = $('.reader'), top = navHeight(), r = el.getBoundingClientRect();
        var range = r.height - (window.innerHeight - top);
        if (range <= 0) return;
        window.scrollTo(0, Math.max(0, Math.round(r.top + window.scrollY - top + saved.f * range)));
        toast('已回到上次读到的位置');
      }, 80);
    }
  }
  var cb = $('#cbody');
  var idx = parseInt(LS.get(NS + 'fs') || '3', 10);
  if (!(idx >= 0 && idx < FONT_SIZES.length)) idx = 3;
  var apply = function () { cb.style.setProperty('--read-size', FONT_SIZES[idx] + 'px'); };
  apply();
  $('.fs-ctl').addEventListener('click', function (e) {
    var b = e.target.closest('[data-fs]');
    if (!b) return;
    idx = Math.max(0, Math.min(FONT_SIZES.length - 1, idx + parseInt(b.getAttribute('data-fs'), 10)));
    LS.set(NS + 'fs', String(idx));
    apply();
  });
}

/* ---------- 搜索 ---------- */
function initSearch() {
  var input = $('#q'), list = $('#s-list'), note = $('#s-note');
  var idx = null;
  var q = new URLSearchParams(location.search).get('q') || '';
  input.value = q;
  var label = { post: '文章', novel: '小说', chapter: '章节' };
  var snippet = function (text, k) {
    var i = text.toLowerCase().indexOf(k);
    if (i < 0) return escHtml(text.slice(0, 80)) + (text.length > 80 ? '…' : '');
    var s = Math.max(0, i - 30), e = Math.min(text.length, i + k.length + 50);
    return (s > 0 ? '…' : '') + escHtml(text.slice(s, i)) + '<mark>' + escHtml(text.slice(i, i + k.length)) + '</mark>' +
      escHtml(text.slice(i + k.length, e)) + (e < text.length ? '…' : '');
  };
  var draw = function () {
    var k = input.value.trim().toLowerCase();
    try { history.replaceState(null, '', location.pathname + (k ? '?q=' + encodeURIComponent(input.value.trim()) : '')); } catch (e) {}
    if (!idx) return;
    if (!k) { note.textContent = ''; list.innerHTML = ''; return; }
    var res = idx.filter(function (it) {
      return (it.title + ' ' + (it.novel || '') + ' ' + (it.tags || []).join(' ') + ' ' + (it.text || '')).toLowerCase().indexOf(k) >= 0;
    });
    note.textContent = res.length ? '找到 ' + res.length + ' 条' + (res.length > 50 ? '，显示前 50 条' : '') : '没有找到，换个关键词试试。';
    list.innerHTML = res.slice(0, 50).map(function (it) {
      var d = new Date(it.date);
      return '<a class="post-item" href="' + it.url + '"><h3><span class="s-type">' + label[it.type] + '</span>' +
        (it.novel ? '《' + escHtml(it.novel) + '》' : '') + escHtml(it.title) + '</h3><p class="pi-sum">' + snippet(it.text || '', k) + '</p>' +
        '<div class="pi-meta">' + (isNaN(d) ? '' : '<time>' + d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '</time>') +
        (it.tags || []).map(function (t) { return '<span class="tg">#' + escHtml(t) + '</span>'; }).join('') + '</div></a>';
    }).join('');
  };
  input.form.addEventListener('submit', function (e) { e.preventDefault(); draw(); });
  input.addEventListener('input', debounce(draw, 200));
  note.textContent = '正在载入…';
  fetch(body.getAttribute('data-index')).then(function (r) { return r.json(); }).then(function (j) {
    idx = j;
    note.textContent = '';
    draw();
    if (!q) input.focus();
  }, function () { note.textContent = '搜索索引没有加载成功，刷新页面再试一次。'; });
}

/* ---------- 旧网址跳转（以前的 #/post/xxx 形式） ---------- */
function redirectOldHash() {
  var h = location.hash;
  if (!/^#\//.test(h)) return;
  var p = h.slice(2).split('/').filter(Boolean).map(function (x) { try { return decodeURIComponent(x); } catch (e) { return x; } });
  var to = p[0] === 'post' && p[1] ? '/posts/' + p[1] + '/'
    : p[0] === 'novel' && p[1] ? '/novels/' + p[1] + '/'
    : p[0] === 'read' && p[2] ? '/novels/' + p[1] + '/' + p[2] + '/'
    : p[0] === 'blog' ? '/blog/' : p[0] === 'novels' ? '/novels/' : p[0] === 'archive' ? '/archive/'
    : /^(admin|edit|login)$/.test(p[0] || '') ? '/admin/' : null;
  if (to) location.replace(BASE + to);
}

/* ---------- 启动 ---------- */
function init() {
  if (window.SiteAppearance) window.SiteAppearance.mount({ toast: toast });
  doc.addEventListener('click', function (e) {
    var t = e.target;
    var cp = t.closest('.code-copy');
    if (cp) {
      copyText(cp.closest('.code-block').querySelector('code').innerText).then(function (ok) { toast(ok ? '已复制' : '复制失败，请长按代码手动选择。'); });
      return;
    }
    var more = t.closest('.code-more');
    if (more) {
      var box = more.closest('.code-block'), folded = box.classList.toggle('folded');
      more.textContent = folded ? '展开全部 ' + more.getAttribute('data-lines') + ' 行' : '收起';
      if (folded) { var top = box.getBoundingClientRect().top; if (top < 0) window.scrollBy(0, top - navHeight() - 12); }
      return;
    }
    var chipMore = t.closest('[data-more]');
    if (chipMore) {
      var open = chipMore.parentNode.classList.toggle('open');
      chipMore.textContent = open ? '收起' : '全部 ' + ($$('.chip', chipMore.parentNode).length - 2) + ' 个标签';
      return;
    }
    if (t.closest('[data-top]')) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    var im = t.closest('.prose img');
    if (im && !im.closest('a')) {
      var imgs = $$('img', im.closest('.prose')).filter(function (x) { return !x.closest('a'); });
      openLightbox(imgs.map(function (x) { return { src: x.currentSrc || x.src, alt: x.getAttribute('alt') || '' }; }), imgs.indexOf(im));
    }
  });
  var page = body.getAttribute('data-page');
  if (page === 'home') redirectOldHash();
  if (page === 'post') setupReading($('.article'), { toc: true });
  if (page === 'novel') initNovel();
  if (page === 'read') initReader();
  if (page === 'archive') viewArchive().mount(doc.getElementById('main'));
  if (page === 'search') initSearch();
}
init();
})();
