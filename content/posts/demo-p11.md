---
title: "正则表达式：用命名分组代替 $1"
date: "2026-07-29T18:30:00.000Z"
tags: ["JavaScript","工具"]
---

解析日期时，我以前这样写：

```javascript
const m = '2026-10-07'.match(/(\d{4})-(\d{2})-(\d{2})/);
const year = m[1];
```

过几个月再看，`m[1]` 是什么完全想不起来。命名分组可以给每个括号起名字：

```javascript
const re = /(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})/;
const { year, month, day } = '2026-10-07'.match(re).groups;
```

## 替换时也能用

```javascript
'2026-10-07'.replace(re, '$<day>/$<month>/$<year>');
// '07/10/2026'
```

## 在 Python 里

Python 的写法稍有不同，多一个 `P`：

```python
import re
m = re.match(r"(?P<year>\d{4})-(?P<month>\d{2})", "2026-10")
m.group("year")  # '2026'
```

正则本来就难读，能起名字的地方都起上名字。
