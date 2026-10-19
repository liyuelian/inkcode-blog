---
title: "防抖与节流，一次讲清楚"
date: "2026-06-15T06:50:00.000Z"
tags: ["前端","JavaScript"]
---

搜索框输入、窗口缩放、页面滚动，这些事件触发得非常频繁。直接在回调里做重活，页面会卡。防抖和节流是两种限制频率的办法。

## 区别

| | 防抖 debounce | 节流 throttle |
|---|---|---|
| 行为 | 停下来一段时间后才执行一次 | 每隔一段时间最多执行一次 |
| 适合 | 搜索联想、自动保存 | 滚动监听、拖拽 |

这个网站的草稿自动保存用的就是防抖：停止输入不到一秒后才写入本机。

## 防抖

```javascript
function debounce(fn, wait) {
  let timer = null;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), wait);
  };
}
```

## 节流

```javascript
function throttle(fn, wait) {
  let last = 0;
  return function (...args) {
    const now = Date.now();
    if (now - last >= wait) {
      last = now;
      fn.apply(this, args);
    }
  };
}
```

和滚动相关的场景还可以用 `requestAnimationFrame`，让回调跟着屏幕刷新走。文章顶部的阅读进度条就是这么做的。
