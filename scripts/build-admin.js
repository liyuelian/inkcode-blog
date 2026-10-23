/* 生成手机后台：dist/admin/。
 * 后台是一个可以添加到手机桌面的网页应用，内容快照 content.json 让它打开时不用逐个读取仓库文件。 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

module.exports = function buildAdmin(o) {
  const dir = path.join(o.OUT, 'admin');
  fs.mkdirSync(dir, { recursive: true });
  const src = (f) => fs.readFileSync(path.join(o.ROOT, f), 'utf8');
  const hash = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 10);

  let site = {};
  try { site = JSON.parse(o.contentFiles['content/site.json'] || '{}'); } catch (e) { site = {}; }
  const style = ['paper', 'minimal', 'terminal'].includes(site.style) ? site.style : 'paper';
  const name = site.name || '我的网站';

  const appJs = src('admin/app.js'), filesJs = src('admin/files.js');
  const coversJs = src('theme/covers.js');
  const css = o.css + '\n' + src('theme/admin.css');
  fs.writeFileSync(path.join(dir, 'app.js'), appJs);
  fs.writeFileSync(path.join(dir, 'files.js'), filesJs);
  fs.writeFileSync(path.join(dir, 'covers.js'), coversJs);
  fs.writeFileSync(path.join(dir, 'admin.css'), css);
  for (const icon of ['icon-192.png', 'icon-512.png']) fs.copyFileSync(path.join(o.ROOT, 'admin', icon), path.join(dir, icon));

  // 内容快照：后台打开时先读这个，再补上之后的新提交
  fs.writeFileSync(path.join(dir, 'content.json'), JSON.stringify({ commit: o.commit, files: o.contentFiles }));

  fs.writeFileSync(path.join(dir, 'manifest.webmanifest'), JSON.stringify({
    name: name + ' · 写作', short_name: '写作', lang: 'zh-CN',
    start_url: o.base + '/admin/', scope: o.base + '/admin/', display: 'standalone',
    background_color: '#1f2433', theme_color: '#1f2433',
    icons: [
      { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
    ]
  }, null, 2));

  const config = { repo: o.repo, branch: o.branch, siteUrl: o.siteUrl, base: o.base, siteName: name, style };
  if (typeof site.fontBase === 'string') config.fontBase = site.fontBase;
  const appearance = o.appearance;
  const html = '<!doctype html>\n<html lang="zh-CN" data-style="' + style + '" data-default-style="' + style + '">\n<head>\n<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n' +
    '<meta name="robots" content="noindex">\n<title>写作 - ' + name.replace(/[<&"]/g, '') + '</title>\n' +
    '<link rel="manifest" href="manifest.webmanifest">\n<link rel="apple-touch-icon" href="icon-192.png">\n' +
    '<meta name="theme-color" content="#1f2433">\n<meta name="apple-mobile-web-app-capable" content="yes">\n' +
    '<meta name="mobile-web-app-capable" content="yes">\n<meta name="apple-mobile-web-app-title" content="写作">\n' +
    '<link rel="icon" href="icon-192.png">\n' +
    '<script type="application/json" id="appearance-config">' + appearance.config + '</script>\n' +
    '<script>' + appearance.modeBoot + appearance.styleBoot + '</script>\n' +
    '<link rel="stylesheet" href="admin.css?v=' + hash(css) + '">\n</head>\n<body data-base="' + o.base + '">\n<div id="app"></div>\n' +
    '<template id="appearance-template">' + appearance.picker + '</template>\n' +
    '<script>window.SITE_CONFIG=' + JSON.stringify(config).replace(/</g, '\\u003c') + ';</script>\n' +
    '<script src="' + appearance.scriptUrl + '"></script>\n' +
    '<script src="files.js?v=' + hash(filesJs) + '"></script>\n' +
    '<script src="covers.js?v=' + hash(coversJs) + '"></script>\n' +
    '<script src="app.js?v=' + hash(appJs) + '"></script>\n</body>\n</html>\n';
  fs.writeFileSync(path.join(dir, 'index.html'), html);
};
