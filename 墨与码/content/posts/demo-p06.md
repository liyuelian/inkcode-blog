---
title: "个人项目，用 SQLite 就够了"
date: "2026-06-04T03:55:00.000Z"
tags: ["数据库","随笔"]
---

很多人一开新项目就先装 PostgreSQL 或 MySQL。对个人项目来说，SQLite 往往更合适：没有服务要维护，整个数据库就是一个文件，备份就是复制文件。

## 先打开 WAL 模式

默认的日志模式下，写入会阻塞读取。打开 WAL 后，读写可以同时进行：

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
```

`foreign_keys` 默认是关闭的，而且每次建立连接都要重新打开，这一点很容易忘。

## 不适合的场景

- 多台服务器同时写同一个数据库。
- 写入非常频繁、并发很高的服务。

除此之外，日活几千的小网站、命令行工具、桌面应用，SQLite 都绰绰有余。

> 选数据库之前先问一句：我真的需要一个数据库服务器吗？
