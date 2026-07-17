Status: ready-for-agent

# 自建三档增量更新分发(ADR-0018 实现)

## Problem Statement

z-wiki 桌面 app 终端用户更新时,每次都要下载完整安装包(~210M:Electron runtime + pandoc/rg/fd 二进制 + 152M 第三方依赖 + 项目代码),太大太慢。而其中绝大多数(Electron runtime、工具二进制、第三方依赖)在常规版本更新时根本不变,只有几 M 项目代码变了,却要重下 210M。

ADR-0003 定了"不签名不公证"是持续约束(Out of Scope:mac Apple Developer / Win 代码签名证书)。Electron 生态标准方案 electron-updater 在 mac 上**自动更新要求代码签名**(Squirrel.Mac 替换整个 `.app` bundle 要签名验证),不签名的 mac app 只能退化为"下载完整 dmg + 手动拖拽"--没解决"不用下完整包"的痛点。win nsis 不签名能自动更新,linux AppImage 不需签名,三平台能力不对等。

需要一套不依赖签名的增量更新机制:mac 不签名也能自动更新,常规更新只下几 M,用户全程只点"重启"不碰文件。

## Solution

自建三档增量更新分发 + 覆盖式更新(ADR-0018):

1. **三档包 + 三版本号**:按"会变什么"拆三档,客户端三档比对从重到轻选包,永不交叉:
   - 完整包(~210M,按平台+arch 分):runtime + 工具二进制 + 第三方依赖 + 项目代码。新用户首装 / `baselineVersion` 变时下。
   - 应用包(~45M tar.gz,跨平台):整个 `app/` + `web/dist/`。`depsVersion` 变时下,整体替换 `app/`。
   - 代码包(~5M tar.gz,跨平台):`app/dist` + `app/node_modules/@z-wiki/server` + `web/dist` + `app/package.json`。常规更新(`appVersion` 变)下,覆盖这 4 处。
   - `baselineVersion`(runtime+工具二进制)/ `depsVersion`(第三方依赖 package-lock 指纹)/ `appVersion`(项目代码)三版本号存 `latest.json`,客户端本地存 `.update-state.json` 比对。

2. **覆盖式更新绕过签名**:app 进程下载增量包 -> 解压 -> 覆盖 `Resources/app/` 内文件 -> 重启。不走 Squirrel 的"替换整个 `.app` bundle",不触发 mac Gatekeeper 的 app 替换校验--mac 不签名也能自动更新。

3. **native prebuilds 全平台打进 bundle**:`node_modules` 含 `@mariozechner/clipboard`(8 平台 optionalDependencies 全装)+ `@earendil-works/pi-tui`(全 arch prebuilds),同一 `node_modules` 跨平台可用 -> 应用包/代码包跨平台各 1 个产物,只有完整包按平台分。

4. **linux AppImage 例外**:只读 squashfs 不能覆盖内部,linux 走完整包替换(下新 AppImage 单文件,~178M),不享受增量。首版接受。

## User Stories

