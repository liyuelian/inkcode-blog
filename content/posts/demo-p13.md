---
title: "TypeScript 的 satisfies 解决了什么问题"
date: "2026-08-21T00:20:00.000Z"
tags: ["TypeScript","前端"]
---

给配置对象加类型注解时，经常遇到一个两难：

```typescript
type Route = { path: string; auth?: boolean };

const routes: Record<string, Route> = {
  home: { path: '/' },
  admin: { path: '/admin', auth: true },
};

routes.hoem; // 拼错了，但不会报错
```

注解成 `Record<string, Route>` 之后，TypeScript 只知道键是任意字符串，具体有哪些键的信息丢了。

## satisfies

TypeScript 4.9 加入的 `satisfies` 只做检查，不改变推断出来的类型：

```typescript
const routes = {
  home: { path: '/' },
  admin: { path: '/admin', auth: true },
} satisfies Record<string, Route>;

routes.hoem;       // 报错：属性不存在
routes.admin.auth; // 类型是 boolean
```

既检查了每一项都符合 `Route`，又保留了具体的键名。

## 什么时候用

路由表、主题色、功能开关这类结构固定、键名有意义的常量对象，都适合用 `satisfies`。
