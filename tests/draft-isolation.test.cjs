const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');
const source = fs.readFileSync(require('node:path').join(__dirname, '../admin/app.js'), 'utf8');
const code = source.slice(source.indexOf('function loadDraft('), source.indexOf('function mountDraftChoices('));
function page(values, repo = 'owner/blog', branch = 'master') {
  const context = { NS: 'site:', CFG: { repo: 'owner/blog', branch: 'master' }, GH: { repo, branch },
    enc: encodeURIComponent, window: { crypto: { randomUUID } }, LS: {
      get: k => values.get(k), set: (k, v) => { values.set(k, v); return true; },
      del: k => values.delete(k), keys: p => [...values.keys()].filter(k => k.startsWith(p))
    } };
  vm.createContext(context); vm.runInContext(code, context); return context;
}
for (const logical of ['post:new', 'post:existing', 'ch:novel:new', 'ch:novel:chapter', 'form:novel:new', 'form:plan:novel']) {
  test(logical + ': 两页独立保存、恢复和清理', () => {
    const values = new Map(), a = page(values), b = page(values);
    const ak = a.draftKey(logical), bk = b.draftKey(logical);
    assert.notEqual(ak, bk);
    a.saveDraft(ak, { title: '页面A', images: { img: '完整图片' } });
    b.saveDraft(bk, { title: '页面B' });
    assert.equal(a.loadDraft(ak).data.title, '页面A');
    const reloaded = page(values);
    assert.equal(reloaded.draftVersions(logical).length, 2);
    reloaded.saveDraft(reloaded.draftKey(logical), a.loadDraft(ak).data);
    a.dropDraft(ak);
    assert.equal(b.loadDraft(bk).data.title, '页面B');
    assert.equal(reloaded.loadDraft(reloaded.draftKey(logical)).data.images.img, '完整图片');
  });
}
test('仓库和分支隔离，名称分隔符不产生碰撞', () => {
  const values = new Map(), a = page(values);
  a.saveDraft(a.draftKey('post:new'), { title: '本站' });
  for (const b of [page(values, 'other/blog'), page(values, 'owner/blog', 'preview')]) {
    assert.equal(b.draftVersions('post:new').length, 0);
    assert.notEqual(a.draftKey('post:new'), b.draftKey('post:new'));
  }
  assert.notEqual(page(values, 'a:b', 'c').draftScope(), page(values, 'a', 'b:c').draftScope());
});
test('旧暂存可恢复，读取不修改原数据，不向其他仓库提供无标记旧草稿', () => {
  const values = new Map(), a = page(values);
  a.saveDraft('post:new', { title: '旧文章', images: { img: '图片' } });
  a.saveDraft('form:owner/blog:master:novel:new', { title: '旧作品' });
  const before = JSON.stringify([...values]);
  assert.equal(a.draftVersions('post:new')[0].draft.data.images.img, '图片');
  assert.equal(a.draftVersions('form:novel:new')[0].draft.data.title, '旧作品');
  assert.equal(page(values, 'other/blog').draftVersions('post:new').length, 0);
  assert.equal(JSON.stringify([...values]), before);
});
