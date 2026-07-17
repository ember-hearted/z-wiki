// main.ts — Electron 主进程:首次启动初始化 + 嵌入 server + 开窗口显示 SPA。
// 切片 04:路径切到 UserDataDir(ADR-0003 D3),首次启动从 bundle 复制 kb_example + 铺放 rg/fd(D4/D8)。
// 依赖方向单向(D9):只 import createServer,不深入 server 内部模块。
import './env.js' // 副作用:必须在 pi SDK import 前设 PI_CODING_AGENT_DIR + PI_OFFLINE(见 env.ts 注释)
import './applyPendingBoot.js' // 副作用:win 待应用更新在 server import 链前替换(见 applyPendingBoot.ts 注释)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'
import { createServer } from '@z-wiki/server'
import { resolveDesktopPaths } from './paths.js'
import { needsWindowsGpuSandboxFallback } from './pathUtils.js'
import { ensureFirstRun } from './firstRun.js'
import { ensureToolBins } from './toolBins.js'
import { checkForUpdate, cleanupOldPatches } from './updater.js'
import { buildContextMenuTemplate } from './contextMenu.js'
import { shouldAutoHideMenuBar } from './menuBar.js'
import { loadWindowBounds, saveWindowBounds } from './windowState.js'

// 应用名:覆盖 Electron 默认"Electron"(macOS 应用菜单/Dock 显示名)。打包后由 Info.plist 接管。
app.setName('z-wiki')

// 旧 Windows(Electron 38 GPU/沙箱兼容差)双击 exe 主进程 C++ 层崩。app 内部 appendSwitch 可能
// 晚于 Chromium/GPU 初始化(来不及,实测 relaunch/spawn 重启带参数均不可靠),故旧 Windows 的可靠
// 启动走 z-wiki.bat 启动器(双击 bat 调 exe 带 --disable-gpu --no-sandbox,等同手动命令行)。
// 这里 disableHardwareAcceleration + no-sandbox 是 best-effort 补充(新系统 + 部分旧环境可能够)。
// 用 process.getSystemVersion() 取真实 OS 版本(RtlGetVersion);Node os.release() 走 GetVersionEx
// 受兼容性 manifest 影响,打包 app 在 Win10 常误返 6.2/6.3 -> build 解析失败 -> 检测漏触发。
if (needsWindowsGpuSandboxFallback(process.platform, process.getSystemVersion())) {
  app.disableHardwareAcceleration()
  app.commandLine.appendSwitch('no-sandbox')
}

// preload.js 与 main.js 同在 dist/(tsc 编译 ESM,__dirname 用 import.meta.url 推导)。
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const preloadPath = path.join(__dirname, 'preload.cjs')

// 窗口尺寸约束:初始值仅首次启动(无持久化 bounds)时用,之后读 preferences.windowBounds;
// 最小值防拖太小把布局压没。持久化的旧小尺寸由 Electron 构造时自动 clamp 到 min,无需手动处理。
const DEFAULT_WINDOW_WIDTH = 1280
const DEFAULT_WINDOW_HEIGHT = 800
const MIN_WINDOW_WIDTH = 1080
const MIN_WINDOW_HEIGHT = 675

let interaction: Awaited<ReturnType<typeof createServer>> | null = null
let mainWindow: BrowserWindow | null = null
let configPath = ''

/** 持久化当前窗口尺寸/位置到 config.json(若窗口仍存活)。两条退出路径都调,幂等。 */
function persistWindowBounds(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const [x, y] = mainWindow.getPosition()
  const [width, height] = mainWindow.getSize()
  saveWindowBounds(configPath, { x, y, width, height, maximized: mainWindow.isMaximized() })
}

