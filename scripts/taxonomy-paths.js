/* 标签和系列共用的目录分配规则。普通、不冲突的名称保留旧网址；
 * 会丢失字符、文件系统不安全或相互冲突的名称，附加原始名称的摘要。 */
const crypto = require('node:crypto');

const oldName = (name) => name.trim().replace(/[\\/?#%"<>|*:\s]+/g, '-').replace(/^-+|-+$/g, '') || 'x';
const diskKey = (name) => name.normalize('NFC').toLowerCase();
const safe = (name) => name !== '.' && name !== '..' && !/[. ]$/.test(name) &&
  !/[\u0000-\u001f\u007f~]/.test(name) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) &&
  Buffer.byteLength(name, 'utf8') <= 180;

function taxonomyPaths(values) {
  const names = [...new Set(values)].sort();
  const groups = new Map();
  for (const name of names) {
    const old = oldName(name);
    if (old !== name || !safe(old)) continue;
    const key = diskKey(old);
    groups.set(key, (groups.get(key) || 0) + 1);
  }
  const paths = new Map(), used = new Set();
  for (const name of names) {
    const old = oldName(name);
    let slug = old;
    if (old !== name || !safe(old) || groups.get(diskKey(old)) > 1) {
      // “~”留给自动编号，用户手写的同形名称也会得到自己的编号。
      const stem = Array.from(old.replace(/[\u0000-\u001f\u007f~]/g, '-')).slice(0, 40).join('').replace(/[. ]+$/g, '') || 'x';
      slug = stem + '~' + crypto.createHash('sha256').update(name).digest('hex').slice(0, 16);
    }
    const key = diskKey(slug);
    // 极端摘要冲突时中止构建，避免静默覆盖已有内容。
    if (used.has(key)) throw new Error('标签或系列网址冲突：' + name);
    used.add(key); paths.set(name, slug);
  }
  return paths;
}

module.exports = { taxonomyPaths };
