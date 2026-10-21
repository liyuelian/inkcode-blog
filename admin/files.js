/* 网站内容与仓库文件之间的转换。构建脚本（Node.js）和手机后台（浏览器）共用这一份代码。
 *
 * content/site.json                         网站设置
 * content/posts/<id>.md                     文章
 * content/novels/<id>/novel.md              小说信息，正文部分是简介
 * content/novels/<id>/chapters/<id>.md      章节
 *
 * 文件开头的 --- 之间是元数据，每行「键: 值」，值用 JSON 写法（也是合法的 YAML）。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SiteFiles = factory();
})(this, function () {
  'use strict';

  function parseValue(v) {
    if (v === '') return '';
    if (/^["[{]/.test(v)) { try { return JSON.parse(v); } catch (e) { /* 按普通文字处理 */ } }
    if (v === 'true') return true;
    if (v === 'false') return false;
    if (v === 'null' || v === '~') return null;
    if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
    if (/^'.*'$/.test(v)) return v.slice(1, -1).replace(/''/g, "'");
    return v;
  }
  function parse(text) {
    text = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    var m = /^---\n([\s\S]*?)\n---[ \t]*(\n|$)/.exec(text);
    if (!m) return { meta: {}, body: text };
    var meta = {};
    m[1].split('\n').forEach(function (line) {
      if (!line.trim() || /^\s|^#/.test(line)) return;
      var i = line.indexOf(':');
      if (i <= 0) return;
      meta[line.slice(0, i).trim()] = parseValue(line.slice(i + 1).trim());
    });
    return { meta: meta, body: text.slice(m[0].length).replace(/^\n+/, '') };
  }
  function stringify(meta, body) {
    var lines = Object.keys(meta).filter(function (k) { return meta[k] !== undefined && meta[k] !== null; })
      .map(function (k) { return k + ': ' + JSON.stringify(meta[k]); });
    return '---\n' + lines.join('\n') + '\n---\n\n' + String(body || '').replace(/\s+$/, '') + '\n';
  }

  var ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/;
  function arr(v) { return Array.isArray(v) ? v : (typeof v === 'string' && v ? [v] : []); }
  function str(v) { return v == null ? '' : String(v); }

  function modelFromFiles(files) {
    var site = {};
    try { site = JSON.parse(files['content/site.json'] || '{}'); } catch (e) { site = {}; }
    var posts = [], novels = {}, chapters = {};
    Object.keys(files).forEach(function (path) {
      var m;
      if ((m = /^content\/posts\/([^/]+)\.md$/.exec(path)) && ID.test(m[1])) {
        var p = parse(files[path]), x = p.meta;
        posts.push({
          id: m[1], title: str(x.title) || m[1], tags: arr(x.tags).map(str), summary: str(x.summary),
          series: str(x.series), pinned: x.pinned === true, draft: x.draft === true,
          created: str(x.date), updated: str(x.updated || x.date), content: p.body
        });
      } else if ((m = /^content\/novels\/([^/]+)\/novel\.md$/.exec(path)) && ID.test(m[1])) {
        var n = parse(files[path]), y = n.meta;
        novels[m[1]] = {
          id: m[1], title: str(y.title) || m[1], genre: str(y.genre), status: y.status === 'done' ? 'done' : 'serial',
          tpl: str(y.template), cover: str(y.cover), author: str(y.author), created: str(y.created), updated: str(y.updated || y.created),
          volumes: arr(y.volumes).filter(function (v) { return v && v.id; }).map(function (v) { return { id: str(v.id), title: str(v.title) }; }),
          order: arr(y.chapters).map(str), synopsis: n.body.replace(/\s+$/, ''), chapters: []
        };
      } else if ((m = /^content\/novels\/([^/]+)\/chapters\/([^/]+)\.md$/.exec(path)) && ID.test(m[2])) {
        var c = parse(files[path]), z = c.meta;
        (chapters[m[1]] = chapters[m[1]] || []).push({
          id: m[2], title: str(z.title) || m[2], vol: str(z.volume), draft: z.draft === true,
          created: str(z.date), updated: str(z.updated || z.date), content: c.body.replace(/\s+$/, '')
        });
      }
    });
    var list = Object.keys(novels).map(function (id) {
      var n = novels[id], chs = chapters[id] || [];
      var pos = {};
      n.order.forEach(function (cid, i) { pos[cid] = i; });
      n.chapters = chs.sort(function (a, b) {
        var pa = cid(pos, a.id), pb = cid(pos, b.id);
        return pa - pb || (a.created < b.created ? -1 : a.created > b.created ? 1 : 0);
      });
      delete n.order;
      return n;
    }).sort(function (a, b) {           // 最近更新的作品排在前面
      var ua = a.updated || a.created, ub = b.updated || b.created;
      return ua < ub ? 1 : ua > ub ? -1 : 0;
    });
    return { site: site, posts: posts, novels: list, images: {} };
  }
  function cid(pos, id) { return Object.prototype.hasOwnProperty.call(pos, id) ? pos[id] : 1e9; }

  function filesFromModel(model) {
    var files = {};
    files['content/site.json'] = JSON.stringify(model.site || {}, null, 2) + '\n';
    (model.posts || []).forEach(function (p) {
      files['content/posts/' + p.id + '.md'] = stringify({
        title: p.title, date: p.created, updated: p.updated && p.updated !== p.created ? p.updated : undefined,
        tags: p.tags && p.tags.length ? p.tags : undefined, summary: p.summary || undefined,
        series: p.series || undefined, pinned: p.pinned ? true : undefined, draft: p.draft ? true : undefined
      }, p.content);
    });
    (model.novels || []).forEach(function (n) {
      var base = 'content/novels/' + n.id + '/';
      files[base + 'novel.md'] = stringify({
        title: n.title, genre: n.genre || undefined, status: n.status, template: n.tpl, cover: n.cover,
        author: n.author || undefined, created: n.created, updated: n.updated && n.updated !== n.created ? n.updated : undefined,
        volumes: n.volumes && n.volumes.length ? n.volumes : undefined,
        chapters: (n.chapters || []).map(function (c) { return c.id; })
      }, n.synopsis);
      (n.chapters || []).forEach(function (c) {
        files[base + 'chapters/' + c.id + '.md'] = stringify({
          title: c.title, date: c.created, updated: c.updated && c.updated !== c.created ? c.updated : undefined,
          volume: c.vol || undefined, draft: c.draft ? true : undefined
        }, c.content);
      });
    });
    return files;
  }

  /* 只改图片目的地址，保留 Markdown 的标题、引用定义和 HTML 属性。
   * 代码示例不参与备份；同一函数用于导出、恢复和命令行导入。 */
  function rewriteImageUrls(markdown, change) {
    var text = String(markdown || ''), edits = [], protectedText = text.split('');
    function mask(start, end) { for (var i = start; i < end; i++) if (protectedText[i] !== '\n') protectedText[i] = ' '; }
    // 围栏代码先屏蔽，再处理行内代码；保持原始字符位置不变。
    var lines = /[^\n]*(?:\n|$)/g, line, fence = null, start = 0;
    while ((line = lines.exec(text)) && line[0]) {
      var f = /^ {0,3}(`{3,}|~{3,})(.*)/.exec(line[0]);
      if (!fence && f) { fence = f[1]; start = line.index; }
      else if (fence && f && f[1][0] === fence[0] && f[1].length >= fence.length && !f[2].trim()) {
        mask(start, lines.lastIndex); fence = null;
      }
    }
    if (fence) mask(start, text.length);
    var visible = protectedText.join('');
    var code = /<!--[^]*?-->|<(pre|code)\b[^>]*>[^]*?<\/\1\s*>|(`+)([^]*?)\2(?!`)/gi, m;
    while ((m = code.exec(visible))) mask(m.index, code.lastIndex);
    visible = protectedText.join('');
    function replaceAt(start, raw, kind) {
      var next = change(raw, kind);
      if (typeof next === 'string' && next !== raw) edits.push({ start: start, end: start + raw.length, value: next });
    }
    var htmlVisible = visible;
    visible = visible.replace(/<(?:img|source)\b(?=[\s/>])(?:[^<>"']|"[^"]*"|'[^']*')*>/gi, function (tag) { return tag.replace(/[^\n]/g, ' '); });
    var label = function (s) { return s.replace(/\\([\[\]\\])/g, '$1').replace(/\s+/g, ' ').trim().toLowerCase(); };
    // 目的地址支持 <尖括号>、空白、可选标题，及文件名中的转义字符。
    var destination = '(?:<([^>\\n]*)>|((?:\\\\.|[^\\s()\\\\]|\\([^\\n)]*\\))*))';
    var alt = '((?:\\\\.|[^\\[\\]\\\\]|\\[[^\\]]*\\])*)';
    var inline = new RegExp('!\\[' + alt + '\\]\\(\\s*' + destination, 'g');
    while ((m = inline.exec(visible))) {
      if ((/\\+$/.exec(visible.slice(0, m.index)) || [''])[0].length % 2) continue;
      var raw = m[2] !== undefined ? m[2] : m[3];
      replaceAt(m.index + m[0].lastIndexOf(raw), text.slice(m.index + m[0].lastIndexOf(raw), m.index + m[0].lastIndexOf(raw) + raw.length), 'markdown');
    }
    var refs = Object.create(null), ref = new RegExp('!\\[' + alt + '\\](?!\\()(?:[ \\t]*\\[([^\\]]*)\\])?', 'g');
    while ((m = ref.exec(visible))) {
      if (!((/\\+$/.exec(visible.slice(0, m.index)) || [''])[0].length % 2)) refs[label(m[2] || m[1])] = true;
    }
    var definition = new RegExp('^ {0,3}\\[([^\\]\\n]+)\\]:[ \\t]*(?:\\n[ \\t]*)?' + destination, 'gm');
    while ((m = definition.exec(visible))) {
      if (!refs[label(m[1])]) continue;
      var raw = m[2] !== undefined ? m[2] : m[3], at = m.index + m[0].lastIndexOf(raw);
      replaceAt(at, text.slice(at, at + raw.length), 'markdown');
    }
    var tag = /<(?:img|source)\b(?=[\s/>])(?:[^<>"']|"[^"]*"|'[^']*')*>/gi;
    while ((m = tag.exec(htmlVisible))) {
      var html = text.slice(m.index, tag.lastIndex), attr = /\s(src|srcset)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s<>"'`=]+))/gi, a;
      while ((a = attr.exec(html))) {
        var raw = a[2] !== undefined ? a[2] : a[3] !== undefined ? a[3] : a[4];
        var at = m.index + a.index + a[0].indexOf('=') + 1;
        while (/\s/.test(text[at])) at++;
        if (text[at] === '"' || text[at] === "'") at++;
        if (a[1].toLowerCase() === 'src') replaceAt(at, raw, 'html');
        else {
          // srcset 的每个候选地址独立转换，保留像素密度/宽度描述。
          var candidate = /(?:^|,)\s*([^\s,]+)/g, c;
          while ((c = candidate.exec(raw))) replaceAt(at + c.index + c[0].lastIndexOf(c[1]), c[1], 'html');
        }
      }
    }
    edits.sort(function (a, b) { return b.start - a.start; }).forEach(function (e) {
      text = text.slice(0, e.start) + e.value + text.slice(e.end);
    });
    return text;
  }

  function isContentPath(p) { return p === 'content/site.json' || /^content\/(posts|novels)\/.+\.(md|json)$/.test(p); }

  /* 保守检查：正文、草稿、设置中提到文件名就保留，也识别编码网址和旧版 img:编号。 */
  function unusedImagePaths(paths, files, extraText) {
    var text = Object.keys(files).map(function (p) { return String(files[p] || ''); }).join('\n') + '\n' + (extraText || '');
    text = text.replace(/%(?:[0-9a-f]{2})(?:%[0-9a-f]{2})*/gi, function (s) {
      try { return decodeURIComponent(s); } catch (e) { return s; }
    }).replace(/&#(x[0-9a-f]+|\d+);/gi, function (all, code) {
      var n = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : parseInt(code, 10);
      return n <= 0x10ffff ? String.fromCodePoint(n) : all;
    });
    var lowerText = text.toLowerCase();
    return paths.filter(function (p) {
      var m = /^static\/images\/([A-Za-z0-9_-]+)\.(webp|jpe?g|png|gif)$/i.exec(p);
      if (!m) return false;
      var name = p.slice('static/images/'.length);
      return text.indexOf(name) < 0 && lowerText.indexOf('img:' + m[1].toLowerCase()) < 0;
    });
  }

  return { rewriteImageUrls: rewriteImageUrls, parse: parse, stringify: stringify, modelFromFiles: modelFromFiles, filesFromModel: filesFromModel, isContentPath: isContentPath, unusedImagePaths: unusedImagePaths, ID: ID };
});
