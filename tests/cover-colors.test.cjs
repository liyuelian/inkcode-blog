const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const Covers = require('../theme/covers');
const Files = require('../admin/files');
const root = path.join(__dirname, '..');

test('任意六位颜色可用于所有封面，深浅文字有对应对比，非法值不能注入样式', () => {
  for (const tpl of Object.keys(Covers.templates)) {
    const html = Covers.html({ title: '颜色验证', tpl, cover: '#A1B2C3' });
    assert.ok(html.includes('cv-custom')); assert.ok(html.includes('--cv:#a1b2c3;'));
  }
  for (const [cover, foreground] of [['#ffffff', '#000000'], ['#000000', '#ffffff']]) {
    assert.ok(Covers.html({ tpl: 'poster', cover }).includes('--cv-fg:' + foreground + ';'));
  }
  for (const cover of ['#fff', '#12345678', '#gggggg', '#123456;background:red', '" onmouseover="alert(1)', '__proto__', 'constructor']) {
    assert.equal(Covers.colorKey(cover), 'dai');
    const html = Covers.html({ tpl: 'poster', cover });
    assert.ok(!html.includes('cv-custom')); assert.ok(!html.includes(cover));
  }
  assert.equal(Covers.colorValue('dai', 'mountain'), '#315852');
  assert.equal(Covers.colorValue('dai', 'poster'), '#aabfe2');
  assert.equal(Covers.colorValue('#123456', 'poster'), '#123456');
});

test('自定义色经作品文件、JSON 备份和命令行恢复后保留，实际构建的列表与作品页使用同一颜色', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkcode-cover-colors-'));
  try {
    for (const folder of ['scripts', 'admin', 'theme']) fs.cpSync(path.join(root, folder), path.join(dir, folder), { recursive: true });
    fs.symlinkSync(path.join(root, 'node_modules'), path.join(dir, 'node_modules'), 'dir');
    const model = { site: { name: '颜色验证', fontBase: '' }, posts: [], novels: [
      { id: 'light', title: '浅色封面', tpl: 'poster', cover: '#ffffff', created: '2026-10-23T00:00:00Z', chapters: [] },
      { id: 'dark', title: '深色封面', tpl: 'mountain', cover: '#123456', created: '2026-10-23T00:00:00Z', chapters: [] }
    ] };
    const roundtrip = Files.modelFromFiles(Files.filesFromModel(model));
    for (const novel of model.novels) assert.equal(roundtrip.novels.find(n => n.id === novel.id).cover, novel.cover);
    const backup = path.join(dir, 'backup.json'); fs.writeFileSync(backup, JSON.stringify({ format: 'inkcode-site-backup', ...model, images: {} }));
    execFileSync(process.execPath, [path.join(dir, 'scripts/import-backup.js'), backup]);
    for (const novel of model.novels) {
      const file = fs.readFileSync(path.join(dir, 'content/novels', novel.id, 'novel.md'), 'utf8');
      assert.equal(Files.parse(file).meta.cover, novel.cover);
    }
    execFileSync(process.execPath, [path.join(dir, 'scripts/build.js')], { env: { ...process.env, SITE_URL: 'https://example.test/blog' } });
    const list = fs.readFileSync(path.join(dir, 'dist/novels/index.html'), 'utf8');
    for (const novel of model.novels) {
      const detail = fs.readFileSync(path.join(dir, 'dist/novels', novel.id, 'index.html'), 'utf8');
      for (const html of [list, detail]) assert.ok(html.includes('--cv:' + novel.cover + ';'));
    }
    const snapshot = JSON.parse(fs.readFileSync(path.join(dir, 'dist/admin/content.json'), 'utf8'));
    assert.equal(Files.modelFromFiles(snapshot.files).novels.find(n => n.id === 'dark').cover, '#123456');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
