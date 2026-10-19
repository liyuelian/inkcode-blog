---
title: "PostgreSQL 索引没生效？先查这五个原因"
date: "2026-05-24T01:00:00.000Z"
tags: ["数据库","PostgreSQL"]
---

加了索引，查询还是慢。先别急着加更多索引，用 `EXPLAIN ANALYZE` 看看执行计划，再对照下面几个常见原因。

```sql
EXPLAIN ANALYZE
SELECT * FROM orders WHERE lower(email) = 'a@example.com';
```

## 常见原因

| 原因 | 例子 | 解决办法 |
|---|---|---|
| 对列用了函数 | `lower(email) = ...` | 建表达式索引 |
| 类型不一致 | 文本列和数字比较 | 统一参数类型 |
| 前缀通配 | `LIKE '%abc'` | 考虑 `pg_trgm` 索引 |
| 筛选范围太大 | 条件命中一半的行 | 全表扫描反而更快 |
| 统计信息过期 | 刚导入大量数据 | 执行 `ANALYZE` |

## 表达式索引

第一种情况最常见：

```sql
CREATE INDEX idx_orders_email_lower ON orders (lower(email));
```

建好后，查询条件必须和索引里的表达式完全一致，才会用上它。

## 别强求

数据量很小的表，规划器选择全表扫描是合理的，不必强求走索引。
