---
title: "用 Git worktree 同时开发多个分支"
date: "2026-04-09T13:20:00.000Z"
tags: ["Git","工具"]
---

正在 feature 分支上改到一半，线上突然要修个 bug。以前的做法是 `git stash`，切分支，修完再切回来 `stash pop`，经常忘了自己 stash 过什么。

`git worktree` 可以让同一个仓库同时检出多个分支，每个分支一个独立目录，互不干扰。

## 常用命令

```bash
# 在上级目录新建一个工作区，检出 hotfix 分支
git worktree add ../myapp-hotfix hotfix/login

# 基于 main 新建分支并检出
git worktree add -b hotfix/crash ../myapp-crash main

# 查看所有工作区
git worktree list

# 修完之后删除工作区
git worktree remove ../myapp-hotfix
```

## 几个注意点

- 同一个分支不能同时在两个工作区检出。
- 所有工作区共享同一份 `.git` 数据，在哪个目录提交，其他目录都能看到。
- `node_modules` 这类依赖每个目录要单独安装，硬盘紧张时要留意。

用了一个月，再也没丢过 stash。
