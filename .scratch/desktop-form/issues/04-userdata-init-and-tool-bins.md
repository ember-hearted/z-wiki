# 04: 首次启动自动初始化首个 Vault 与预打进 rg/fd

- 状态:`done`(commit `704fb5e`,2026-07-03)
- 父 PRD:`.scratch/desktop-form/PRD.md`
- 关联 ADR:`docs/adr/0003-desktop-form.md`(D3 UserDataDir、D4 Vault 起步、D8 rg/fd 预打进)

## What to build

桌面 app 首次启动时,在 UserDataDir 自动初始化运行所需的一切:首个 Vault(从 bundle 内 `kb_example/` 复制)、rg/fd 二进制(从 bundle 铺放到 pi 的 `getBinDir()`)。完成后普通用户首次双击即可用,无需手动建 kb/ 或装工具。

端到端行为:

- 引导配置落 `app.getPath('userData')`(Electron 跨平台可写目录)。
- 首次启动检测 UserDataDir 空(或 config.json 不存在)→ 从 bundle 内 `kb_example/` 复制到首个 Vault 路径(UserDataDir 下或自定义)→ 写 config.json 标记当前 Vault。
- bundle 内带 rg/fd 二进制(`resources/bin/<platform>-<arch>/`),首次启动复制到 `UserDataDir/.pi/agent/bin/`(pi 的 `getToolPath` 优先查此目录)。
- rg/fd 带版本号,启动检测 `getBinDir()` 已有版本不一致则重新铺放(支持后续升级)。
- `PI_OFFLINE=1` 已在切片 3 设,pi 不会尝试下载,必走预打进二进制。

## Acceptance criteria

- [x] UserDataDir 路径用 `app.getPath('userData')`,不写死。
- [x] 首次启动(UserDataDir 空)从 bundle `kb_example/` 复制出首个 Vault,config.json 记录其路径为 currentVault。
- [x] rg/fd 二进制从 bundle `resources/bin/<platform>-<arch>/` 复制到 `UserDataDir/.pi/agent/bin/`。
- [x] rg/fd 带版本号,版本不一致时重新铺放(不是每次都复制)。
- [x] 手动验证:清空 UserDataDir 启动 → 首个 Vault 创建 + rg/fd 铺放 → agent context ready + /api/pages 200 + WS 连上(空 apiKey 壳能起,ADR-0003 决策 4)。
- [x] 二次启动不重复复制(检测已存在且版本一致,rg mtime 不变已验证)。
- [x] `make typecheck` 通过。

## Notes

rg/fd 二进制如何获取放进 bundle(下载脚本?npm 包?)实现期决定 —— 可用 `@biomejs/biome` 类似的 optionalDependencies 按平台拉,或构建脚本从 GitHub releases 下载(开发期,非运行时)。许可证:ripgrep MIT/Unlicense、fd MIT,可商用捆绑。bundle 路径与 electron-builder extraResources 配置在切片 6 协调。

## 实现期决策与偏离

- **新增 `PI_CODING_AGENT_DIR` env 设置(env.ts)**:pi 的 `getBinDir()` 读此 env(默认 `~/.pi/agent`),server 传给 `DefaultResourceLoader` 的 `agentDir` 参数不同步到此 env。必须在 pi SDK import 前设,指向 UserDataDir/.pi/agent,否则 pi 找不到预打进二进制。env.ts 作为 main.ts 第一个 import(ESM 顺序保证)。
- **readConfig 移除 apiKey 启动校验**:原切片 02 契约在 apiKey 空时抛错,导致桌面首次启动(空 apiKey)createServer 崩、壳起不来。改为只校验 provider/model,apiKey 空时 buildAgentContext warn(不阻断),agent 调用时 WS prompt try/catch 捕 LLM 401。符合 ADR-0003 决策 4(空 apiKey 壳能起)。dev 形态行为:空 apiKey 由"退出报错"改为"warn + server 起",正常填 key 形态不受影响。
- **rg/fd 来源用方案 (a)**:`scripts/fetch-tool-bins.ts` 从 GitHub releases 下载到 `desktop/resources/bin/<platform>-<arch>/`,.gitignore(二进制大,clone 后跑脚本拉)。首版覆盖 darwin-arm64(开发机),其他平台脚本支持 `--all`/`--platform`/`--arch`,切片 06 打包用。
- **纯函数拆分 pathUtils.ts**:paths.ts 顶部 import electron,纯 Node 测试环境无法加载。拆出 pathUtils.ts(纯函数 + DesktopPaths 接口),paths.ts 只保留 resolveDesktopPaths。
- **agent 完成一次 grep 的验证**:需真实 apiKey(触发 LLM 调用 → agent 决策 grep → spawn rg)。无 apiKey 时只验证到"server 起 + rg 铺放 + env 设对",pi 用预打进 rg 的逻辑靠源码审查(getToolPath 优先查 getBinDir()/bin)。真实 agent grep 留给用户填 apiKey 后验证。

## Review 发现(待切片 06 处理或记录)

- **问题 3(测试基础设施)**:desktop 端到端测试(`desktopInit.test.ts`)用 `import('@z-wiki/server')` 走包 main(= `server/dist`)。`npm test` 不 rebuild dist,改 `server/src` 后直接跑测试会用旧 dist,可能测到过时代码。** workaround:改 server src 后先 `npm run build -w server` 再跑 desktop 测试**。彻底修:要么 `npm test` 前加 build,要么 desktop 测试改相对 import 走 src(但破坏 D9 单向依赖)。
- **问题 2(测试局限)**:`desktopInit.test.ts` 设的 `PI_CODING_AGENT_DIR` 实际是 no-op —— `npm test` 先跑 server 测试(static import pi),TOOLS_DIR 已固定。env.ts 时序靠代码审查 + 手动 electron 验证,自动化测不到(详见测试文件顶部注释)。
- **问题 7(性能,可接受)**:`ensureFirstRun` + `ensureToolBins` 用同步 fs(cpSync/copyFileSync),首次启动复制 ~7MB rg/fd 阻塞主进程几百 ms。一次性首次启动可接受;若未来 kb_example 变大或加更多二进制,改异步 fs.promises。
- **问题 1(已修)**:`fetch-tool-bins.ts` 的 `findBinary` 原用 shell `find`(win 无此命令),已改 Node `fs.readdirSync` 递归查找,去 shell 依赖。


