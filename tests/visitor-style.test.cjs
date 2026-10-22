const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'theme/appearance.js'), 'utf8');
function part(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a); return source.slice(a, b);
}
function reader({ base = '/blog', defaults = 'terminal', blocked = false, values = new Map(), system = 'light' } = {}) {
  const key = 'site:style:' + (base || '/'), attrs = { 'data-style': defaults, 'data-default-style': defaults, 'data-mode': 'dark' };
  const config = { storageKey: key, defaultStyle: defaults, fonts: { paper: 'paper-font', minimal: 'minimal-font', terminal: 'terminal-font' } };
  const links = { 'font-link': { attrs: { href: config.fonts[defaults] }, getAttribute(k) { return this.attrs[k]; }, setAttribute(k, v) { this.attrs[k] = v; } } };
  const inputs = ['paper', 'minimal', 'terminal'].map(value => ({ value, checked: false, closest: () => ({ classList: { toggle() {} } }) }));
  const modeInputs = ['light', 'dark'].map(value => ({ value, checked: false, closest: () => ({ classList: { toggle() {} } }) }));
  const systemState = { mode: system };
  const messages = [], events = [];
  const ctx = { NS: 'site:', BASE: base, root: { getAttribute: k => attrs[k], setAttribute: (k, v) => { attrs[k] = v; },
      removeAttribute: k => { delete attrs[k]; }, classList: { add() {}, remove() {} } },
    doc: { getElementById: id => id === 'appearance-config' ? { textContent: JSON.stringify(config) } : links[id],
      head: { appendChild: link => { links[link.id] = link; } }, createElement: () => { throw Error('unexpected new link'); } },
    window: { localStorage: { getItem: k => values.get(k) ?? null, setItem(k, v) { if (blocked) throw Error('disabled'); values.set(k, v); }, removeItem(k) { values.delete(k); } },
      dispatchEvent: e => events.push(e.type), matchMedia: () => ({ matches: systemState.mode === 'dark' }) }, Event: class { constructor(type) { this.type = type; } },
    setTimeout: () => 0, clearTimeout() {},
    $$: selector => selector.includes('visitor-mode') ? modeInputs : inputs, toast: message => messages.push(message) };
  vm.createContext(ctx); vm.runInContext(part('function store()', 'var LS =') + '\nvar LS = store();\n' + part('/* ---------- 访客主题', '/* ---------- 页面挂载'), ctx);
  return { ctx, values, attrs, key, links, inputs, modeInputs, systemState, messages, events };
}

test('访客选择即时生效并保留偏好，换风格不改变日夜选择和网站默认', () => {
  const r = reader(); r.values.set('site:mode', 'dark');
  r.ctx.chooseVisitorStyle('minimal');
  assert.equal(r.attrs['data-style'], 'minimal'); assert.equal(r.values.get(r.key), 'minimal');
  assert.equal(r.links['font-link'].attrs.href, 'minimal-font'); assert.ok(r.inputs.find(x => x.value === 'minimal').checked);
  r.ctx.chooseVisitorStyle('paper');
  assert.equal(r.attrs['data-style'], 'paper'); assert.equal(r.values.get(r.key), 'paper');
  assert.equal(r.values.get('site:mode'), 'dark'); assert.equal(r.attrs['data-mode'], 'dark');
  assert.equal(r.attrs['data-default-style'], 'terminal'); assert.deepEqual(r.events, ['resize', 'resize']);
});

test('明确选择与默认相同的风格仍保留，作者换默认后不会覆盖访客选择', () => {
  const values = new Map(), r = reader({ values }); r.ctx.chooseVisitorStyle('terminal');
  const next = reader({ defaults: 'paper', values });
  next.ctx.applyVisitorStyle(next.ctx.preferredStyle()); assert.equal(next.attrs['data-style'], 'terminal');
  const fresh = reader({ defaults: 'paper' }); fresh.ctx.applyVisitorStyle(fresh.ctx.preferredStyle());
  assert.equal(fresh.attrs['data-style'], 'paper'); assert.ok(fresh.inputs.find(x => x.value === 'paper').checked);
});

test('同一域名下不同站点隔离偏好，未知或原型属性名称不能当成主题', () => {
  const values = new Map(), a = reader({ base: '/a', values }), b = reader({ base: '/b', values });
  a.ctx.chooseVisitorStyle('paper'); assert.equal(b.ctx.preferredStyle(), 'terminal');
  for (const bad of ['constructor', '__proto__', 'toString', 'anything', 'default']) {
    values.set(b.key, bad); assert.equal(b.ctx.preferredStyle(), 'terminal');
    b.ctx.chooseVisitorStyle(bad); assert.equal(b.attrs['data-style'], 'terminal');
  }
  assert.equal(values.get(a.key), 'paper');
});

