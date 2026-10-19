---
title: "Python 的 dataclass 记得打开 slots"
date: "2026-04-20T16:15:00.000Z"
tags: ["Python"]
---

`dataclass` 省掉了手写 `__init__` 和 `__repr__` 的麻烦。Python 3.10 起它多了一个 `slots=True` 参数，值得默认打开。

## 什么是 slots

普通对象把属性存在一个字典 `__dict__` 里，灵活但占内存。声明 `__slots__` 之后，属性存放在固定的位置，对象更小，属性访问也快一点。

```python
from dataclasses import dataclass

@dataclass(slots=True)
class Point:
    x: float
    y: float

p = Point(1.0, 2.0)
p.z = 3.0  # AttributeError：不能随手加新属性
```

## 什么时候用

- 要创建大量小对象时，比如解析出来的几十万行记录。
- 希望属性名写错时直接报错，而不是悄悄多出一个属性。

再加上 `frozen=True`，就得到一个不可变、可哈希的值对象，可以当字典的键：

```python
@dataclass(slots=True, frozen=True)
class Version:
    major: int
    minor: int
```

不适合的情况也有：需要动态添加属性，或者依赖 `__dict__` 的少数库会受影响。
