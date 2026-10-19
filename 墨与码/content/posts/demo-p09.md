---
title: "二分查找的边界，我终于不写错了"
date: "2026-07-07T12:40:00.000Z"
tags: ["算法","Python"]
---

二分查找的思想很简单，但边界条件很容易写错：用 `<` 还是 `<=`？`mid` 要不要加一？我的办法是固定使用一种写法，并且记住它的含义。

## 左闭右开

查找第一个大于等于 `target` 的位置：

```python
def lower_bound(nums, target):
    lo, hi = 0, len(nums)        # 搜索区间 [lo, hi)
    while lo < hi:               # 区间不为空
        mid = (lo + hi) // 2
        if nums[mid] < target:
            lo = mid + 1         # 答案在 mid 右边
        else:
            hi = mid             # mid 可能就是答案
    return lo
```

## 为什么不会错

- 区间是 `[lo, hi)`，所以 `hi` 初始化为 `len(nums)`，循环条件是 `lo < hi`。
- `nums[mid] < target` 时，`mid` 一定不是答案，所以 `lo = mid + 1`。
- 否则 `mid` 可能是答案，不能丢掉，所以 `hi = mid`。

循环结束时 `lo == hi`，就是答案。如果所有数都比 `target` 小，返回的是 `len(nums)`。

## 其他问题都能转化

- 最后一个小于 `target` 的位置：`lower_bound(nums, target) - 1`。
- `target` 是否存在：看 `lo` 处的值是否等于 `target`。
