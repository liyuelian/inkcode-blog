/* 把「完整备份」（.json）转换成仓库里的 Markdown 文件和图片文件。
 * 用法：node scripts/import-backup.js 备份文件.json
 * 会覆盖 content/ 里同名的文件；图片写入 static/images/。 */
const fs = require('fs');
const path = require('path');
const SiteFiles = require('../admin/files.js');

const ROOT = path.join(__dirname, '..');
const file = process.argv[2];
if (!file) { console.error('用法：node scripts/import-backup.js 备份文件.json'); process.exit(1); }

let data = JSON.parse(fs.readFileSync(file, 'utf8'));
if (data.format === 'inkcode-site-backup') data = { site: data.site, posts: data.posts, novels: data.novels, images: data.images || {} };

const EXT = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif' };
const imgDir = path.join(ROOT, 'static', 'images');
fs.mkdirSync(imgDir, { recursive: true });
const imageUrl = {};
let skipped = 0;
for (const [id, src] of Object.entries(data.images || {})) {
  const m = /^data:(image\/[a-z]+);base64,(.+)$/.exec(src || '');
  if (m && EXT[m[1]] && /^[a-z0-9_-]+$/i.test(id)) {
    const name = id + '.' + EXT[m[1]];
    fs.writeFileSync(path.join(imgDir, name), Buffer.from(m[2], 'base64'));
    imageUrl[id] = '/images/' + name;
  } else skipped++;
}
const fixImages = (md) => SiteFiles.rewriteImageUrls(md, (url) => {
  const m = /^img:([A-Za-z0-9_-]+)([?#].*)?$/.exec(url);
  return m && Object.prototype.hasOwnProperty.call(imageUrl, m[1]) ? imageUrl[m[1]] + (m[2] || '') : url;
});
const s = data.site || {};
const model = {
  site: {
    name: s.name || '我的网站', tagline: s.tagline || '', bio: s.bio || '', links: s.links || [],
    seal: s.seal || '', style: s.style || 'paper', timezone: s.timezone || 'Asia/Shanghai'
  },
  posts: (data.posts || []).map((p) => ({
    id: p.id, title: p.title, tags: p.tags || [], summary: p.summary || '', series: p.series || '',
    pinned: !!p.pinned, draft: !!p.draft, created: p.created, updated: p.updated || p.created, content: fixImages(p.content)
  })),
  novels: (data.novels || []).map((n) => ({
    id: n.id, title: n.title, genre: n.genre || '', status: n.status || 'serial', tpl: n.tpl || 'thread', cover: n.cover || 'dai',
    author: n.author || '', created: n.created || (n.chapters && n.chapters[0] && n.chapters[0].created) || new Date().toISOString(),
    updated: n.updated, synopsis: n.synopsis || '', volumes: n.volumes || [],
    chapters: (n.chapters || []).map((c) => ({
      id: c.id, title: c.title, vol: c.vol || '', draft: !!c.draft, created: c.created, updated: c.updated || c.created, content: c.content
    }))
  }))
};
const files = SiteFiles.filesFromModel(model);
for (const [rel, text] of Object.entries(files)) {
  const out = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, text);
}
console.log('导入完成：' + model.posts.length + ' 篇文章，' + model.novels.length + ' 部小说，' +
  Object.keys(imageUrl).length + ' 张图片' + (skipped ? '（' + skipped + ' 张图片无法识别，已跳过）' : ''));
