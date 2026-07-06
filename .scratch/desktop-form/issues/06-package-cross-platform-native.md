# 06: 打包 + 跨平台 + 原生体验

- 状态:`ready-for-agent`
- 父 PRD:`.scratch/desktop-form/PRD.md`
- 关联 ADR:`docs/adr/0003-desktop-form.md`(D1 跨平台、D6 win 兼容说明、D8 rg/fd 按平台)

## What to build

用 electron-builder 产出 Windows/Linux/Mac 三平台可运行包,并补齐原生桌面体验(菜单、拖拽上传、右键菜单)。完成后普通用户能拿到双击即用的安装包/可执行文件。

端到端行为:

- electron-builder 配置:mac(dmg)/ win(nsis)/ linux(AppImage);extraResources 按平台过滤 rg/fd 二进制 + `kb_example/` 样板进 bundle。
- build 流程:`npm run build -w web` 产 `web/dist` → `npm run build -w server` 产 `server/dist` → electron-builder 打包 desktop。
- 原生菜单:mac 顶部菜单定制(应用菜单 + Edit/View/Window/Help,去掉 Electron 占位无意义项);win/linux 标题栏符合习惯。
- 文件拖拽上传:窗口接收文件拖拽 → 走现有 `POST /api/upload`(Fastify multipart),不新写上传逻辑。
- 右键菜单:符合桌面习惯(替代浏览器默认右键)。
- win 无 bash 说明:首次启动检测 win 且无 Git Bash → 设置页/说明文档提示"bash 工具不可用,如需可安装 Git for Windows",但不阻断使用(默认 tools 不含 bash)。

## Acceptance criteria

- [ ] electron-builder 配置存在,`make package`(或等效)产出 mac/win/linux 三平台产物。
- [ ] extraResources 把 rg/fd(按平台)+ kb_example 打进 bundle,切片 4 的铺放逻辑能从 bundle 读到。
- [ ] build 流程文档化(Makefile target 或 README):web build → server build → electron-builder。
- [ ] mac 产物:`.app` 双击能跑,顶部菜单定制过(无 Electron 占位菜单)。
- [ ] win 产物:`.exe` 目录或 nsis 安装包双击能跑。
- [ ] linux 产物:AppImage `chmod +x` 后能跑。
- [ ] 拖拽文件到窗口 → 上传到 `/api/upload` 成功(复用现有上传端点)。
- [ ] 右键菜单是桌面风格(非浏览器默认)。
- [ ] win 无 bash 时不阻断使用,有明确提示(设置页或文档)。
- [ ] 手动验证:三平台各跑一次,确认应用启动、SPA 加载、agent 对话、上传 ingest、切库均工作。

## Blocked by

- `04-userdata-init-and-tool-bins.md`(rg/fd + kb_example 资源就绪)
- `05-settings-vault-switch-apikey.md`(设置页就绪,win 无 bash 提示挂在设置页)

## Notes

代码签名/公证(mac Apple Developer、Win 代码签名证书)是发布期投入,不在此切片的验收内 —— 首版可分发未签名产物(用户手动信任),签名作为后续运维任务。跨平台 rg/fd 自动下载在 Electron 打包后能否从 `getBinDir()` 加载,是切片 4 已验证的 spike,此处打包复用。
