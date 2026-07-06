# 03: Electron 桌面壳能跑(in-process server + 窗口 + 静态 serve)

- 状态:`done`(commit `2e4c8c9`)
- 父 PRD:`.scratch/desktop-form/PRD.md`
- 关联 ADR:`docs/adr/0003-desktop-form.md`(D1 Electron、D2 in-process、D2.1 同端口 serve、D9 desktop/ 包)

## What to build

新建 `desktop/` 顶层 workspace 包,Electron 主进程嵌入 server、开窗口显示 SPA。完成后"双击即用桌面 app"形态成立(此切片用 dev 模式跑,打包在切片 6)。

端到端行为:

- `package.json` workspaces 加 `"desktop"`;`desktop/` 有自己的 package.json(electron 依赖)、tsconfig、main 入口。
- 主进程启动时:`process.env.PI_OFFLINE = "1"`(在 `buildAgentContext` 之前)→ `import { createServer, buildAgentContext } from "@z-wiki/server"` → 调 `createServer()` 拿 app → `app.listen({port:0})` 取随机端口 → `new BrowserWindow` → `loadURL('http://127.0.0.1:<port>/')`。
- server 加 `@fastify/static` serve `web/dist`(prod 静态资源),SPA + API 同源,前端相对路径 fetch 零改造。
- 关窗口 = 退出 app(Electron 默认行为,确认所有窗口关闭时 quit);窗口尺寸/位置记忆(用 `electron` 的 bounds 持久化或写 config.json 偏好)。
- 依赖方向单向:`desktop/` 只 import `createServer`/`buildAgentContext`,不深入 server 内部模块。

## Acceptance criteria

- [ ] `desktop/` 包存在,有自己的 package.json(electron 依赖)、tsconfig、main 入口;`package.json` workspaces 含 `desktop`。
- [ ] 主进程设 `PI_OFFLINE=1` 在 server 启动之前。
- [ ] 主进程调 `createServer()` 在主进程内 listen 随机端口,端口经 IPC/loadURL query 注入渲染进程。
- [ ] server 用 `@fastify/static` serve `web/dist`,渲染进程 `loadURL('http://127.0.0.1:<port>/')` 显示 SPA。
- [ ] 关窗口退出 app,无遗留进程。
- [ ] 窗口尺寸/位置重启后保留。
- [ ] `npm run dev`(原 server+web concurrently)不受影响,仍正常工作。
- [ ] 手动验证:启动 desktop app,窗口出现显示首页,`/api/pages` 数据加载,WS 对话能进行。

## Blocked by

- `01-server-embeddable.md`(createServer 导出)
- `02-config-json-source-of-truth.md`(config.json 提供 apiKey,否则 agent 不可用)

## Notes

此切片用 dev 模式跑(可能 `web/dist` 需先 `npm run build -w web` 产出,或 dev 下 BrowserWindow 直接 loadURL vite dev server —— 实现期决定,但 prod 形态必须是同端口 serve 静态资源)。打包(electron-builder 三平台产物)在切片 6。
