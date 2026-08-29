# @ember-hearted/z-wiki

z-wiki 的**浏览器形态(webui)**:本机跑一个 Fastify server,浏览器打开本地地址使用;数据仍在本机。
(三层架构:layer1 `kb/` 数据 / layer2 `web/` SPA / layer3 `server/` Fastify+pi agent。)

## 要求

- Node.js >= 20(npm 随 Node 安装)

## 用法

```bash
# 推荐:显式设数据目录,再一键启动
export ZWIKI_HOME=~/.z-wiki        # PowerShell: $env:ZWIKI_HOME="$HOME\.z-wiki"
npx z-wiki-web                     # 起 server 并自动开浏览器(http://127.0.0.1:3000)

# 或全局安装后直接用
npm i -g @ember-hearted/z-wiki
z-wiki-web
```

首次启动若数据目录下没有 `kb/`(知识库),会从包内 `kb_example/` 自动初始化。未设 `ZWIKI_HOME` 时,数据根按顺序落到:`ZWIKI_HOME` → 桌面版 UserDataDir(若装过桌面版) → 包安装目录。

## 环境变量

- `ZWIKI_HOME` —— 数据根(`config.json` / `kb` / `.pi/agent` 均从它派生)。推荐显式设置。
- `ZWIKI_OPEN_BROWSER` —— `0`/`off` 关掉自动开浏览器,缺省开。
- `PORT` —— 端口,缺省 `3000`。`HOST` 缺省 `127.0.0.1`(仅 loopback)。
