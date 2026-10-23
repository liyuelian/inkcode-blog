/* 构建端与写作后台共用的小说封面，保证预览和发布后的排版一致。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SiteCovers = factory();
})(this, function () {
  'use strict';
  var colors = { ink: '墨', zhu: '朱', dai: '黛', zhuye: '竹', zhe: '赭', yue: '月' };
  var colorHex = { ink: '#27251f', zhu: '#8c2a22', dai: '#283d4d', zhuye: '#3d5a45', zhe: '#87592c', yue: '#d8d1c0' };
  var templates = { mountain: '远山藏月', poster: '字形海报', night: '夜城', sun: '留白', star: '星海', deco: '民国' };
  var defaultTemplate = 'mountain';
  function has(object, key) { return Object.prototype.hasOwnProperty.call(object, key); }
  // 旧作品和备份中的已移除样式也采用当前默认封面。
  function templateKey(key) { return has(templates, key) ? key : defaultTemplate; }
  function isCustomColor(value) { return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value); }
  function colorKey(value) { return has(colors, value) ? value : isCustomColor(value) ? value.toLowerCase() : 'dai'; }
  function colorValue(value, template) {
    var key = colorKey(value), tpl = templateKey(template);
    if (isCustomColor(key)) return key;
    if (tpl === 'mountain' && key === 'dai') return '#315852';
    if (tpl === 'mountain' && key === 'yue') return '#58675e';
    if (tpl === 'poster' && key === 'dai') return '#aabfe2';
    return colorHex[key];
  }
  function foreground(hex) {
    var channels = [1, 3, 5].map(function (at) {
      var n = parseInt(hex.slice(at, at + 2), 16) / 255;
      return n <= .04045 ? n / 12.92 : Math.pow((n + .055) / 1.055, 2.4);
    });
    var luminance = channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
    return (luminance + .05) / .05 >= 1.05 / (luminance + .05) ? '#000000' : '#ffffff';
  }
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function html(novel, options) {
    novel = novel || {}; options = options || {};
    var tpl = templateKey(novel.tpl);
    var color = colorKey(novel.cover), custom = isCustomColor(color);
    var title = String(novel.title || '书名');
    var author = String(novel.author || options.siteName || '').trim();
    var art = '', style = custom ? '--cv:' + color + ';--cv-fg:' + foreground(color) + ';' : '';
    if (tpl === 'mountain' || tpl === 'poster') {
      var length = Array.from(title).length, size;
      if (tpl === 'mountain') size = length <= 4 ? 15 : length <= 6 ? 65 / length : length <= 12 ? 12.6 : length <= 20 ? 10 : length <= 40 ? 7 : 6;
      else size = length <= 4 ? 30 : length <= 6 ? 24 : length <= 12 ? 18.5 : length <= 20 ? 14 : length <= 40 ? 9 : 8;
      style += '--cv-title-size:' + size + 'cqw;';
      art = '<span class="cv-series">' + esc(options.siteName || '文库') + (tpl === 'mountain' ? ' · 文学' : ' · 文库') + '</span>';
      if (tpl === 'mountain') art += '<span class="cv-moon"></span><span class="cv-ridge cv-ridge-a"></span><span class="cv-ridge cv-ridge-b"></span><span class="cv-ridge cv-ridge-c"></span>';
    }
    return '<div class="cover ct-' + tpl + ' cv-' + (custom ? 'custom' : color) + (Array.from(title).length > 6 ? ' cv-long' : '') + '" aria-hidden="true"' + (style ? ' style="' + style + '"' : '') + '><span class="cv-art">' + art + '</span><span class="cv-text">' +
      '<span class="cv-title">' + esc(title) + '</span>' +
      (author ? '<span class="cv-sign"><i>' + esc(author) + ' 著</i><em>' + esc(options.seal || '') + '</em></span>' : '') + '</span></div>';
  }
  return { colors: colors, templates: templates, defaultTemplate: defaultTemplate, templateKey: templateKey, isCustomColor: isCustomColor, colorKey: colorKey, colorValue: colorValue, html: html };
});
