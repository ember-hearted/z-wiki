# ADR-0018: 自建三档增量更新分发(不走 electron-updater)

- 状态:accepted
- 日期:2026-07-17
- 范围:桌面 app 终端用户自动更新机制、分发包结构、包命名规范、clean-release
- 关联:resolves ADR-0003"未决:自动更新策略待定";extends ADR-0003 D8(预打进二进制);遵守 ADR-0003"不签名不公证"约束

## 背景

ADR-0003 末尾"未决"留了"自动更新(electron-updater)策略待定,不影响首版可运行"。终端用户痛点:每次更新下完整安装包(~210M)太大。但 ADR-0003 定了"不签名不公证"是持续约束(Out of Scope:mac Apple Developer / Win 代码签名证书),不是临时状态。

electron-updater 是 Electron 生态标准方案(blockmap 差量下载 + Squirrel 替换),但在 mac 上**自动更新要求代码签名**--Squirrel.Mac 替换整个 `.app` bundle 要签名验证,不签名的 mac app 无法自动安装新版,只能退化为"下载完整 dmg + 手动拖拽"。这恰恰没解决"不用下完整包"的痛点。win nsis 不签名能自动更新(SmartScreen 警告而已),linux AppImage 不需要签名,三平台能力不对等。

要绕过签名约束让 mac 也能增量自动更新,必须放弃"替换整个 app bundle"的机制,改用 app 进程写自己 bundle 内部文件的方式。

## 决策

### D1: 不走 electron-updater,自建覆盖式更新

更新动作 = app 进程下载增量包 -> 解压 -> 覆盖 `Resources/app/` 内的文件 -> 重启。不走 Squirrel 的"替换整个 `.app` bundle",因此不触发 mac Gatekeeper 的 app 替换校验--**不签名也能 mac 自动更新**。这是放弃 electron-updater 的核心理由:不签名约束下,只有覆盖式更新让 mac 享受增量。

代价:updater 逻辑(检查/下载/sha512 校验/原子替换/重启)自己实现维护,electron-updater 那套现成的不要了。

### D2: 三档包 + 三版本号

按"会变什么"拆三档,客户端三档比对从重到轻选包,永不交叉:

| 触发 | 下载 | 覆盖动作 | 频率 |
|---|---|---|---|
| `baselineVersion` 变(runtime/工具二进制升级) | 完整包 ~210M | 重新安装(dmg/nsis/AppImage) | 极少 |
| `depsVersion` 变(第三方依赖升级) | 应用包 ~45M | 整体替换 `app/` + `web/dist/` | 偶尔 |
| 只 `appVersion` 变(项目代码改动) | 代码包 ~5M | 覆盖 4 处路径 | 常规 |

三档包:

- **完整包(Full Bundle)** -- runtime + 工具二进制 + 第三方依赖 + 项目代码,按平台+arch 分(dmg/exe/AppImage)。= 现有 electron-builder 产物。新用户首装、`baselineVersion` 变时下。
- **应用包(App Bundle)** -- 整个 `app/` + `web/dist/` 的 tar.gz,跨平台(D5)。`depsVersion` 变时下,整体替换 `app/` 目录(含 `node_modules`),不用处理内部增删改。
- **代码包(Code Patch)** -- 仅项目代码:`app/dist` + `app/node_modules/@z-wiki/server` + `web/dist/` + `app/package.json`,tar.gz,跨平台。常规更新下,覆盖这 4 处路径,不碰第三方依赖。

三版本号(存 `latest.json`,客户端本地存 `.update-state.json` 比对):

- **baselineVersion** -- runtime + 工具二进制(Electron/pandoc/rg/fd)版本组合。变则下完整包。
- **depsVersion** -- 第三方依赖版本(`package-lock.json` 指纹)。变则下应用包。
- **appVersion** -- 项目代码版本(`package.json` version)。变则下代码包。

拆三档而非"一个增量包"的理由:`node_modules` 第三方依赖 152M(@earendil-works/@mistralai/openai/@anthropic-ai 等 LLM SDK),不随项目代码更新而变,只有依赖升级才变。常规更新(只改 server/desktop/web 代码)只有 ~7M 项目代码变动,带 152M 依赖是浪费;但依赖升级时又必须带变化的依赖。三档让常规 5M、依赖升级 45M、各得其所。

### D3: app/code 包用 tar.gz(不用 zip)

- 压缩率优于 zip(node_modules 大量小 JS 文件,55M->45M,7M->5M)。
- 复用项目现有 tar 解压模式(`server/src/pandocManager.ts:76`、`scripts/fetch-tool-bins.ts:127` 都用 `tar -xf`),客户端 updater 用同一套 `execFile('tar', ['-xzf', ...])`。
- 三平台都有 tar:mac/linux 原生,win10+ 自带 `tar.exe`(项目 pandoc 解压已在 win 上调 tar,已假定可用)。
- 流式解压适合整体替换场景,不需要 zip 的随机访问。

zip 的唯一优势是 win 用户双击解压,但这两个包是客户端程序化解压,不靠用户双击,优势用不上。

### D4: 包命名规范

```
z-wiki-{type?}-{version}[-{os}-{arch}].{ext}
```

| 包 | 命名 | 数量 |
|---|---|---|
| 完整包 | `z-wiki-${version}-${os}-${arch}.${ext}` | 5(mac-arm64/mac-x64/win-x64.exe/win-x64.zip/linux-x64) |
| 应用包 | `z-wiki-app-${version}.tar.gz` | 1(跨平台) |
| 代码包 | `z-wiki-code-${version}.tar.gz` | 1(跨平台) |