async function bootstrap(): Promise<void> {
  const paths = resolveDesktopPaths()
  configPath = paths.configPath

  // 首次启动:从 bundle 复制首个 Vault + 写初始 config.json(ADR-0003 D4)。
  ensureFirstRun(paths)
  // 铺放 rg/fd 到 pi 的 getBinDir()(D8),版本不一致才重铺。
  ensureToolBins(paths)
  // 清理上次更新留下的 .old(代码包/应用包/staging 替换;ADR-0018)
  if (app.isPackaged) {
    void cleanupOldPatches(process.resourcesPath).catch((err) =>
      console.error('cleanup old patches failed:', err),
    )
  }

  // 打开 vault 目录(系统文件管理器):前端经 window.desktop.openVault → IPC → shell.openPath。
  // 只读,不改 fs/config。成功返回空串,失败返回错误字符串,前端回显。
  ipcMain.handle('vault:open', (_event, vaultPath: string) => shell.openPath(vaultPath))

  // 弹原生文件夹选择器选 vault 父目录:返回选中路径(取消/窗口未就绪返回空串)。
  ipcMain.handle('dialog:select-vault-path', async () => {
    if (!mainWindow) return ''
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择知识库存放目录',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (result.canceled || result.filePaths.length === 0) return ''
    return result.filePaths[0]
  })

  interaction = await createServer({
    kbRoot: paths.kbRoot,
    agentDir: paths.agentDir,
    webDistPath: paths.webDist,
    kbExamplePath: paths.kbExamplePath,
  })

  // listen 随机端口(ADR-0003 D2):port:0 取空闲端口,避免冲突,端口注入 loadURL。
  await interaction.app.listen({ port: 0, host: '127.0.0.1' })
  const address = interaction.app.server.address()
  const port = typeof address === 'object' && address ? address.port : null
  if (!port) throw new Error('server listen 后未拿到端口')
  interaction.log.info({ port }, 'embedded server listening')

  const bounds = loadWindowBounds(paths.configPath)
  // 窗口图标:Windows/Linux 走 BrowserWindow.icon;macOS 开发模式该选项不生效,
  // 用下方 app.dock.setIcon 设 Dock 图标。打包后由 build/icon.icns 接管。
  // 文件不存在则回落默认(Electron logo),不阻塞启动。
  const iconPath = path.join(__dirname, '..', 'build', 'icon.png')
  const iconExists = fs.existsSync(iconPath)
  mainWindow = new BrowserWindow({
    width: bounds?.width ?? DEFAULT_WINDOW_WIDTH,
    height: bounds?.height ?? DEFAULT_WINDOW_HEIGHT,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    x: bounds?.x,
    y: bounds?.y,
    icon: iconExists ? iconPath : undefined,
    // Windows/Linux 隐藏窗口内菜单栏(Alt 可呼出);mac 菜单在系统顶部不受此选项影响,保留切片 05 定制菜单。
    // 编辑操作(复制/粘贴/全选)靠 Ctrl 快捷键 + 右键菜单,功能不丢。
    autoHideMenuBar: shouldAutoHideMenuBar(process.platform),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath,
    },
  })
  if (iconExists && process.platform === 'darwin') {
    app.dock?.setIcon(iconPath)
  }
  if (bounds?.maximized) mainWindow.maximize()

  // 诊断:preload 加载/执行失败时 Electron 不打主进程日志,显式监听抓错误。
  mainWindow.webContents.on('preload-error', (_e, p, error) => {
    console.error('[preload-error]', p, error?.message ?? error)
  })

  // 右键菜单(切片 06:桌面风格,替代浏览器默认)。role 项自动启用/禁用 + 快捷键;
  // back/forward 按 navigationHistory 启用(SPA 用 history 路由,webContents.goBack 受 react-router 尊重)。
  mainWindow.webContents.on('context-menu', (_event, _params) => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    const history = mainWindow.webContents.navigationHistory
    const menu = Menu.buildFromTemplate(
      buildContextMenuTemplate({
        canGoBack: history.canGoBack(),
        canGoForward: history.canGoForward(),
        onBack: () => mainWindow?.webContents.goBack(),
        onForward: () => mainWindow?.webContents.goForward(),
      }),
    )
    menu.popup({ window: mainWindow })
  })

  await mainWindow.loadURL(`http://127.0.0.1:${port}/`)

  // 外链走系统浏览器,不在 app 内导航(桌面习惯;SPA 内部路由不受影响)。
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  // 后台检查更新(仅 prod + 配了 ZWIKI_UPDATE_FEED;不阻塞 bootstrap,ADR-0018 Ticket 04/06)。
  // code/app 档自动下载应用 -> 提示重启;full 档 mac/win 提示下完整包重装(linux 自动替换 AppImage)。
  if (app.isPackaged && process.env.ZWIKI_UPDATE_FEED) {
    void checkForUpdate({
      feedUrl: process.env.ZWIKI_UPDATE_FEED,
      statePath: path.join(paths.userDataDir, '.update-state.json'),
      cacheDir: path.join(paths.userDataDir, 'update-cache'),
      stagingDir: path.join(paths.userDataDir, 'update-staging'),
      resourcesDir: process.resourcesPath,
      platform: process.platform,
      arch: process.arch,
    })
      .then((result) => {
        if (!mainWindow || mainWindow.isDestroyed()) {
          interaction?.log.info({ result }, 'update check')
          return
        }
        if (result.action === 'applied') {
          void dialog
            .showMessageBox(mainWindow, {
              type: 'info',
              title: '更新就绪',
              message: '新版本已下载',
              detail: '重启 z-wiki 以完成更新。',
              buttons: ['重启', '稍后'],
            })
            .then(({ response }) => {
              if (response === 0) {
                app.relaunch()
                app.exit(0)
              }
            })
        } else if (result.action === 'full') {
          void dialog
            .showMessageBox(mainWindow, {
              type: 'info',
              title: '需要重新安装',
              message: '基线层升级',
              detail: result.downloadUrl
                ? `${result.message}\n\n点"去下载"获取新完整包,安装后覆盖旧版即可。`
                : result.message,
              buttons: result.downloadUrl ? ['去下载', '稍后'] : ['知道了'],
            })
            .then(({ response }) => {
              if (response === 0 && result.downloadUrl) void shell.openExternal(result.downloadUrl)
            })
        } else if (result.action === 'error') {
          // 网络/校验类(silent)自动重试不打扰;apply 失败需用户行动,弹窗提示。
          if (result.silent) {
            interaction?.log.warn({ result }, 'update check failed (will retry)')
          } else {
            void dialog
              .showMessageBox(mainWindow, {
                type: 'warning',
                title: '更新失败',
                message: '更新失败',
                detail: result.downloadUrl
                  ? `${result.message}\n\n也可点"去下载"获取完整包重装。`
                  : result.message,
                buttons: result.downloadUrl ? ['去下载', '知道了'] : ['知道了'],
              })
              .then(({ response }) => {
                if (response === 0 && result.downloadUrl)
                  void shell.openExternal(result.downloadUrl)
              })
          }
        } else {
          interaction?.log.info({ result }, 'update check')
        }
      })
      .catch((err) => interaction?.log.warn({ err }, 'update check failed'))
  }

  // 关窗口按钮路径:close 事件时窗口仍存活,此处持久化(验收:重启后保留)。
  mainWindow.on('close', () => persistWindowBounds())
}

