const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const SiteFiles = require('../admin/files.js');
const source = fs.readFileSync(path.join(__dirname, '../admin/app.js'), 'utf8');
const png = 'data:image/png;base64,AQID';
const example = [
  '![普通](/images/normal.png)',
  '![标题](/images/titled.png "带标题")',
  "![尖括号](</images/angled.png> '单引号标题')",
  '![转义括号\\]](/images/escaped.png)',
  '![引用][ My Photo ]',
  '[my photo]: </images/reference.png> "引用标题"',
  '![简写][]\n\n[简写]: /images/collapsed.png',
  '![快捷]\n\n[快捷]: /images/shortcut.png',
  '<IMG SRC="/images/html.png" alt="照片 > 图片" title="HTML 标题">',
  "<img src='/images/single.png'>", '<img src=/images/bare.png>',
  '<picture><source srcset="/images/small.png 1x, /images/large.png 2x"><img src="/images/normal.png"></picture>',
  '![同名 PNG](/images/shared.png)\n![同名 JPG](/images/shared.jpg)',
  '![查询](/images/normal.png?size=2#view)',
  '<img src="/images/entity&#46;png">',
  '![路径前缀](/inkcode-blog/images/prefix.png)',
  '![外链](https://example.com/images/outside.png "保持外链")',
  '`![代码](/images/no-inline.png)`',
  '```md\n![代码](/images/no-fence.png)\n```',
  '<!-- <img src="/images/no-comment.png"> -->',
  '[未使用]: /images/no-unused.png'
].join('\n\n');
function extract(first, last) {
  const a = source.indexOf(first), b = source.indexOf(last, a);
  assert.ok(a >= 0 && b > a); return source.slice(a, b);
}
function context(content = example) {
  const model = { site: { name: '备份测试' }, posts: [{ id: 'post', title: '测试', created: '2026-01-01', tags: [], content }], novels: [], images: {} };
  const reads = [];
  const ctx = { SiteFiles, DATA: model, CFG: { base: '/inkcode-blog' }, LOCAL_IMAGES: {}, PENDING_IMAGES: {}, clone: structuredClone,
    atob, Uint8Array, Blob, AbortController, setTimeout, clearTimeout, BACKUP_FORMAT: 'inkcode-site-backup',
    nowISO: () => '2026-01-01T00:00:00Z', pad: n => String(n).padStart(2, '0'),
    FileReader: class { readAsDataURL(blob) { blob.arrayBuffer().then(b => { this.result = 'data:' + blob.type + ';base64,' + Buffer.from(b).toString('base64'); this.onload(); }); } },
    fetch: async url => { reads.push(url); return { ok: true, blob: async () => new Blob([Uint8Array.from([1, 2, 3])], { type: /\.jpg$/.test(url) ? 'image/jpeg' : 'image/png' }) }; }
  };
  vm.createContext(ctx);
  vm.runInContext(extract('function resolveImg(', 'function setupMarked(') + extract('function ymd(', 'function fmtSize(') + extract('function dataUriBytes(', 'function readBackupFile('), ctx);
  return { ctx, reads };
}
class MemoryZip {
  constructor() { this.files = {}; }
  file(name, content) { this.files[name] = content; }
  generateAsync() { return Promise.resolve(this.files); }
}

