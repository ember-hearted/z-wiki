import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  snapTarget,
  clampRot,
  soloElasticRot,
  velocityFromSamples,
  flyToTarget,
  orbitAlignTarget,
  isClickMove,
  SOLO_DRAG_CLAMP,
  SOLO_MAX_ROT,
  CLICK_MOVE_PX,
} from './bookShelfInteraction.js'

// 参数对齐 BookShelf3D：SLOT_COUNT=17（half=8），ANGLE_STEP=0.05（spreadP=0 时 effStep=0.05）
const HALF = 8
const SLOTS = 17
const EFF_STEP = 0.05
const TAU = Math.PI * 2

// ---------- snapTarget ----------

test('snapTarget 单本书（slots<=1）拖多圈 -> snap 到最近 2π 整数倍、位移最小', () => {
  // rotVal = 3*TAU + 0.1，应 snap 到 3*TAU（最近的 2π 整数倍），不转回 0
  const target = snapTarget(3 * TAU + 0.1, EFF_STEP, HALF, 1, false)
  assert.equal(target, 3 * TAU)
})

test('snapTarget 多本无 virtual、rot 累积飞出窗口 -> 收敛回 [-half,half]（7ea7aa6 根因）', () => {
  // rotVal=-0.5 -> targetSlot=round(0.5/0.05)=10，超 half=8；无 virtual 应夹到 slot=8
  const target = snapTarget(-0.5, EFF_STEP, HALF, SLOTS, false)
  const slot = -target / EFF_STEP
  assert.ok(slot >= -HALF, `slot=${slot} 应 >= -half=${-HALF}`)
  assert.ok(slot <= HALF, `slot=${slot} 应 <= half=${HALF}`)
})

test('snapTarget 多本 virtual -> 不收敛，靠 reflow 收敛 pos', () => {
  const target = snapTarget(-0.5, EFF_STEP, HALF, SLOTS, true)
  assert.equal(-target / EFF_STEP, 10) // 不夹，原样 round(10)
})

test('snapTarget 两槽正中 -> round 半数向 +Inf（JS Math.round 行为）', () => {
  // rotVal=-0.025 -> -rotVal/effStep=0.5 -> Math.round(0.5)=1
  const target = snapTarget(-0.025, EFF_STEP, HALF, SLOTS, true)
  assert.equal(-target / EFF_STEP, 1)
})

// ---------- soloElasticRot ----------

test('soloElasticRot |raw|<=clamp 段 -> 1:1 跟手（原值）', () => {
  assert.equal(soloElasticRot(0, 0.05), 0)
  assert.equal(soloElasticRot(SOLO_DRAG_CLAMP, 0.05), SOLO_DRAG_CLAMP)
  assert.equal(soloElasticRot(-SOLO_DRAG_CLAMP, 0.05), -SOLO_DRAG_CLAMP)
})

test('soloElasticRot 适度超出 clamp -> 渐近趋向 +limit、未到顶', () => {
  const soloMaxRot = 0.05
  const limit = Math.min(soloMaxRot, SOLO_MAX_ROT)
  const r = soloElasticRot(SOLO_DRAG_CLAMP + 0.01, soloMaxRot)
  assert.ok(r > SOLO_DRAG_CLAMP, '超出 clamp 应 > clamp')
  assert.ok(r < limit, '适度超出应 < limit（渐近未到顶）')
})

test('soloElasticRot 极大输入 -> 不超 limit（浮点极限可等，不撞墙）', () => {
  const soloMaxRot = 0.05
  const limit = Math.min(soloMaxRot, SOLO_MAX_ROT)
  const r = soloElasticRot(SOLO_DRAG_CLAMP + 10, soloMaxRot)
  assert.ok(r <= limit, `r=${r} 应 <= limit=${limit}（不撞墙）`)
})

test('soloElasticRot ±raw 输出对称', () => {
  const soloMaxRot = 0.05
  const r = soloElasticRot(SOLO_DRAG_CLAMP + 0.02, soloMaxRot)
  const rNeg = soloElasticRot(-(SOLO_DRAG_CLAMP + 0.02), soloMaxRot)
  assert.ok(Math.abs(r + rNeg) < 1e-12, `r=${r} 与 rNeg=${rNeg} 应互为相反数`)
})

