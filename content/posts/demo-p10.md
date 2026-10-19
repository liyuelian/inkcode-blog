---
title: "Docker 镜像瘦身：多阶段构建"
date: "2026-07-18T15:35:00.000Z"
tags: ["Docker","运维","Go"]
---

一个 Go 写的小服务，最初的镜像超过 1GB。原因很简单：编译工具链和源码全都打进了最终镜像。

## 多阶段构建

```dockerfile
# 第一阶段：编译
FROM golang:1.22 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /out/server ./cmd/server

# 第二阶段：只放可执行文件
FROM gcr.io/distroless/static-debian12
COPY --from=build /out/server /server
ENTRYPOINT ["/server"]
```

第一阶段负责编译，第二阶段只复制编译结果，最终镜像只剩几十 MB。

## 其他技巧

- 先复制依赖清单再复制源码，改代码时就能复用依赖那一层的缓存。
- 写好 `.dockerignore`，别把 `.git` 和本地构建产物送进构建上下文。
- `distroless` 镜像里没有 shell，需要进去调试时可以临时换成 `alpine`。
