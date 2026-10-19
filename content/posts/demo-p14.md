---
title: "Go 并发：用 errgroup 管理一组 goroutine"
date: "2026-09-01T03:15:00.000Z"
tags: ["Go","后端"]
---

要并发请求几个接口，任何一个失败就整体失败，其余的也应该尽快停下来。用 `sync.WaitGroup` 自己处理错误很繁琐，`errgroup` 正好解决这个问题。

```go
import "golang.org/x/sync/errgroup"

func fetchAll(ctx context.Context, urls []string) error {
    g, ctx := errgroup.WithContext(ctx)
    g.SetLimit(4) // 最多同时 4 个

    for _, u := range urls {
        g.Go(func() error {
            return fetch(ctx, u)
        })
    }
    return g.Wait() // 返回第一个出现的错误
}
```

## 要点

- `WithContext` 返回的 `ctx` 会在第一个错误出现时被取消，`fetch` 里要记得检查它。
- `SetLimit` 控制并发数，避免一下子开几千个请求。
- Go 1.22 之后，循环变量每次迭代都是新的，闭包里直接用 `u` 没有问题；更早的版本要先写一句 `u := u`。