/** 应用菜单:顶层标题中文,子项用 role 保留系统行为与快捷键(role 在中文系统会自动本地化子项标签)。 */
function setAppMenu(): void {
  // macOS 首菜单必须是 appMenu(role):系统级 About/Hide/Quit 与 IME 输入上下文初始化都依赖它。
  // 0f27497 自定义菜单用 "文件" 占了首菜单位置但没给 appMenu role -> macOS 不为窗口激活输入法,
  // 中文输不进去(输入法切不到中文、compositionstart 不触发)。恢复 appMenu role 即恢复 IME。
  const appMenu: MenuItemConstructorOptions =
    process.platform === 'darwin'
      ? {
          role: 'appMenu',
          submenu: [
            { role: 'about', label: '关于 z-wiki' },
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide', label: '隐藏' },
            { role: 'hideOthers', label: '隐藏其他' },
            { role: 'unhide', label: '显示全部' },
            { type: 'separator' },
            { role: 'quit', label: '退出' },
          ],
        }
      : { label: '文件', submenu: [{ role: 'quit', label: '退出' }] }
  const template: MenuItemConstructorOptions[] = [
    appMenu,
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'forceReload', label: '强制重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '重置缩放' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
      ],
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'zoom', label: '缩放' },
        { role: 'close', label: '关闭' },
      ],
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '关于 z-wiki',
          click: () => {
            if (!mainWindow || mainWindow.isDestroyed()) return
            void dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: '关于 z-wiki',
              message: 'z-wiki',
              detail: `版本 ${app.getVersion()}\nElectron ${process.versions.electron}`,
            })
          },
        },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

app.whenReady().then(() => {
  setAppMenu()
  void bootstrap().catch((err) => {
    console.error('desktop bootstrap failed:', err)
    app.quit()
  })
})

let shuttingDown = false

/** 统一退出路径:持久化窗口 + graceful 关 server + app.exit 强制退出。 */
async function shutdown(): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  persistWindowBounds()
  if (interaction) {
    try {
      await interaction.app.close()
    } catch (err) {
      console.error('server close error:', err)
    }
  }
  // app.exit 强制退出,兜底 fastify listen socket 阻止进程退出(dev 形态 start() 同问题)。
  app.exit(0)
}

// 关窗口 = 退出 app(ADR-0003 D1:原生窗口天然解决"关窗口=关 app"生命周期,无遗留进程)。
app.on('window-all-closed', () => {
  void shutdown()
})

// Cmd+Q 路径:before-quit 时窗口尚未关闭,先持久化再退出(防 close 事件被 preventDefault 跳过)。
app.on('before-quit', (event) => {
  if (shuttingDown) return
  event.preventDefault()
  void shutdown()
})
