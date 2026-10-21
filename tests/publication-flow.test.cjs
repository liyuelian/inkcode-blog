const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const SiteFiles = require('../admin/files');
const source = fs.readFileSync(path.join(__dirname, '../admin/app.js'), 'utf8');
function section(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a); return source.slice(a, b);
}
const empty = () => ({ site: { name: '测试' }, posts: [], novels: [], images: {} });
const post = (id = 'stable-id') => ({ id, title: '同一篇文章', content: '正文', tags: [], created: '2026-01-01', draft: false });
function app() {
  const messages = [], dropped = [], destinations = [], calls = [];
  const ctx = { SiteFiles, DATA: empty(), FILES: {}, LOCAL_IMAGES: {}, BASE_SHA: 'base', SYNC_ERROR: '', LOADED: true,
    AUTH: 'yes', GH: { repo: 'test/blog', branch: 'master' }, busyNow: false, clone: structuredClone, EXT: {},
    normalize: d => Object.assign(d, { images: d.images || {} }), flushFormDrafts() {}, busy() {}, render() {}, watchBuild() {},
    toast: s => messages.push(s), dropDraft: k => dropped.push(k), setHash: h => destinations.push(h), showSyncNotice() {},
    ghCommit: async (...args) => { calls.push(args); return { sha: 'written', upstream: [], removedImages: [] }; } };
  vm.createContext(ctx);
  vm.runInContext(section('function publishError(', '/* 提交之后跟踪'), ctx);
  return { ctx, messages, dropped, destinations, calls };
}
const save = ctx => ctx.commit(d => {
  const old = d.posts.find(p => p.id === 'stable-id');
  if (old) old.content = '继续修改'; else d.posts.push(post());
}, { returnTo: '#/post/stable-id', clearDraft: 'draft-id', toast: '已发布' });

test('提交和同步都成功后才清理暂存，并显示成功', async () => {
  const { ctx, messages, dropped, destinations } = app();
  assert.equal(await save(ctx), true);
  assert.equal(ctx.DATA.posts.length, 1);
  assert.deepEqual(dropped, ['draft-id']);
  assert.deepEqual(destinations, ['#/post/stable-id']);
  assert.ok(messages.includes('已发布'));
  assert.equal(ctx.SYNC_ERROR, '');
});

test('提交已成功、同步失败：保留本人内容和暂存，拒绝部分状态，拦截重复发布', async () => {
  const { ctx, messages, dropped, calls } = app();
  ctx.ghCommit = async (...args) => { calls.push(args); return { sha: 'written', upstream: [{ filename: 'content/posts/remote.md' }], removedImages: [] }; };
  ctx.pullChanges = async (sha, list, target) => { target['content/posts/partial.md'] = '不应进入状态'; throw Error('offline'); };
  assert.equal(await save(ctx), true);
  assert.equal(ctx.DATA.posts.length, 1);
  assert.equal(ctx.BASE_SHA, 'written');
  assert.equal(ctx.FILES['content/posts/partial.md'], undefined);
  assert.deepEqual(dropped, []);
  assert.ok(messages.some(s => s.includes('已提交成功') && s.includes('无需重复发布')));
  assert.ok(!messages.some(s => s.includes('提交没有成功')));
  assert.ok(ctx.SYNC_ERROR);
  assert.equal(ctx.busyNow, false);
  assert.equal(await save(ctx), false);
  assert.equal(calls.length, 1);
});

test('已确认提交后出现显示错误，也不能再提示“提交失败”', async () => {
  const { ctx, messages } = app();
  ctx.render = () => { throw Error('display failed'); };
  await save(ctx);
  assert.equal(ctx.DATA.posts.length, 1);
  assert.ok(ctx.SYNC_ERROR);
  assert.ok(messages.some(s => s.includes('已提交')));
  assert.ok(!messages.some(s => s.includes('提交没有成功')));
});

test('真正写入失败：保留原内容和草稿，不调用保存成功回调', async () => {
  const { ctx, messages, dropped } = app(); let accepted = false;
  ctx.ghCommit = async () => { throw Object.assign(Error('denied'), { status: 403 }); };
  await ctx.commit(d => d.posts.push(post()), { clearDraft: 'draft', onSuccess: () => { accepted = true; } });
  assert.equal(ctx.DATA.posts.length, 0);
  assert.deepEqual(dropped, []);
  assert.equal(accepted, false);
  assert.ok(messages.some(s => s.includes('没有写入权限')));
  assert.equal(ctx.SYNC_ERROR, '');
});

function gitUpdate(mode) {
  const ctx = { BASE_SHA: 'base', GH: { branch: 'master' }, heads: 0, updates: 0, repoPath: p => p,
    headSha: async () => { ctx.heads++; if (ctx.heads === 1) return 'base'; if (mode === 'unreachable') throw Error('offline'); return mode === 'ack-lost' ? 'written' : 'other'; },
    unusedImagesForCommit: async () => [],
    gh: async (method, p) => {
      if (method === 'GET' && p === '/git/commits/base') return { tree: { sha: 'tree' } };
      if (p === '/git/trees') return { sha: 'next-tree' };
      if (p === '/git/commits') return { sha: 'written' };
      if (method === 'PATCH') { ctx.updates++; if (mode === 'rejected') throw Object.assign(Error('denied'), { status: 403 }); throw Error('response lost'); }
      throw Error('unexpected request ' + method + ' ' + p);
    } };
  vm.createContext(ctx); vm.runInContext(section('function ghCommit(', 'function publishError('), ctx); return ctx;
}