test('识别所有目标图片写法，保留标题/语法，不碰外链、代码、注释和未使用的定义', () => {
  const { ctx } = context(), before = JSON.stringify(ctx.DATA);
  const d = ctx.portableData();
  assert.equal(Object.keys(d.images).length, 16);
  for (const name of ['normal', 'titled', 'angled', 'escaped', 'reference', 'collapsed', 'shortcut', 'html', 'single', 'bare', 'small', 'large', 'entity', 'prefix']) {
    assert.ok(Object.values(d.images).includes('/images/' + name + '.png'), name);
  }
  assert.ok(Object.values(d.images).includes('/images/shared.jpg'));
  assert.ok(Object.values(d.images).includes('/images/shared.png'));
  const md = d.posts[0].content;
  assert.match(md, /\[my photo\]: <img:reference> "引用标题"/);
  assert.match(md, /\(img:titled "带标题"\)/);
  assert.match(md, /SRC="img:html" alt="照片 > 图片" title="HTML 标题"/);
  assert.match(md, /img:normal\?size=2#view/);
  for (const unchanged of ['https://example.com/images/outside.png', '![代码](/images/no-inline.png)', '/images/no-fence.png', '/images/no-comment.png', '[未使用]: /images/no-unused.png']) assert.ok(md.includes(unchanged));
  assert.equal(JSON.stringify(ctx.DATA), before);
});

test('JSON 包含每张图片的完整数据，同一文件重复引用只读取一次，同名不同扩展名不覆盖', async () => {
  const { ctx, reads } = context();
  const backup = JSON.parse(await ctx.portableBackup());
  assert.equal(Object.keys(backup.images).length, 16);
  assert.equal(reads.length, 16);
  assert.equal(reads.filter(url => url.endsWith('/normal.png')).length, 1);
  assert.ok(Object.values(backup.images).every(v => v.endsWith('AQID')));
  assert.equal(backup.images.shared, png);
  assert.equal(backup.images['shared-2'], 'data:image/jpeg;base64,AQID');
});

test('ZIP 为标准图片、引用定义、HTML src/srcset 生成存在的相对路径', async () => {
  const { ctx } = context();
  const files = await ctx.buildMarkdownZip(MemoryZip);
  const md = files[Object.keys(files).find(p => p.startsWith('文章/'))];
  const paths = [];
  SiteFiles.rewriteImageUrls(md, url => { if (url.startsWith('../图片/')) paths.push(url.split(/[?#]/)[0].slice(3)); return url; });
  assert.equal(paths.length, 18);
  for (const file of paths) assert.ok(files[file], file);
  assert.match(md, /\[my photo\]: <\.\.\/图片\/reference.png> "引用标题"/);
  assert.match(md, /srcset="\.\.\/图片\/small.png 1x, \.\.\/图片\/large.png 2x"/);
});

test('任何新增写法中的图片读取失败，JSON 和 ZIP 均拒绝生成', async () => {
  for (const build of [c => c.portableBackup(), c => c.buildMarkdownZip(MemoryZip)]) {
    const { ctx } = context();
    ctx.fetch = async url => ({ ok: !url.endsWith('/reference.png'), status: 404, blob: async () => new Blob(['png']) });
    await assert.rejects(build(ctx), e => e.code === 'backup-images' && e.message.includes('reference.png'));
  }
});

test('保留并导出旧格式内嵌图片，不与同名服务器图片冲突', async () => {
  const { ctx, reads } = context('![旧图](img:photo "标题")\n<img src="/images/photo.png">');
  ctx.DATA.images = { photo: png };
  const backup = JSON.parse(await ctx.portableBackup());
  assert.equal(backup.images.photo, png);
  assert.equal(backup.images['photo-2'], png);
  assert.equal(reads.length, 1);
});

test('后台恢复通过所有语法写回图片文件与正确网址，不调用真实 GitHub', async () => {
  const { ctx } = context();
  const data = JSON.parse(await ctx.portableBackup());
  ctx.DATA = { site: { name: '原站' }, posts: [], novels: [], images: {} };
  Object.assign(ctx, { AUTH: 'yes', busyNow: false, EXT: { 'image/png': 'png', 'image/jpeg': 'jpg' }, FILES: {},
    flushFormDrafts() {}, busy() {}, render() {}, toast() {}, watchBuild() {}, normalize: x => x,
    publishError: err => { throw err; } });
  let uploaded;
  ctx.ghCommit = async (changes, binaries) => { uploaded = { changes, binaries }; return { upstream: [], removedImages: [], sha: 'mock' }; };
  vm.runInContext(extract('function commit(', '/* 提交之后跟踪'), ctx);
  ctx.commit(d => Object.assign(d, structuredClone(data)), {});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(Object.keys(uploaded.binaries).length, 16);
  const md = SiteFiles.parse(uploaded.changes['content/posts/post.md']).body;
  const refs = [];
  SiteFiles.rewriteImageUrls(md, url => { if (url.startsWith('/images/')) refs.push(url.split(/[?#]/)[0]); return url; });
  assert.equal(refs.length, 18);
  for (const ref of refs) assert.equal(uploaded.binaries['static' + ref], 'AQID');
  assert.match(md, /\[my photo\]: <\/images\/reference.png> "引用标题"/);
});

test('命令行恢复也写回完整图片，支持带连字符和下划线的旧编号', async () => {
  const { ctx } = context(example + '\n![旧图](img:Legacy-ID_7 "旧标题")');
  ctx.DATA.images = { 'Legacy-ID_7': png };
  const json = await ctx.portableBackup();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkcode-import-test-'));
  try {
    for (const folder of ['admin', 'scripts']) fs.mkdirSync(path.join(dir, folder));
    fs.copyFileSync(path.join(__dirname, '../admin/files.js'), path.join(dir, 'admin/files.js'));
    fs.copyFileSync(path.join(__dirname, '../scripts/import-backup.js'), path.join(dir, 'scripts/import-backup.js'));
    fs.writeFileSync(path.join(dir, 'backup.json'), json);
    execFileSync(process.execPath, [path.join(dir, 'scripts/import-backup.js'), path.join(dir, 'backup.json')]);
    const md = SiteFiles.parse(fs.readFileSync(path.join(dir, 'content/posts/post.md'), 'utf8')).body;
    SiteFiles.rewriteImageUrls(md, url => {
      if (url.startsWith('/images/')) assert.deepEqual(fs.readFileSync(path.join(dir, 'static', url.split(/[?#]/)[0])), Buffer.from([1, 2, 3]));
      return url;
    });
    assert.ok(md.includes('/images/Legacy-ID_7.png "旧标题"'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('失去内嵌数据的旧图片阻止导出，不下载空地址或产生缺图备份', async () => {
  const { ctx, reads } = context('<img src="img:missing">');
  assert.equal(Object.keys(ctx.portableData().images).length, 1);
  await assert.rejects(ctx.portableBackup(), e => e.code === 'backup-images' && e.message.includes('missing'));
  await assert.rejects(ctx.buildMarkdownZip(MemoryZip), e => e.code === 'backup-images');
  assert.deepEqual(reads, []);
});

test('本站完整网址纳入备份，第三方完整网址保留', () => {
  const { ctx } = context('![本站](https://owner.github.io/inkcode-blog/images/photo.png)\n![外站](https://other.test/images/photo.png)');
  ctx.CFG.siteUrl = 'https://owner.github.io/inkcode-blog';
  const d = ctx.portableData();
  assert.deepEqual(Object.keys(d.images), ['photo']);
  assert.match(d.posts[0].content, /https:\/\/other.test\/images\/photo.png/);
});

test('HTML 属性里的 Markdown 示例、转义感叹号和更长围栏内的短围栏不会造成误改', () => {
  const md = '<img alt="![示例](/images/example.png)" src="/images/real.png">\n\\![正文](/images/escaped.png)\n\n````\n```\n![代码](/images/code.png)\n````';
  const found = [];
  const next = SiteFiles.rewriteImageUrls(md, url => { found.push(url); return 'img:test'; });
  assert.deepEqual(found, ['/images/real.png']);
  assert.ok(next.includes('alt="![示例](/images/example.png)"'));
});