1. 作为新用户,我想下载一个完整安装包就能用上 z-wiki,这样首次安装和现在一样简单。
2. 作为 mac 用户,我想 app 自动检查更新并只下载几 M 的代码包,这样常规版本更新不用重下 210M。
3. 作为 win 用户,我想 app 自动下载代码包并静默覆盖,这样更新后重启就是新版本,不用手动操作文件。
4. 作为存量用户,当某次更新只改了项目代码(依赖没变),我想只下 ~5M 代码包,这样更新又快又省流量。
5. 作为存量用户,当某次更新升级了第三方依赖(`depsVersion` 变),我想下 ~45M 应用包整体替换,这样不用下完整 210M 也能更新依赖。
6. 作为存量用户,当 Electron runtime 或 pandoc/rg/fd 升级(`baselineVersion` 变),我想下完整包重新安装,这样基线层升级正确生效(极少发生)。
7. 作为存量用户,我想更新下载失败时 app 不崩溃、提示我重试或手动下载,这样网络抖动不毁掉安装。
8. 作为存量用户,我想覆盖更新失败时 app 能提示下完整包,这样半更新状态不会让 app 起不来。
9. 作为 mac 用户,我没有 Apple Developer 签名,但我想 app 仍能自动更新,这样不签名也不牺牲更新体验。
10. 作为 mac 用户,我从 dmg 直接运行没拖进 Applications,我想 app 检测到写权限不足时提示我拖进 Applications 或下完整包,这样覆盖失败有明确指引。
11. 作为 linux 用户,我想 app 检测到新版时下载新 AppImage 替换,这样 linux 也能(虽是完整包)自动更新。
12. 作为开发者,我想 `make package` 打包时自动产出完整包 + 应用包 + 代码包 + latest.json,这样发版产物一次齐全。
13. 作为开发者,我想包名一眼区分平台+架构+类型,这样 Release 页不会被 `z-wiki-0.1.0.dmg` / `zwiki-setup-0.1.0.exe` 这种歧义名搞混。
14. 作为开发者,我想 `make clean-release` 清理 `release/` 只留当前平台当前 arch 的完整包 + 跨平台 app/code 包,这样发版后本地不堆 3G 其他平台产物。
15. 作为开发者,我想 clean-release 保留 unpacked 缓存,这样下次打包不必从头来(省几分钟)。
16. 作为开发者,我想 latest.json 含三版本号 + 三包的 url/sha512/size,这样客户端能精确决策下哪个包并校验完整性。
17. 作为开发者,我想应用包/代码包用 tar.gz(不是 zip),这样压缩率更好且复用项目已有 tar 解压模式。
18. 作为开发者,我想三档比对逻辑是纯函数可单测,这样版本决策正确性有测试保障,不靠运行时碰运气。
19. 作为开发者,我想打包脚本从 unpacked 抽 code/app 包是纯函数可单测,这样包内容正确性有测试保障。
20. 作为开发者,我想更新检查在 app 启动后台进行,不阻塞用户使用,这样更新不干扰正常工作。
21. 作为用户,我想发现新版本时 app 提示我"更新已就绪,重启生效",这样我点重启就完成更新,不碰文件。
22. 作为用户,我不想 app 未经我同意就自动重启,这样更新时机我掌控(下载可自动,重启我点)。
23. 作为开发者,我想本地 `.update-state.json` 记录已安装的三版本号,这样下次更新比对有基准。
24. 作为开发者,我想代码包覆盖的 4 处路径明确(`app/dist` + `@z-wiki/server` + `web/dist` + `package.json`),这样第三方依赖不被代码包误碰。
25. 作为开发者,我想应用包整体替换 `app/`(含 `node_modules`),这样依赖升级的增删改不用 manifest 处理,整体替换最干净。

## Implementation Decisions

### 决策 1:更新机制 = 自建覆盖式,不走 electron-updater

更新动作 = app 进程下载增量包 -> 解压到临时目录 -> 原子替换 `Resources/app/` 内文件 -> 重启。不走 Squirrel 的"替换整个 `.app` bundle",绕过 mac 签名约束。代价:updater 逻辑(检查/下载/sha512 校验/原子替换/重启/失败降级)自己实现维护。

### 决策 2:三档包 + 三版本号

三档包(完整包/应用包/代码包)+ 三版本号(`baselineVersion`/`depsVersion`/`appVersion`),客户端从重到轻比对:`baselineVersion` 变 -> 完整包;`depsVersion` 变 -> 应用包;只 `appVersion` 变 -> 代码包。永不交叉。拆三档而非"一个增量包":`node_modules` 第三方依赖 152M 不随项目代码变,常规更新带它是浪费;但依赖升级又必须带。三档让常规 5M、依赖升级 45M 各得其所。

三版本号定义:
- `baselineVersion` = Electron 版本 + pandoc/rg/fd 版本组合(随 ADR-0003 D8 预打进二进制版本)
- `depsVersion` = `package-lock.json` 的 sha256 指纹(前 12 位)
- `appVersion` = `desktop/package.json` 的 version

### 决策 3:latest.json 规范

```json
{
  "appVersion": "0.2.0",
  "depsVersion": "a1b2c3d4e5f6",
  "baselineVersion": "0.2.0",
  "packages": {
    "full": {
      "mac-arm64": "https://.../z-wiki-0.2.0-mac-arm64.dmg",
      "mac-x64":   "https://.../z-wiki-0.2.0-mac-x64.dmg",
      "win-x64":   "https://.../z-wiki-0.2.0-win-x64.exe",
      "linux-x64": "https://.../z-wiki-0.2.0-linux-x64.AppImage"
    },
    "app":  { "url": "https://.../z-wiki-app-0.2.0.tar.gz",  "sha512": "...", "size": 45000000 },
    "code": { "url": "https://.../z-wiki-code-0.2.0.tar.gz", "sha512": "...", "size": 5000000 }
  }
}
```

`full` 按平台 map(客户端 `platformArch()` 取键,复用 `desktop/src/pathUtils.ts`),win 用 nsis exe(zip 便携不进自动更新,便携用户手动下新 zip)。`app`/`code` 跨平台单 url。各包均带 `sha512` + `size`(full 的各平台条目也带,实现时补全)。存 GitHub Release assets。

### 决策 4:包命名规范

```
z-wiki-{version}-{os}-{arch}.{ext}      # 完整包(electron-builder ${os}=mac/win/linux)
z-wiki-app-{version}.tar.gz             # 应用包(跨平台)
z-wiki-code-{version}.tar.gz            # 代码包(跨平台)
```

