const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { taxonomyPaths } = require('../scripts/taxonomy-paths');
const SiteFiles = require('../admin/files');
const root = path.join(__dirname, '..');
const portableKey = s => s.normalize('NFC').toLowerCase();

test('不同符号、大小写、Unicode 写法、特殊文件名和长名称不会共用目录', () => {
  const names = ['前端/基础', '前端?基础', '前端-基础', 'a b', 'a/b', 'a?b', 'a-b', 'x', '?', '%', '.', '..',
    'JS', 'js', 'é', 'e\u0301', 'foo.', 'foo', 'CON', 'con', 'a~123', 'a\0b', '长'.repeat(200), '😀'.repeat(100), 'constructor', '__proto__'];
  const result = taxonomyPaths(names);
  assert.equal(result.size, names.length);
  assert.equal(new Set([...result.values()].map(portableKey)).size, names.length);
  for (const slug of result.values()) {
    assert.ok(slug && slug !== '.' && slug !== '..');
    assert.doesNotMatch(slug, /[\\/?#%"<>|*:\s\u0000-\u001f]/);
    assert.ok(Buffer.byteLength(slug) <= 180);
  }
});

test('普通名称保留旧网址；遍历顺序、重复值和新增特殊名称不影响已有普通目录', () => {
  const normal = ['前端', 'JavaScript', 'CSS', '使用指南', 'a-b'];
  const original = taxonomyPaths(normal);
  for (const name of normal) assert.equal(original.get(name), name);
  const names = [...normal, 'a/b', 'a?b', 'a b', 'CSS', '前端/基础'];
  const result = taxonomyPaths(names);
  assert.deepEqual([...taxonomyPaths([...names].reverse())], [...result]);
  for (const name of normal) assert.equal(result.get(name), original.get(name));
  // 用户手写的“名称~摘要”不能冒充另一个名称的自动目录。
  const generated = result.get('a/b');
  const extended = taxonomyPaths([...names, generated]);
  assert.equal(extended.get('a/b'), generated);
  assert.notEqual(extended.get(generated), generated);
});

test('实际构建：标签/系列页面、分页、文章链接和 sitemap 都指向各自的内容', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkcode-taxonomy-'));
  try {
    for (const folder of ['scripts', 'admin', 'theme']) fs.cpSync(path.join(root, folder), path.join(dir, folder), { recursive: true });
    fs.symlinkSync(path.join(root, 'node_modules'), path.join(dir, 'node_modules'), 'dir');
    fs.mkdirSync(path.join(dir, 'content/posts'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'content/site.json'), JSON.stringify({ name: '网址回归验证', fontBase: '' }));
    const groups = ['前端/基础', '前端?基础', '前端-基础', 'JS', 'js', 'constructor', '__proto__', '.', '..'];
    const records = [];
    for (const [i, name] of groups.entries()) {
      for (let j = 0; j < (i === 0 ? 9 : 1); j++) {
        const post = { id: 'g' + i + '-' + j, title: 'ONLY-GROUP-' + i + '-POST-' + j, tags: [name], series: name, created: '2026-01-01T00:00:00Z', content: '正文' };
        records.push(post);
        fs.writeFileSync(path.join(dir, 'content/posts', post.id + '.md'), SiteFiles.stringify({ title: post.title, date: post.created, tags: post.tags, series: name }, post.content));
      }
    }
    execFileSync(process.execPath, [path.join(dir, 'scripts/build.js')], { cwd: dir, env: { ...process.env, SITE_URL: 'https://example.test/blog', GITHUB_REPOSITORY: 'fixture/blog', GITHUB_REF_NAME: 'master' } });
    const slugs = taxonomyPaths(groups);
    const read = relative => fs.readFileSync(path.join(dir, 'dist', relative, 'index.html'), 'utf8');
    const blog = read('blog'), sitemap = fs.readFileSync(path.join(dir, 'dist/sitemap.xml'), 'utf8');
    for (const [i, name] of groups.entries()) {
      const slug = slugs.get(name), segment = encodeURIComponent(slug);
      const tag = read('tags/' + slug), series = read('series/' + slug), article = read('posts/g' + i + '-0');
      for (const html of [tag, series]) {
        assert.ok(html.includes('ONLY-GROUP-' + i + '-POST-'), name);
        for (const [other] of groups.entries()) if (other !== i) assert.ok(!html.includes('ONLY-GROUP-' + other + '-POST-'), name + ' 混入其他名称的文章');
      }
      assert.ok(blog.includes('href="/blog/tags/' + segment + '/"'));
      assert.ok(article.includes('href="/blog/tags/' + segment + '/"'));
      assert.ok(article.includes('href="/blog/series/' + segment + '/"'));
      for (const type of ['tags', 'series']) assert.ok(sitemap.includes('<loc>https://example.test/blog/' + type + '/' + segment + '/</loc>'));
    }
    const first = slugs.get(groups[0]), tag = read('tags/' + first), page2 = read('tags/' + first + '/page/2');
    assert.ok(tag.includes('/blog/tags/' + encodeURIComponent(first) + '/page/2/'));
    assert.ok(page2.includes('ONLY-GROUP-0-POST-'));
    assert.ok(!page2.includes('ONLY-GROUP-1-POST-'));
    assert.ok(page2.includes('rel="prev" href="/blog/tags/' + encodeURIComponent(first) + '/"'));
    assert.ok(page2.includes('rel="canonical" href="https://example.test/blog/tags/' + first + '/page/2/"'));
    assert.equal(fs.readdirSync(path.join(dir, 'dist/tags')).length, groups.length);
    assert.equal(fs.readdirSync(path.join(dir, 'dist/series')).length, groups.length);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
