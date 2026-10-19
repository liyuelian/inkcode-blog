---
title: "CSS 容器查询：让组件自己决定布局"
date: "2026-05-12T22:05:00.000Z"
tags: ["前端","CSS"]
---

媒体查询看的是整个屏幕的宽度，但同一个卡片组件放在侧栏和放在主栏里，可用宽度完全不同。容器查询让组件根据自己所在容器的宽度来调整布局。

## 基本写法

```css
.card-wrap {
  container-type: inline-size;
}

.card {
  display: grid;
  gap: 12px;
}

@container (min-width: 420px) {
  .card {
    grid-template-columns: 140px 1fr;
  }
}
```

容器宽度超过 420px 时，卡片变成左图右文；否则上下排列，和屏幕多宽无关。

## 容器单位

`cqw` 表示容器宽度的 1%。这个网站的小说封面就是用它排版的：封面无论显示成多大，书名的字号都按封面宽度等比缩放。

```css
.cover {
  container-type: inline-size;
}
.cover-title {
  font-size: 12cqw;
}
```

## 兼容性

主流浏览器在 2023 年前后都已支持。需要照顾旧浏览器时，先写一行像素值作为退路即可。