一眼区分:带 `-mac-`/`-win-`/`-linux-` 平台后缀 = 完整包;`-app-` = 应用包;`-code-` = 代码包。改 `desktop/electron-builder.yml` 各 target 的 `artifactName` 为 `z-wiki-${version}-${os}-${arch}.${ext}`(统一,解决现状 `z-wiki-0.1.0.dmg` 不知 x64、`zwiki-setup-0.1.0.exe` 不知平台的问题)。

### 决策 5:打包脚本(从 unpacked 抽 code/app 包 + 生成 latest.json)

新增打包脚本(electron-builder 打包后衔接,`make package` 末尾调):
- 输入:`release/<plat>-unpacked/resources/` + 三版本号
- `buildCodePatch`:抽 `app/dist` + `app/node_modules/@z-wiki/server` + `web/dist` + `app/package.json` -> `z-wiki-code-{ver}.tar.gz`
- `buildAppBundle`:抽整个 `app/` + `web/dist/` -> `z-wiki-app-{ver}.tar.gz`
- `buildManifest`:算各包 sha512 + size + 三版本号 -> `latest.json`
- prior art:`scripts/fetch-tool-bins.ts`(打包流程)+ tar 命令复用(`server/src/pandocManager.ts:76`、`scripts/fetch-tool-bins.ts:127` 的 `tar -xf`)

### 决策 6:客户端 updater

新增 updater 模块(`desktop/src/updater.ts`),接入 `main.ts` 的 `bootstrap`:
- 启动后台(不阻塞)fetch `latest.json`
- `selectUpdatePackage(localState, remoteManifest)` 纯函数决策下哪档
- 下载对应包到 `userData/update-cache/`
- sha512 校验
- 解压到临时目录
- 原子替换:mac/linux 重命名(`app/` -> `app.old`,新 -> `app/`,重启后清 `app.old`);win 重启时早期替换(避开 `.node` 锁定)
- 更新本地 `.update-state.json` + 提示重启
- 失败降级:覆盖失败提示下完整包;mac translocation(非 Applications)提示拖进 Applications
- 本地状态存 `userData/.update-state.json`(`{appVersion, depsVersion, baselineVersion}`)

prior art:`desktop/src/toolBins.ts`(版本比对 + 铺放模式,`ensureToolBins`)+ `server/src/pandocManager.ts`(tar 解压 + ensure 模式)。

### 决策 7:clean-release

`Makefile` 加 `clean-release` target,调 `planCleanRelease(releaseDir, currentPlatArch)` 纯函数:
- 保留:当前 arch 完整包 + blockmap、`z-wiki-app-*.tar.gz`、`z-wiki-code-*.tar.gz`、`latest.json`、unpacked 缓存(`mac/`/`*-unpacked/`)
- 删除:其他平台/arch 的完整包 + blockmap
- 当前 arch 从 `process.platform` + `process.arch` 算(复用 `desktop/src/pathUtils.ts` 的 `platformArch()`)

### 决策 8:linux 走完整包替换,不享受增量

AppImage 只读,updater 对 linux 走"下新 AppImage 单文件替换"路径(完整包),不覆盖 `app/`。`selectUpdatePackage` 对 linux 总是选 full(即使 `appVersion`/`depsVersion` 有差异)。首版接受 linux 下 ~178M。

### 决策 9:更新检查时机与体验

app 启动后后台 check(不阻塞 `bootstrap`),发现新版 -> 自动下载(后台)-> 下载完成弹"更新已就绪,重启生效" -> 用户点重启 -> app 替换 + 重启。下载自动,重启用户点(不经同意不自动重启)。无新版静默。和 Chrome/VSCode 自动更新体验一致。

## Testing Decisions

### 测试原则

只测纯函数外部行为(版本决策、包内容、清理清单),不测实现细节。IO(下载/解压/替换/重启)不单测,靠 typecheck + 手动验证--和 toolBins"实际 bundle 铺放端到端不测"一致(ADR-0018 验证边界已注明)。

### Seam 1 - updater 决策纯函数

`selectUpdatePackage(localState, remoteManifest) -> UpdatePlan`,prior art:`toolBins.ts` 的 `needsRelayout`(版本比对纯函数)+ `toolBins.test.ts` 的 mkdtemp 模式。测:
- 三档各变一档(`baselineVersion` 变 -> full / `depsVersion` 变 -> app / `appVersion` 变 -> code)
- 无更新 -> none
- 多档同时变(如 `depsVersion` + `appVersion` 都变)-> 选重的(app)
- `baselineVersion` 落后 -> full(即使 `appVersion` 也变)
- linux 平台 -> 总是 full

### Seam 2 - 打包脚本纯函数