test('浏览器禁止存储时仍能即时切换，并说明无法记住偏好', () => {
  const r = reader({ blocked: true }); assert.doesNotThrow(() => r.ctx.chooseVisitorStyle('paper'));
  assert.equal(r.attrs['data-style'], 'paper'); assert.equal(r.values.has(r.key), false);
  assert.ok(r.messages[0].includes('无法记住选择'));
});

test('没有访客选择时使用作者最新默认，禁用远程字体时不新增字体请求', () => {
  const r = reader({ defaults: 'minimal' });
  r.ctx.APPEARANCE.fonts = { paper: '', minimal: '', terminal: '' };
  delete r.links['font-link']; r.ctx.applyVisitorStyle(r.ctx.preferredStyle());
  assert.equal(r.attrs['data-style'], 'minimal'); assert.equal(r.links['font-link'], undefined);
});

test('日夜选择与风格分别记忆，固定日间即使系统变化也不转为自动', () => {
  const r = reader({ system: 'light' }); r.ctx.chooseVisitorStyle('paper');
  r.ctx.chooseMode('light');
  assert.equal(r.values.get('site:mode'), 'light'); assert.equal(r.attrs['data-mode'], 'light');
  r.systemState.mode = 'dark'; r.ctx.updateModeOptions();
  assert.equal(r.values.get('site:mode'), 'light'); assert.equal(r.attrs['data-mode'], 'light');
  assert.ok(r.modeInputs.find(x => x.value === 'light').checked);
  r.ctx.chooseMode('dark');
  assert.equal(r.values.get('site:mode'), 'dark'); assert.equal(r.attrs['data-mode'], 'dark');
  assert.ok(r.modeInputs.find(x => x.value === 'dark').checked);
  assert.equal(r.values.get(r.key), 'paper'); assert.equal(r.attrs['data-style'], 'paper');
});

test('已有日夜偏好继续有效，旧自动模式迁移为当前显示的明暗', () => {
  const r = reader(); r.values.set('site:mode', 'dark');
  r.ctx.applyMode(r.ctx.preferredMode()); assert.equal(r.attrs['data-mode'], 'dark');
  r.ctx.chooseMode('unknown'); assert.equal(r.values.get('site:mode'), 'dark');
  r.ctx.chooseMode('system'); assert.equal(r.values.get('site:mode'), 'dark');
  r.values.set('site:mode', 'bad-old-value'); r.ctx.applyMode(r.ctx.preferredMode());
  assert.equal(r.attrs['data-mode'], 'dark'); assert.ok(r.modeInputs.find(x => x.value === 'dark').checked);
  delete r.attrs['data-mode']; r.ctx.applyMode(r.ctx.preferredMode());
  assert.equal(r.attrs['data-mode'], 'light');
});

test('禁止存储时日夜模式仍即时生效，不清除风格且说明无法记住', () => {
  const r = reader({ blocked: true }); r.ctx.applyVisitorStyle('minimal');
  r.ctx.chooseMode('dark'); assert.equal(r.attrs['data-mode'], 'dark');
  assert.equal(r.attrs['data-style'], 'minimal'); assert.ok(r.messages[0].includes('无法记住选择'));
});

test('后台反复挂载菜单仍只绑定一次，替换后的菜单可切换且不覆盖站点默认', () => {
  for (const blocked of [false, true]) {
    const r = reader({ blocked }), listeners = {}, windowListeners = {};
    const get = r.ctx.doc.getElementById;
    let picker = { hidden: true };
    r.ctx.doc.getElementById = id => id === 'style-switch' ? picker : get(id);
    r.ctx.doc.addEventListener = (name, handler) => { (listeners[name] ||= []).push(handler); };
    r.ctx.window.addEventListener = (name, handler) => { (windowListeners[name] ||= []).push(handler); };
    vm.runInContext(part('/* ---------- 页面挂载', 'window.SiteAppearance ='), r.ctx);
    r.ctx.mount();
    const change = value => listeners.change[0]({ target: { value, closest: () => picker,
      matches: selector => selector.includes('visitor-style') } });
    change('paper');
    picker = { hidden: true }; // 后台跳转后生成的新导航。
    r.ctx.mount({ defaultStyle: 'minimal' }); r.ctx.mount();
    assert.equal(picker.hidden, false);
    assert.equal(r.attrs['data-style'], 'paper');
    assert.equal(r.attrs['data-default-style'], 'minimal');
    assert.equal(listeners.change.length, 1); assert.equal(listeners.click.length, 1);
    assert.equal(listeners.keydown.length, 1); assert.equal(windowListeners.storage.length, 1);
    change('terminal'); assert.equal(r.attrs['data-style'], 'terminal');
    assert.equal(r.attrs['data-default-style'], 'minimal');
  }
});

