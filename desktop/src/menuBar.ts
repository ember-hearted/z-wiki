// menuBar.ts - 应用菜单栏可见性决策(纯函数,便于测试)。
// 平台分支就地判断(ADR-0008):mac 菜单在系统顶部,autoHideMenuBar 无意义;
// win32/linux 菜单渲染在窗口内,隐藏后 Alt 可呼出,编辑操作靠 Ctrl 快捷键 + 右键菜单不丢功能。
export function shouldAutoHideMenuBar(platform: NodeJS.Platform): boolean {
  return platform === 'win32' || platform === 'linux'
}
