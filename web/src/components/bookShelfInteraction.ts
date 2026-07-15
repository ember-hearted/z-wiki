// BookShelf3D 交互状态机的纯决策函数（参照 bookShelfReflow.ts 模式）。
// 从主 useEffect 闭包抽出的纯逻辑：snap/clamp/橡皮筋/速度采样/fly/orbit 对齐/click 阈值。
// 只算"目标值"，rot 对象/snapping 布尔/gsap 调用留 useEffect--纯函数不知道 gsap 存在。

const TAU = Math.PI * 2 // 单本书回弹对齐用：吸到 2π 整数倍视觉等同正中
export const SOLO_DRAG_CLAMP = 0.025 // 单本书拖拽 rot 1:1 跟手范围（弧度）：在此范围内跟手，超出走橡皮筋渐近线
export const SOLO_MAX_ROT = 0.05 // 单本书橡皮筋渐近上限（弧度，约 2.8°）：轻微挪动，取 min(soloMaxRot) 防窄屏出屏
export const CLICK_MOVE_PX = 6 // 位移阈值：小于此判定为点击而非拖拽

// 吸附 rot 到最近槽位（中心对齐到一本）。单本书（slots<=1）无滑轨，对齐到最近 2π 整数倍
// （视觉等同正中且位移最小，拖多圈也不转一整圈回来）。多本书走槽位对齐；无 virtual 时
// 收敛到窗口 [-half, half] 防 rot 累积飞出后松手不回（7ea7aa6 根因）。
export function snapTarget(
  rotVal: number,
  effStep: number,
  half: number,
  slots: number,
  virtual: boolean,
): number {
  if (slots <= 1) {
    return Math.round(rotVal / TAU) * TAU
  }
  const targetSlot = Math.round(-rotVal / effStep)
  const slot = virtual ? targetSlot : Math.max(-half, Math.min(half, targetSlot))
  return -slot * effStep
}

// 仅 N=3 残留（half=1、virtual=false）：rot 硬夹到 ±half*effStep（墙=最远槽位，松手 snap 对齐），
// 防 x=sin(a)*RADIUS 飞出视口。N≥4 走 reflow 不经此函数；单本书(slots<=1)橡皮筋语义不同不复用。
// limit 曾误取 min(half*effStep, soloMaxRot)，但 half=1 时 soloMaxRot 恒为死约束，已移除(5ed27f1)。
export function clampRot(val: number, effStep: number, half: number): number {
  const limit = half * effStep
  return Math.max(-limit, Math.min(limit, val))
}

// 单本书橡皮筋渐近线：±SOLO_DRAG_CLAMP 内 1:1 跟手，超出部分渐近趋向 ±limit
// （limit=min(soloMaxRot, SOLO_MAX_ROT)），越拖越阻尼、永不到顶不撞墙，松手弹回正中。
export function soloElasticRot(raw: number, soloMaxRot: number): number {
  const limit = Math.min(soloMaxRot, SOLO_MAX_ROT)
  const span = limit - SOLO_DRAG_CLAMP
  if (raw > SOLO_DRAG_CLAMP) {
    return SOLO_DRAG_CLAMP + span * (1 - Math.exp(-(raw - SOLO_DRAG_CLAMP) / span))
  }
  if (raw < -SOLO_DRAG_CLAMP) {
    return -SOLO_DRAG_CLAMP - span * (1 - Math.exp((raw + SOLO_DRAG_CLAMP) / span))
  }
  return raw
}

// 松手前近 100ms 速度采样算惯性初速（弧度/秒）。span 下限 16ms，防 up 与最后一次 move
// 间隔过小把抖动放大成猛烈甩动。空样本 -> 0。
export function velocityFromSamples(
  samples: { t: number; dx: number }[],
  now: number,
  pixelToAngle: number,
): number {
  if (samples.length === 0) return 0
  const sumDx = samples.reduce((s, v) => s + v.dx, 0)
  const span = Math.max(16, now - samples[0].t)
  return (sumDx * pixelToAngle) / (span / 1000)
}

// 点击演出参数：tween rot 到目标槽（最短弧 target=-targetSlot*effStep），时长按距离缩放
// duration=min(0.8, 0.4+steps*0.05)，远距封顶 0.8s。
export function flyToTarget(
  rotVal: number,
  targetSlot: number,
  effStep: number,
): { target: number; duration: number } {
  const target = -targetSlot * effStep
  const steps = Math.abs(target - rotVal) / effStep
  const duration = Math.min(0.8, 0.4 + steps * 0.05)
  return { target, duration }
}

// 进入轨道球：对齐 rot 到最近槽（稳定 currentSlot）。单本书对齐到 2π 整数倍，多本书对齐槽位。
export function orbitAlignTarget(rotVal: number, effStep: number, slots: number): number {
  if (slots <= 1) {
    return Math.round(rotVal / TAU) * TAU
  }
  return -Math.round(-rotVal / effStep) * effStep
}

// 位移是否在点击阈值内（<=CLICK_MOVE_PX）：true 表示应视为点击、不触发拖拽。
export function isClickMove(clientX: number, dragStartX: number): boolean {
  return Math.abs(clientX - dragStartX) <= CLICK_MOVE_PX
}