`buildCodePatch` / `buildAppBundle` / `buildManifest`,prior art:`fetch-tool-bins.ts` + `toolBins.test.ts` mkdtemp。测:mock unpacked 结构(造 `app/dist` + `app/node_modules/@z-wiki/server` + `web/dist` + 假 `node_modules`),验证:
- code 包只含 4 处路径(不含第三方 `node_modules`)
- app 包含整个 `app/`(含 `node_modules`)+ `web/dist/`
- manifest 三版本号 + sha512 + size 正确
- sha512 与实际包内容匹配

### Seam 3 - clean-release 纯函数

`planCleanRelease(releaseDir, currentPlatArch) -> {keep[], delete[]}`,prior art:`toolBins.test.ts` mkdtemp。测:造假 `release/`(各平台完整包 + app/code 包 + `latest.json` + unpacked 目录),验证:
- 当前 arch 完整包 + blockmap 保留
- 其他平台完整包 + blockmap 删除
- app/code 包 + `latest.json` 保留
- unpacked 目录保留

### 不测

- 网络下载:mock fetch 难且无价值,靠手动。
- tar 解压:复用 `pandocManager`/`fetch-tool-bins` 已验证的 tar 命令,不重复测。
- 原子替换 + 重启时序:文件系统 + 跨进程,靠手动验证各平台(mac 重命名 / win 退出后替换 / linux AppImage 替换)。
- bundle 写权限边界(mac translocation):靠手动 + 降级提示。

## Out of Scope

- **签名公证**:ADR-0003 Out of Scope,本特性绕过而非解决签名。
- **electron-updater**:明确不用(ADR-0018 被否备选)。
- **linux 增量**:AppImage 只读,首版走完整包替换(决策 8)。linux 改 tar 目录形态或 AppImageUpdate 是未来选项。
- **文件级 diff 增量包**:被否(`node_modules` 增删改 manifest + 回滚复杂,ADR-0018)。
- **更新通道(stable/beta)**:首版只有 stable,不区分通道。
- **自建更新服务器**:用 GitHub Release(静态 `latest.json` + assets),不自建分发服务器。
- **增量下载(block-level)**:不做 blockmap 差量下载,整包下载(代码包 5M 已够小)。
- **自动回滚**:覆盖失败降级到"提示下完整包",不做自动回滚到旧版(首版简化)。
- **win zip 便携包自动更新**:zip 便携版用户手动下新 zip 替换,不进自动更新(full 的 win-x64 用 nsis exe)。
- **@z-wiki/server 打包带 src/ 问题**:现 server 把 `src/`/`tsconfig.json` 也打进 bundle,代码包会多带几 M 源码。应修 server `package.json` 的 `files` 字段排除 `src/`,但属既有打包问题,单独处理,不阻塞本特性(代码包仍可用,只是多带 src)。

## Further Notes

- **依赖 ADR-0003 D8**:`baselineVersion` 含预打进工具二进制版本(rg/fd/pandoc),与 `toolBins.ts` 的 `version.json` 同源。工具二进制升级 = `baselineVersion` 变 = 发新完整包。
- **native prebuilds 跨平台**:`@mariozechner/clipboard`(8 平台 optionalDependencies 全装)+ `@earendil-works/pi-tui`(全 arch prebuilds)使同一 `node_modules` 跨平台,应用包/代码包各 1 个产物。代价:`node_modules` 含冗余其他平台 `.node` 文件(可忽略)。
- **代码包覆盖 4 处路径**:`app/dist`(desktop 主进程)+ `app/node_modules/@z-wiki/server`(server 代码)+ `web/dist`(前端)+ `app/package.json`(版本号)。第三方依赖(`app/node_modules` 其他)归应用包,代码包不碰。
- **win 替换时序**:win 上 native 模块(`.node`)加载后可能锁定文件,代码包/应用包替换需"退出后由 updater 替换再重启"或重启时早期替换(`main.js` 最先检测 cache 并替换,此时旧代码可能仍占 inode 但 win 允许重命名)。实现时验证。
- **mac 替换**:unix inode 机制,运行中可重命名 `app/` -> `app.old`,新目录 -> `app/`,重启后用新代码,清理 `app.old`。不签名 app 改自己 `Resources` 不触发 Gatekeeper。
- **ADR-0018 已落**:`docs/adr/0018-self-hosted-incremental-update.md` 记录架构决策,`CONTEXT.md` 加"桌面分发"术语簇。本 PRD 是其实现 spec。
- **prior art 一致性**:updater 的"版本比对 + 铺放"复用 `toolBins.ts` 模式(`ensureToolBins`),tar 解压复用 `pandocManager.ts`,打包复用 `fetch-tool-bins.ts`。不引入新机制,风格与现有桌面初始化代码一致。
