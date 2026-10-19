# 墨与码

技术博客与小说网站。部署在 GitHub Pages 上，不需要服务器；用手机后台写作，点「发布」后 GitHub 自动生成网站，一两分钟后上线。

## 一、部署（第一次，三步）

前两步在电脑上做，第三步在手机上做。

### 第 1 步：新建仓库，打开 GitHub Pages

1. 登录 GitHub，点右上角「+」→「New repository」。
2. 填一个仓库名，比如 `blog`；选 **Public**；勾选「Add a README file」；点「Create repository」。
3. 进入仓库的「Settings」→ 左侧「Pages」，把「Source」改成 **GitHub Actions**。

### 第 2 步：上传文件

1. 回到仓库首页，点「Add file」→「Upload files」。
2. 把压缩包解压后，**里面的全部文件和文件夹**拖进去（不是拖外层的「墨与码」文件夹），点「Commit changes」。
3. 上传后网站会自动生成。一两分钟后打开 `https://你的用户名.github.io/仓库名/` 就能看到。

> **Mac 用户注意**：`.github` 文件夹默认是隐藏的，直接全选会漏掉它，网站就不会自动生成。拖之前在访达里按 `Command + Shift + .` 显示隐藏文件，再全选拖进去。Windows 不用管这一步。

### 第 3 步：在手机上连接后台

1. 用手机打开 `https://你的用户名.github.io/仓库名/admin/`。
2. 点「去 GitHub 创建令牌」。GitHub 会打开一个已经填好的页面，你只需要：
   - 在「Repository access」里选「Only select repositories」，选中这个网站的仓库；
   - 点页面底部的「Generate token」，复制生成的令牌。
3. 回到后台，把令牌粘贴进去，点「连接」。
4. 添加到桌面：iPhone 用 Safari 点分享按钮，选「添加到主屏幕」；安卓用 Chrome 在菜单里选「添加到主屏幕」或「安装应用」。

完成。之后从桌面图标打开就能写作。令牌只保存在这台手机上；手机丢了，到 GitHub 的「Settings → Developer settings → Personal access tokens」里把它删掉即可。

### 遇到问题

- **打开网站显示 404**：到仓库的「Actions」页面看看「生成并发布网站」有没有运行。如果列表是空的，说明 `.github` 文件夹没传上去，按上面的提示补传；如果显示失败，点进去看原因。
- **点「去 GitHub 创建令牌」后页面没有预先填好**：手动设置权限：「Contents」选「Read and write」，「Actions」选「Read-only」，其余不用动。

## 二、日常使用

网站的完整使用说明在网站上的「使用指南」系列文章里。简单说：

- **写文章**：后台右下角「写博客」，写完点「发布」。
- **存草稿**：点「存草稿」，内容提交到仓库但不出现在网站上，换设备也能接着写。注意仓库是公开的，草稿别人也能看到。
- **写小说**：后台「写作 → 小说」，新建作品、写章节、分卷。
- **看进度**：提交后后台底部会显示「正在生成网站」，完成后变成「已上线」。

## 三、仓库里的文件

```
content/
├── site.json                    网站设置
├── posts/<编号>.md               文章
└── novels/<编号>/
    ├── novel.md                 小说信息，正文部分是简介
    └── chapters/<编号>.md        章节
static/images/                   图片
theme/                           页面样式和读者端脚本
admin/                           手机后台
scripts/build.js                 生成网站的脚本
.github/workflows/deploy.yml     自动生成并发布网站
```

文章文件开头的 `---` 之间是标题、日期、标签等信息，下面是 Markdown 正文。在电脑上用任何编辑器改这些文件、提交到仓库，网站同样会自动更新。

```markdown
---
title: "文章标题"
date: "2026-10-07T08:00:00.000Z"
tags: ["前端","笔记"]
series: "系列名（可选）"
pinned: true
draft: true
---

正文……
```

`pinned`（置顶）、`draft`（草稿）不需要时可以不写。这里的值用 JSON 写法，字符串要加双引号。

## 四、可选设置

### 绑定自己的域名

在仓库「Settings → Pages → Custom domain」填上域名，并按提示在域名服务商那里添加 DNS 记录。网站里的链接会自动按新域名生成，不用改代码。

### 修改时区

日期按 `content/site.json` 里的 `timezone` 显示，默认 `Asia/Shanghai`。

### 不加载网页字体

在 `content/site.json` 里加上 `"fontBase": ""`，网站只用设备自带的字体。适合读者主要在国内、Google 字体加载慢的情况。

### 在电脑上预览

需要 Node.js 18 或更高版本：

```bash
npm install
npm run dev
```

然后打开 `http://localhost:4000`。

## 五、迁移内容

仓库里已经包含之前网站上的全部文章、小说和图片。如果之后又在旧网站上写了新内容，在旧网站下载完整备份（.json），然后任选一种方式导入：

- 在手机后台「写作 → 备份 → 从备份恢复」里选这个文件。
- 在电脑上运行 `npm run import 备份文件.json`，再把改动提交到仓库。

## 六、注意事项

- **国内访问**：`github.io` 的域名在中国大陆时快时慢。如果读者主要在国内，可以把同一个仓库连接到 Cloudflare Pages 这类平台：构建命令填 `npm install && node scripts/build.js`，输出目录填 `dist`，再设置环境变量 `SITE_URL` 为网站地址。
- **容量**：GitHub Pages 网站最大 1GB。照片上传前会自动压缩，一般每张 200KB 以内。
- **构建失败**：在仓库「Actions」页面点开失败的那次运行，可以看到原因。
