# 05: 设置页(Vault 切换 + API key 配置)端到端闭环

- 状态:`done`
- 父 PRD:`.scratch/desktop-form/PRD.md`
- 关联 ADR:`docs/adr/0003-desktop-form.md`(D4 多 Vault、D5 禁切库、D7 切库闭环、D3.1 config.json 读写)

## What to build

web SPA 加 `/settings` 路由,提供 API key 填写与 Vault 切换/新建 UI;server 加切库端点与 WS 事件。完成后用户可在设置里管理 API key 与知识库,切库端到端闭环(前端清空重连 + 后端换 KB + ingest 中禁切)。

端到端行为:

- server 新增 `POST /api/vault/switch`(带目标 Vault 路径):查活跃 ingest → 有则 409;无则更新当前 Vault 路径 → 向所有 chatClients 推 `vault_changed` 事件(带新 Vault 元信息)→ `socket.close()` 所有连接(复用现有 `on("close")` 的 `session.dispose()`)→ 重建 buildView。
- server 暴露活跃 ingest 状态(布尔/计数,`interaction.ts` 已持有 ingest session)。
- server 新增 `GET /api/vaults`(返回已知 Vault 列表 + 当前)、`POST /api/vault`(新建空 Vault,从 kb_example 复制)。
- server 新增 `PUT /api/config/apikey`(写 config.json 的 apiKey 字段,运行时重新注入)。
- web `/settings` 路由:API key 输入框(写 config.json)、Vault 列表 + 切换按钮 + 新建按钮;切库时前端收 `vault_changed` → 清空消息列表 → 自动重连 WS → 重拉 `/api/pages`;ingest 中切库按钮禁用并提示。

## Acceptance criteria

- [ ] `POST /api/vault/switch` 存在,活跃 ingest 时返回 409,否则切换并推 `vault_changed`。
- [ ] 切库时所有 chatClients 的 WS 被关闭,旧 session 经现有 `on("close")` dispose(不新写 session 关闭代码)。
- [ ] 切库后 buildView 重建,`/api/pages` 返回新 Vault 内容。
- [ ] 活跃 ingest 状态可查(切库前检查)。
- [ ] `GET /api/vaults` 返回 Vault 列表 + 当前;`POST /api/vault` 新建空 Vault(从 kb_example 复制)并加入列表。
- [ ] `PUT /api/config/apikey` 写 config.json 并运行时重新注入 apiKey。
- [ ] web `/settings` 路由存在:可填 API key、看 Vault 列表、切库、新建 Vault。
- [ ] 切库前端处理:收 `vault_changed` → 清空消息 → 重连 WS → 重拉 pages,且区分"切库重连"与"崩溃重连"。
- [ ] ingest 中切库按钮禁用并提示"有上传正在处理,请等待完成"。
- [ ] 测试:`app.inject()` 验证 switch → 409/200、`/api/pages` 切换后返回新内容;WS 客户端验证收到 `vault_changed`。
- [ ] `make typecheck` 与 `npm test` 通过,无回归。

## Blocked by

- `03-electron-shell-runs.md`(设置页要在 app 里测)
- `04-userdata-init-and-tool-bins.md`(Vault 起步与 UserDataDir 就绪)

## Notes

agent context(`buildAgentContext`)是全局单例,不随切库重建;只重建 chat session(绑 KB cwd)。chat session 是 per-WS-connection(非单例,现有 `interaction.ts:194-229` 注释"常驻"为误导),切库复用断开清理机制,不改单例。

## Comments

- 2026-07-03 完成,commit `7b0d8b7`。D7 重构(kbRoot 从 AgentContext 挪到 createChatSession 显式参数)+ 切库端点(POST /api/vault/switch 等)+ 设置页(/settings 路由 + Settings.tsx)+ useChat vault_changed 处理(切库重连/崩溃重连区分)。11 个 vault 测试覆盖 switch 200/400/409、pages 切换、WS vault_changed;npm test 66 过,typecheck 通过,无回归。手动验收(桌面 app 填 key/切库/ingest 中禁切)待切片 06 打包后跑。
