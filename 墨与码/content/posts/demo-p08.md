---
title: "磁盘满了？我的四步排查法"
date: "2026-06-26T09:45:00.000Z"
tags: ["Linux","运维"]
---

服务器报警：磁盘使用率 100%。下面是我每次排查都会走一遍的流程。

## 第一步：看哪个分区满了

```bash
df -h
```

## 第二步：找出大目录

```bash
sudo du -h --max-depth=1 /var | sort -h
```

一层层往下找，通常很快就能定位到日志或缓存目录。

## 第三步：删了文件，空间却没释放

如果删掉了大文件，`df` 显示的占用却没变，多半是还有进程开着它：

```bash
sudo lsof +L1
```

找到对应的进程，重启它，空间才会真正释放。

## 第四步：清理 systemd 日志

```bash
sudo journalctl --disk-usage
sudo journalctl --vacuum-size=500M
```

清理完别忘了给日志配置轮转，不然下个月还会再满一次。