test('实际构建：前后台共用菜单与偏好，首屏在样式表前应用偏好且安全序列化配置', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkcode-visitor-style-'));
  try {
    for (const folder of ['scripts', 'admin', 'theme']) fs.cpSync(path.join(root, folder), path.join(dir, folder), { recursive: true });
    fs.symlinkSync(path.join(root, 'node_modules'), path.join(dir, 'node_modules'), 'dir');
    fs.mkdirSync(path.join(dir, 'content/posts'), { recursive: true });
    const fontBase = 'https://fonts.example.test/css?label=<style>';
    fs.writeFileSync(path.join(dir, 'content/site.json'), JSON.stringify({ name: '主题验证', style: 'terminal', fontBase }));
    fs.writeFileSync(path.join(dir, 'content/posts/a.md'), '---\ntitle: "文章"\ndate: "2026-01-01"\ntags: ["标签"]\n---\n\n正文');
    execFileSync(process.execPath, [path.join(dir, 'scripts/build.js')], { env: { ...process.env, SITE_URL: 'https://example.test/blog' } });
    const home = fs.readFileSync(path.join(dir, 'dist/index.html'), 'utf8');
    assert.ok(home.includes('aria-label="外观设置"')); assert.ok(!home.includes('id="mode-btn"'));
    assert.equal((home.match(/name="visitor-mode"/g) || []).length, 2);
    assert.equal((home.match(/name="visitor-style"/g) || []).length, 3);
    assert.ok(!home.includes('value="system"')); assert.ok(!home.includes('value="default"'));
    const config = JSON.parse(home.match(/id="appearance-config">([^]*?)<\/script>/)[1]);
    assert.equal(config.storageKey, 'site:style:/blog'); assert.ok(config.fonts.paper.startsWith(fontBase));
    const boot = [...home.matchAll(/<script>([^]*?)<\/script>/g)].map(m => m[1]).find(s => s.includes('appearance-config'));
    assert.ok(home.indexOf(boot) < home.indexOf('/assets/site.css'));
    for (const [pref, expected] of [['paper', 'paper'], ['minimal', 'minimal'], ['terminal', 'terminal'], ['constructor', 'terminal'], [null, 'terminal']]) {
      const attrs = {}, font = {}, ctx = { document: { documentElement: { setAttribute: (k, v) => { attrs[k] = v; } },
        getElementById: id => id === 'appearance-config' ? { textContent: JSON.stringify(config) } : { setAttribute: (k, v) => { font[k] = v; } } },
        localStorage: { getItem: () => pref } };
      vm.runInNewContext(boot, ctx); assert.equal(attrs['data-style'], expected); assert.equal(font.href, config.fonts[expected]);
    }
    const modeBoot = [...home.matchAll(/<script>([^]*?)<\/script>/g)].map(m => m[1]).find(s => s.includes('site:mode'));
    const stored = new Map(); const attrs = {};
    const modeCtx = { document: { documentElement: { getAttribute: k => attrs[k], setAttribute: (k, v) => { attrs[k] = v; } } },
      localStorage: { getItem: k => stored.get(k), setItem: (k, v) => stored.set(k, v) }, window: { matchMedia: () => ({ matches: true }) } };
    vm.runInNewContext(modeBoot, modeCtx); assert.equal(attrs['data-mode'], 'dark'); assert.equal(stored.get('site:mode'), 'dark');
    modeCtx.window.matchMedia = () => ({ matches: false });
    vm.runInNewContext(modeBoot, modeCtx); assert.equal(attrs['data-mode'], 'dark'); // 刷新不再自动跟随系统。
    const files = ['index.html', 'blog/index.html', 'posts/a/index.html', 'novels/index.html', 'archive/index.html', 'search/index.html', '404.html'];
    for (const file of files) assert.ok(fs.readFileSync(path.join(dir, 'dist', file), 'utf8').includes('id="style-switch"'), file);
    const admin = fs.readFileSync(path.join(dir, 'dist/admin/index.html'), 'utf8');
    assert.deepEqual(JSON.parse(admin.match(/id="appearance-config">([^]*?)<\/script>/)[1]), config);
    assert.ok(admin.includes('<template id="appearance-template"><details'));
    assert.ok(admin.includes('data-base="/blog"'));
    const shared = '/blog/assets/appearance.js?v=';
    assert.ok(home.includes(shared)); assert.ok(admin.includes(shared));
    assert.ok(home.indexOf(shared) < home.indexOf('/assets/site.js?v='));
    assert.ok(admin.indexOf(shared) < admin.indexOf('src="app.js?v='));
    assert.ok(admin.indexOf('appearance-config') < admin.indexOf('href="admin.css'));
    assert.equal(fs.readFileSync(path.join(dir, 'dist/assets/appearance.js'), 'utf8'), source);
    const app = fs.readFileSync(path.join(dir, 'dist/admin/app.js'), 'utf8');
    assert.ok(app.includes('window.SiteAppearance.mount({ defaultStyle: k, toast: toast })'));
    assert.ok(!app.includes('mode-btn')); assert.ok(!app.includes('watchSystemMode'));
    assert.ok(!app.includes('data-style="'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