// ---------- clampRot ----------
// 仅 N=3 残留（half=1）：rot 硬夹到 ±half*effStep，防飞出视口（5ed27f1：去 soloMaxRot 死约束）。

test('clampRot 窗口内 -> 原值', () => {
  // limit = half*effStep = 8*0.05 = 0.4
  assert.equal(clampRot(0, EFF_STEP, HALF), 0)
  assert.equal(clampRot(0.1, EFF_STEP, HALF), 0.1)
})

test('clampRot 超出 -> 夹到 ±limit（limit=half*effStep）', () => {
  assert.equal(clampRot(1, EFF_STEP, HALF), 0.4)
  assert.equal(clampRot(-1, EFF_STEP, HALF), -0.4)
})

test('clampRot 边界值 ±limit -> 原值（不夹）', () => {
  assert.equal(clampRot(0.4, EFF_STEP, HALF), 0.4)
  assert.equal(clampRot(-0.4, EFF_STEP, HALF), -0.4)
})

// ---------- velocityFromSamples ----------

test('velocityFromSamples 空样本 -> 0', () => {
  assert.equal(velocityFromSamples([], 1000, 0.012), 0)
})

test('velocityFromSamples 正常采样 -> 平均速度（弧度/秒）', () => {
  // sumDx=30, span=max(16, 1010-900)=110ms, vel=30*0.012/0.11
  const samples = [
    { t: 900, dx: 10 },
    { t: 1000, dx: 20 },
  ]
  const vel = velocityFromSamples(samples, 1010, 0.012)
  assert.ok(Math.abs(vel - (30 * 0.012) / 0.11) < 1e-9, `vel=${vel}`)
})

test('velocityFromSamples span<16ms -> 用 16ms 下限（防抖动放大成甩动）', () => {
  // span=max(16, 1005-1000)=16, vel=10*0.012/0.016=7.5
  const samples = [{ t: 1000, dx: 10 }]
  const vel = velocityFromSamples(samples, 1005, 0.012)
  assert.ok(Math.abs(vel - 7.5) < 1e-9, `vel=${vel} 应=7.5`)
})

// ---------- flyToTarget ----------

test('flyToTarget target = -targetSlot*effStep', () => {
  const r = flyToTarget(0, 3, EFF_STEP)
  assert.equal(r.target, -3 * EFF_STEP)
})

test('flyToTarget duration 按距离缩放、远距封顶 0.8', () => {
  // steps=3, duration=0.4+3*0.05=0.55
  const r1 = flyToTarget(0, 3, EFF_STEP)
  assert.ok(Math.abs(r1.duration - 0.55) < 1e-9, `duration=${r1.duration}`)
  // steps=20, duration=min(0.8, 0.4+20*0.05=1.4)=0.8
  const r2 = flyToTarget(0, 20, EFF_STEP)
  assert.equal(r2.duration, 0.8)
})

// ---------- orbitAlignTarget ----------

test('orbitAlignTarget 单本书 -> 对齐 2π 整数倍', () => {
  // rotVal=2*TAU+0.1 -> 对齐到 2*TAU
  assert.equal(orbitAlignTarget(2 * TAU + 0.1, EFF_STEP, 1), 2 * TAU)
})

test('orbitAlignTarget 多本书 -> 对齐最近槽', () => {
  // rotVal=-0.12 -> -Math.round(0.12/0.05)*0.05 = -Math.round(2.4)*0.05 = -0.1
  assert.equal(orbitAlignTarget(-0.12, EFF_STEP, SLOTS), -0.1)
})

// ---------- isClickMove ----------

test('isClickMove |dx|<阈值 -> true（点击）', () => {
  assert.equal(isClickMove(100, 102), true) // dx=2 < 6
})

test('isClickMove |dx|>阈值 -> false（拖拽）', () => {
  assert.equal(isClickMove(100, 110), false) // dx=10 > 6
})

test('isClickMove |dx|=阈值 -> true（<=算点击）', () => {
  assert.equal(isClickMove(100, 100 + CLICK_MOVE_PX), true)
  assert.equal(isClickMove(100, 100 - CLICK_MOVE_PX), true)
})