一眼区分:**带 `-mac-`/`-win-`/`-linux-` 平台后缀 = 完整包;`-app-` = 应用包;`-code-` = 代码包**。electron-builder 的 `${os}` token 就是 mac/win/linux(与 `process.platform` 的 darwin/win32/linux 不同),正好用作平台标识。

实现:完整包改 `desktop/electron-builder.yml` 各 target 的 `artifactName`;应用包/代码包由自定义打包脚本从 `<plat>-unpacked/resources/` 抽出打 tar.gz(electron-builder 不直接产)。

### D5: native prebuilds 全平台打进 bundle,应用包/代码包跨平台

`node_modules` 含 native 模块(`@mariozechner/clipboard-*` 8 平台 optionalDependencies 全装、`@earendil-works/pi-tui` darwin/win 全 arch prebuilds 全含),但全部平台 prebuilds 都打进来了,同一 `node_modules` 跨平台跨 arch 可用。

故应用包(含 `node_modules`)和代码包(纯 JS)都跨平台,各 1 个产物,不分平台。只有完整包按平台+arch 分(Electron runtime + pandoc/rg/fd 是平台相关)。

代价:`node_modules` 含冗余 prebuilds(其他平台的 .node 文件),相对 158M 总量可忽略,换"应用包/代码包各 1 个"的简化值得。

### D6: linux AppImage 走完整包替换,不享受增量

AppImage 是只读 squashfs 镜像,不能覆盖内部文件,覆盖式更新(D1)对 linux 无效。linux 更新 = 下新 AppImage 单文件替换(~178M),走完整包路径。

首版接受 linux 不享受增量。用户多了可考虑:linux 改 tar 目录形态(解压后可覆盖,牺牲单文件便携)或引入 AppImageUpdate(zsync 差量,又一个机制)。

### D7: clean-release 保留当前 arch 完整包 + app/code 包 + unpacked 缓存

`make clean-release` 自动检测当前 `platform+arch`(复用 `desktop/src/paths.ts` 的 `platformArch()`),按命名模式 `z-wiki-*-{plat}-{arch}.*` 过滤:

- **保留**:当前 arch 完整包 + blockmap、应用包、代码包、latest.json、unpacked 缓存(`mac/`/`*-unpacked/` 等,加速下次打包)
- **删除**:其他平台/arch 的完整包 + blockmap

app/code 包不带平台后缀,不匹配删除模式,自动保留。unpacked 缓存保留(3G 换下次打包速度)。

## 被否备选

- **electron-updater + blockmap**:mac 不签名无法自动更新(Squirrel.Mac 替换 `.app` bundle 要签名验证),退化到"下完整 dmg + 手动拖拽",没解决痛点。且不签名是 ADR-0003 持续约束,不是临时状态。
- **自建文件级 diff 增量包**(只带 v0.1->v0.2 变化的文件):`node_modules` 增删改要 manifest + 客户端按清单删+覆盖 + 回滚,嵌套依赖树 diff 易错,踩坑成本高于省的流量。
- **整个 `app/` 替换不分档**(一种增量包 ~45M):常规更新(只改代码)也下 45M,白带 152M 没变的第三方依赖,浪费。代码包 5M 才是常规更新该下的。
- **app/code 包用 zip**:压缩率不如 tar.gz,且项目已有 tar 解压模式,zip 要额外引入解压库或命令。

## 后果

- **更新体验**:app 后台 fetch `latest.json` -> 自动下载对应包 -> 解压 -> 原子替换 -> 提示重启。用户全程只点"重启",不碰文件。mac/win 不签名自动更新可行;linux 换完整 AppImage(178M)。
- **更新量**:常规 5M / 依赖升级 45M / runtime 升级 210M。永不交叉(依赖没变绝不下 45M,代码改动绝不下 210M)。
- **自建 updater 维护成本**:检查/下载/sha512 校验/原子替换(重命名)/重启/失败降级(覆盖失败提示下完整包)需自己实现。win 上 native 模块(.node)加载后可能锁定文件,替换需"退出后由 updater 替换再重启"或重启时早期替换。
- **新增打包脚本**:从 `<plat>-unpacked/resources/` 抽 code/app 包 + 生成 `latest.json`(含三版本号 + 三包 url/sha512/size)。`make package` 后衔接。
- **`desktop/electron-builder.yml`**:各 target `artifactName` 改 `z-wiki-${version}-${os}-${arch}.${ext}`(统一平台+arch 标识)。
- **`Makefile`**:加 `clean-release` target(D7)。
- **`CONTEXT.md`**:新增"桌面分发"术语簇(完整包/应用包/代码包/baselineVersion/depsVersion/appVersion/覆盖式更新)。
- **native prebuilds 冗余**:`node_modules` 含全平台 prebuilds,应用包跨平台但带冗余 .node 文件(可接受)。
- **linux 增量缺失**:AppImage 只读,linux 用户更新下 178M 完整包(D6,首版接受)。
- **bundle 写权限风险**:mac translocation(从 dmg 直接运行不拖进 Applications)等场景覆盖 `app/` 可能失败,需降级提示"拖到 Applications"或"下完整包"。

## 验证/测试边界

- **打包脚本单测**:mock unpacked 结构,验证抽出的 code/app 包内容 + `latest.json` 三版本号 + sha512。
- **updater 三档比对纯函数单测**:`baselineVersion`/`depsVersion`/`appVersion` 各变一档的选包逻辑。
- **原子替换**:难单测(文件系统 + 重启时序),靠 typecheck + 手动验证各平台。
- **覆盖流程跨平台差异**(mac 重命名 / win 退出后替换):靠运行时验证。
