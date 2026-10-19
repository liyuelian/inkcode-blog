---
title: "写给自己的 HTTP 缓存速查表"
date: "2026-08-09T21:25:00.000Z"
tags: ["后端","网络"]
---

每次配置缓存都要重新查一遍文档，干脆整理一份自己的速查表。

## Cache-Control 常用指令

| 指令 | 含义 |
|---|---|
| `max-age=3600` | 一小时内直接用缓存，不发请求 |
| `no-cache` | 可以缓存，但每次使用前都要向服务器确认 |
| `no-store` | 完全不缓存 |
| `private` | 只能缓存在浏览器，不能被 CDN 缓存 |
| `immutable` | 有效期内内容不变，刷新也不用确认 |

`no-cache` 的意思不是“不缓存”，这是最容易记错的一个。

## 协商缓存

缓存过期后，浏览器带上 `If-None-Match` 去问服务器。内容没变就返回 304，不用重新下载：

```http
GET /app.js HTTP/1.1
If-None-Match: "a1b2c3"

HTTP/1.1 304 Not Modified
```

## 我的默认配置

- 文件名带哈希的静态资源：`max-age=31536000, immutable`。
- HTML 页面：`no-cache`，保证每次拿到最新的入口。
- 和用户相关的接口：`private, no-store`。
