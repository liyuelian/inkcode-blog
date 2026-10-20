const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../admin/app.js'), 'utf8');
function section(start, end) {
  const first = source.indexOf(start);
  const last = source.indexOf(end, first);
  assert.ok(first >= 0 && last > first);
  return source.slice(first, last);
}

function setup() {
  const values = new Map();
  let limit = Infinity;
  const storage = {
    getItem: key => values.get(key) ?? null,
    removeItem: key => values.delete(key),
    setItem(key, value) {
      if (value.length > limit) throw new Error('QuotaExceededError');
      values.set(key, value);
    }
  };
  const context = { window: { localStorage: storage }, NS: 'site:' };
  vm.createContext(context);
  vm.runInContext(section('function store(', 'var LS =') + '\nvar LS = store("localStorage");\n' + section('function loadDraft(', 'function dropDraft('), context);
  return { context, values, setLimit: size => { limit = size; } };
}

const draft = title => ({ title, content: '正文\n![照片](img:photo)', images: { photo: 'data:image/png;base64,AQID' } });

test('正常保存并恢复完整的正文和图片', () => {
  const { context } = setup();
  const data = draft('完整草稿');
  assert.equal(context.saveDraft('post:new', data), true);
  assert.deepEqual(JSON.parse(JSON.stringify(context.loadDraft('post:new').data)), data);
});

test('完整草稿写入失败时，不用缺图版本覆盖上一份草稿', () => {
  const { context, values, setLimit } = setup();
  const original = draft('旧草稿');
  context.saveDraft('post:new', original);
  const stored = values.get('site:draft:post:new');
  const changed = draft('新草稿');
  changed.images.photo += 'A'.repeat(1000);
  // 容量足够写入去掉图片的版本，但不够写入完整版本。
  setLimit(stored.length + 10);
  assert.equal(context.saveDraft('post:new', changed), false);
  assert.equal(values.get('site:draft:post:new'), stored);
  assert.deepEqual(JSON.parse(JSON.stringify(context.loadDraft('post:new').data)), original);
});

test('首次保存失败不留下缺图草稿，恢复容量后可以保存全部内容', () => {
  const { context, values, setLimit } = setup();
  const data = draft('新草稿');
  data.images.photo += 'A'.repeat(1000);
  setLimit(200);
  assert.equal(context.saveDraft('post:new', data), false);
  assert.equal(values.has('site:draft:post:new'), false);
  setLimit(Infinity);
  assert.equal(context.saveDraft('post:new', data), true);
  assert.deepEqual(JSON.parse(JSON.stringify(context.loadDraft('post:new').data)), data);
});
