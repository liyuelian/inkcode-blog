---
title: "我的终端配置：zsh、fzf 和几个别名"
date: "2026-09-23T09:05:00.000Z"
tags: ["工具","Linux"]
---

换了新电脑，顺便整理一下终端配置。没有装大而全的框架，只留下真正每天都用的东西。

## fzf

模糊搜索工具。装好之后按 `Ctrl+R` 搜索历史命令，比默认的好用太多。

```bash
brew install fzf
```

安装完按提示启用快捷键即可。

## 几个别名

```bash
alias gs='git status -sb'
alias gl='git log --oneline --graph -20'
alias ll='ls -lah'
alias ..='cd ..'

# 新建目录并进入
mkcd() { mkdir -p "$1" && cd "$1"; }
```

## 提示符

只显示当前目录和 Git 分支，不要花哨的图标。信息越少，越容易一眼看到重点。