test('分支更新响应丢失，但仓库确认已写入：视为成功，不能再次更新分支', async () => {
  const ctx = gitUpdate('ack-lost');
  const result = await ctx.ghCommit({ 'content/posts/stable-id.md': '正文' }, {}, [], 'publish');
  assert.equal(result.sha, 'written');
  assert.equal(ctx.updates, 1);
  assert.equal(ctx.heads, 2);
});

test('无法确认更新结果时进入待核对状态，保留草稿并拦截再次提交', async () => {
  for (const mode of ['unreachable', 'other']) {
    const git = gitUpdate(mode);
    await assert.rejects(git.ghCommit({}, {}, [], 'publish'), e => e.code === 'commit-unknown');
    const { ctx, messages, calls, dropped } = app();
    ctx.ghCommit = async (...args) => { calls.push(args); throw Object.assign(Error('unknown'), { code: 'commit-unknown' }); };
    await save(ctx);
    assert.ok(ctx.SYNC_ERROR.includes('暂时无法确认'));
    assert.ok(messages.some(s => s.includes('提交结果待确认')));
    assert.deepEqual(dropped, []);
    await save(ctx); assert.equal(calls.length, 1);
  }
});

test('明确的权限拒绝不被误判为网络不确定，也不会发起核对请求', async () => {
  const ctx = gitUpdate('rejected');
  await assert.rejects(ctx.ghCommit({}, {}, [], 'publish'), e => e.status === 403 && !e.code);
  assert.equal(ctx.heads, 1);
});

function loader() {
  const previous = { 'content/posts/original.md': SiteFiles.stringify({ title: '原文章', date: '2026-01-01' }, '原正文') };
  const snapshot = { commit: 'older', files: { 'content/posts/snapshot.md': SiteFiles.stringify({ title: '快照文章', date: '2026-01-01' }, '快照正文') } };
  const ctx = { SiteFiles, FILES: previous, DATA: { marker: '完整原状态' }, BASE_SHA: 'original', LOADED: true, SYNC_ERROR: '需要同步',
    normalize: x => x, repoPath: p => p, headSha: async () => 'head', fetch: async () => ({ ok: true, json: async () => snapshot }),
    gh: async () => ({ status: 'ahead', files: [{ filename: 'content/posts/one.md' }, { filename: 'content/posts/two.md' }] }),
    rawFile: async (sha, p) => { if (p.endsWith('two.md')) throw Error('offline'); return '第一份文件'; } };
  vm.createContext(ctx); vm.runInContext(section('function pullChanges(', 'function showSyncNotice('), ctx); return ctx;
}

test('重新同步失败时，FILES、DATA、基线提交和待同步标记一起保持原状', async () => {
  const ctx = loader(), files = ctx.FILES, data = ctx.DATA;
  await assert.rejects(ctx.loadContent(), /offline/);
  assert.equal(ctx.FILES, files);
  assert.equal(ctx.DATA, data);
  assert.equal(ctx.BASE_SHA, 'original');
  assert.equal(ctx.SYNC_ERROR, '需要同步');
});

test('重新同步成功后一次性更新完整状态、解除提交限制', async () => {
  const ctx = loader(); ctx.rawFile = async (sha, p) => SiteFiles.stringify({ title: p, date: '2026-01-01' }, '完整正文');
  await ctx.loadContent();
  assert.equal(ctx.DATA.posts.length, 3);
  assert.equal(ctx.BASE_SHA, 'head');
  assert.equal(ctx.SYNC_ERROR, '');
});

test('完整树被截断时不把不完整内容作为成功同步', async () => {
  const ctx = loader(); ctx.fetch = async () => { throw Error('no snapshot'); }; ctx.gh = async () => ({ truncated: true, tree: [] });
  await assert.rejects(ctx.loadContent(), /不完整/);
  assert.equal(ctx.BASE_SHA, 'original');
});

test('新文章与新章节重试沿用草稿中的编号，而不是再次创建', () => {
  for (const chapter of [false, true]) {
    let cfg;
    const novel = { id: 'novel', title: '作品', volumes: [], chapters: [] };
    const ctx = { DATA: empty(), gate: fn => fn(), editorHtml: () => '', enc: encodeURIComponent, escHtml: s => s,
      draftKey: x => x, newPostId: () => 'unused-new-id', uid: () => 'unused-chapter-id', cnNum: n => n, findNovel: () => novel,
      parseTags: () => [], nowISO: () => '2026-01-01T00:00:00Z', mountEditor: (main, c) => { cfg = c; },
      commit: mutate => mutate(ctx.DATA) };
    ctx.DATA.novels = [novel];
    vm.createContext(ctx); vm.runInContext(section('function viewEditPost(', 'function viewEditNovel('), ctx);
    const view = chapter ? ctx.viewEditChapter('novel', 'new') : ctx.viewEditPost('new');
    view.mount({});
    const state = { ...cfg.base, _entityId: 'saved-draft-id', title: '标题', content: '正文', images: {} };
    cfg.onPublish(state, {}); cfg.onPublish(state, {});
    const records = chapter ? ctx.DATA.novels[0].chapters : ctx.DATA.posts;
    assert.equal(records.length, 1); assert.equal(records[0].id, 'saved-draft-id');
  }
});
