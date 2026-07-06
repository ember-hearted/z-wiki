# 01: server 可被外部进程以指定路径嵌入

- 状态:`ready-for-agent`
- 父 PRD:`.scratch/desktop-form/PRD.md`
- 关联 ADR:`docs/adr/0003-desktop-form.md`(D2 in-process、D3 路径两路输入、D6 去 bash)

## What to build

让 layer3 server 能被外部进程以指定的"全局 dir + 当前 Vault dir"嵌入启动,而非写死 `__dirname/../..` 推导的 `PROJECT_ROOT`。这是桌面化的地基:Electron 主进程后续要能 import server 并传不同路径。

端到端行为:

- `buildAgentContext` 接受路径参数(全局 agentDir + 当前 Vault 的 kb 路径),不再依赖模块级 `PROJECT_ROOT` 常量。
- `createInteraction` 接受当前 Vault 路径(或从 agentCtx 携带),内部 `rawDir(...)` 等调用用传入的路径,而非 `PROJECT_ROOT`。
- `index.ts` 的 `start()` 拆出 `createServer()` 导出,返回已注册路由的 Fastify app 实例(未 listen)。`start()` 保留作为 CLI 入口,用默认 `PROJECT_ROOT` 调 `createServer()` 后 listen —— **dev 形态(`npm run dev`)行为完全不变**。
- agent tools 数组移除 `"bash"`(默认 `["read","edit","write","grep","find","ls"]`)。
- `kbLayout.ts` 签名不动(已是 `kbRoot(projectRoot)` 参数化),只改调用方传入的值。

## Acceptance criteria

- [ ] `buildAgentContext` 与 `createInteraction` 的路径来源是参数,不是模块级常量;`PROJECT_ROOT` 不再被这两者直接引用。
- [ ] `createServer()` 从 `index.ts` 导出,返回 Fastify app(未 listen);`start()` 仍可独立跑(dev 形态不变)。
- [ ] agent tools 默认不含 `"bash"`。
- [ ] dev 形态验证:`npm run dev` 起服务,前端 `/api/pages` 与 WS 对话正常,agent 能完成一次 ingest(上传 md → 编译)且不调 bash。
- [ ] 新增测试:用 `app.inject()` 验证 `createServer()` 返回的 app,`/api/health` 返回 ok、`/api/pages` 返回指定 vault 的内容(用临时 vault 目录作 fixture)。
- [ ] `make typecheck` 与 `npm test` 通过。
- [ ] 现有 20 个测试仍通过(无回归)。

## Blocked by

None - can start immediately
