import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import gsap from 'gsap'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import type { PageMeta } from '../hooks/useData'

/* ═══════════════════════════════════════════════════
   BookShelf3D — Three.js 圆柱形 3D 书架
   13 槽位均分圆柱，拖拽旋转，吸附轮播，当前项突出
   ═══════════════════════════════════════════════════ */

interface BookShelf3DProps {
  pages: PageMeta[]
  onBookClick: (stem: string) => void
  onIntroDone?: () => void
}

// ---------- 配置 ----------
const BOOK_W = 2.0
const BOOK_H = 2.7
const BOOK_D = 0.55
const ROUND_R = 0.08
const ROUND_S = 4
const SLOT_COUNT = 17                       // 总槽位数：可见 13（slotIndex∈[-6,6]）+ 每侧缓冲 2（±7、±8）。N>slots 时 virtual 启用 reflow 无缝换皮
const RADIUS = 28                           // 轴半径（增大→浅弧一字排开；17 槽下加大以填满屏宽并维持更浅弧度）
const ANGLE_STEP = 0.05                     // 每槽位基础角度（入场后随 spreadP 放大到 1.2x）
const FOCAL_Z = 3.0                         // 抽出本沿径向前移（z = RADIUS + FOCAL_Z = 31；相机 z=35，距相机 4 完整可见；与待机书落差 4 保留前突纵深）
const CURRENT_SCALE = 1.15                  // 抽出本缩放放大（随 select lerp，用尺寸补强被削弱的纵深演出）
const SELECT_LERP = 0.30                    // select 独立 lerp 系数（快于姿态 0.1）：快速滑动中 currentSlot 切换快，select 须尽快爬到 1 才能让纵深/缩放/光泽/翻面演出立起来
const CURRENT_TILT_X = -0.5                 // 抽出本绕 X 轴后仰（顶部远离相机，书口顶角朝上远）
const CURRENT_TILT_Z = 0.35                 // 抽出本绕 Z 轴侧倾（书脊侧角着地、书口顶角朝上）
const RETREAT_Z = -1                        // 其余书远离并稳定停在此 z（z = RADIUS + RETREAT_Z = 27；与抽出本落差 FOCAL_Z-RETREAT_Z=4）
const FAN_TILT = 0.03                       // 远离时绕 y 微旋系数：左侧顺时针、右侧逆时针，呈捧中间姿态
const SPREAD_MAX = 0.2                      // 间距倍率上浮（effectiveStep = ANGLE_STEP*(1+SPREAD_MAX*spreadP)，最大 1.2x）
const LIFT_FROM_Y = -4                      // 入场起点 y
const HOVER_LOST_THRESHOLD = 5
// ---------- 拖拽惯性驱动 ----------
const PIXEL_TO_ANGLE = 0.012                // 像素→弧度：拖拽 1:1 抓取灵敏度（现场调）
const DRAG_FRICTION = 0.90                  // 惯性指数摩擦（/帧，dt*60 缩放）
const VEL_SNAP_THRESHOLD = 0.4              // 角速度低于此值（弧度/秒）触发末端吸附
const CLICK_MOVE_PX = 6                     // 位移阈值：小于此判定为点击而非拖拽
const HIT_NDC_THRESHOLD = 0.06              // 屏幕投影命中阈值（ndc，约屏宽 6%）：点击点落在此半径内才算命中某书
const HIT_NDC_THRESHOLD_CURRENT = 0.12      // 中心抽出本命中阈值：抽出本侧倾后仰致视觉中心偏离几何中心，放宽 2 倍保证好点中进详情

// 固定色调（与全局温润深色主题协调）
const PAPER_CREAM = '#e8ddd0'
const DARK_BASE = '#12121a'

// 档案色板：低饱和、中明度，与深色背景统一
const ARCHIVE_ACCENTS = [
  '#6b8fc7', // 靛青（主 accent）
  '#7d8fa3', // 灰蓝
  '#8f7d6e', // 暖褐
  '#74877a', // 暗鼠尾草绿
  '#8a7d98', // 薰衣草灰
  '#9c8b6a', // 暗金褐
]

// ---------- 颜色工具 ----------

function hashAccent(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash)
  }
  return ARCHIVE_ACCENTS[Math.abs(hash) % ARCHIVE_ACCENTS.length]
}

function shadeColor(color: string, percent: number): string {
  const num = parseInt(color.replace('#', ''), 16)
  const r = Math.max(0, Math.min(255, (num >> 16) + percent))
  const g = Math.max(0, Math.min(255, ((num >> 8) & 0x00ff) + percent))
  const b = Math.max(0, Math.min(255, (num & 0x0000ff) + percent))
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`
}

// ---------- 封面纹理生成 ----------

function makeCoverTexture(data: {
  title: string; subtitle: string; accent: string; dark: string; paper: string; backText: string; meta: string
}): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 700
  const ctx = ctx2d(canvas)

  // 深色底
  ctx.fillStyle = data.dark
  ctx.fillRect(0, 0, 512, 700)

  // 警示胶带
  ctx.save()
  ctx.translate(0, 0); ctx.rotate(-0.12)
  ctx.fillStyle = data.accent
  ctx.fillRect(-60, 180, 620, 28)
  ctx.fillStyle = '#000'
  ctx.font = 'bold 18px sans-serif'
  ctx.textAlign = 'center'
  for (let i = 0; i < 6; i++) {
    ctx.save()
    ctx.translate(80 + i * 100, 198); ctx.rotate(-0.05)
    ctx.fillText('CAUTION', 0, 0)
    ctx.restore()
  }
  ctx.restore()

  // 纸张噪点
  ctx.globalAlpha = 0.08
  for (let i = 0; i < 3000; i++) {
    ctx.fillStyle = Math.random() > 0.5 ? '#fff' : '#000'
    ctx.fillRect(Math.random() * 512, Math.random() * 700, 2, 2)
  }
  ctx.globalAlpha = 1

  // 工业边框
  ctx.strokeStyle = data.accent
  ctx.lineWidth = 5
  ctx.strokeRect(24, 24, 464, 652)
  ctx.strokeStyle = 'rgba(255,255,255,0.12)'
  ctx.lineWidth = 2
  ctx.strokeRect(36, 36, 440, 628)

  // 卷号标签
  ctx.fillStyle = data.accent
  ctx.beginPath()
  ctx.roundRect(360, 50, 120, 42, 4)
  ctx.fill()
  ctx.fillStyle = '#000'
  ctx.font = 'bold 22px sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText(data.meta, 420, 78)

  // 书名（单行自适应：54px 起，按宽度等比缩，下限 36px，仍超则末尾省略）
  ctx.fillStyle = '#fff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const TITLE_MAX_W = 430
  const TITLE_MAX_FS = 54
  const TITLE_MIN_FS = 36
  let fs = TITLE_MAX_FS
  ctx.font = `bold ${fs}px sans-serif`
  while (fs > TITLE_MIN_FS && ctx.measureText(data.title).width > TITLE_MAX_W) {
    fs -= 1
    ctx.font = `bold ${fs}px sans-serif`
  }
  let titleText = data.title
  if (ctx.measureText(titleText).width > TITLE_MAX_W) {
    while (titleText.length > 0 && ctx.measureText(titleText + '…').width > TITLE_MAX_W) {
      titleText = titleText.slice(0, -1)
    }
    titleText += '…'
  }
  ctx.shadowColor = data.accent
  ctx.shadowBlur = 12
  ctx.fillText(titleText, 256, 310)
  ctx.shadowBlur = 0
  ctx.fillStyle = 'rgba(255,255,255,0.75)'
  ctx.font = '30px sans-serif'
  ctx.fillText(data.subtitle, 256, 358)

  // 底部档案条
  ctx.fillStyle = 'rgba(0,0,0,0.5)'
  ctx.fillRect(0, 575, 512, 125)
  ctx.fillStyle = data.accent
  ctx.fillRect(0, 575, 512, 8)
  ctx.fillStyle = 'rgba(255,255,255,0.7)'
  ctx.font = '22px sans-serif'
  ctx.fillText('Random Play Archives', 256, 645)

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

function makeBackTexture(data: {
  title: string; accent: string; backText: string; meta: string
}): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 512; canvas.height = 700
  const ctx = ctx2d(canvas)

  ctx.fillStyle = '#0c0c12'
  ctx.fillRect(0, 0, 512, 700)
  ctx.fillStyle = data.accent
  ctx.fillRect(0, 0, 512, 12)
  ctx.fillStyle = '#fff'
  ctx.font = 'bold 40px sans-serif'
  ctx.textAlign = 'left'
  ctx.fillText(data.title, 40, 90)
  ctx.fillStyle = 'rgba(255,255,255,0.75)'
  ctx.font = '26px sans-serif'

  // 自动换行
  let line = '', y = 160
  for (const ch of data.backText) {
    const test = line + ch
    if (ctx.measureText(test).width > 430 && line.length > 0) {
      ctx.fillText(line, 40, y); line = ch; y += 44
    } else { line = test }
  }
  ctx.fillText(line, 40, y)

  // 条码
  ctx.fillStyle = 'rgba(255,255,255,0.25)'
  for (let i = 0; i < 30; i++) ctx.fillRect(40 + i * 12, 580, 6 + Math.random() * 4, 60)
  ctx.fillStyle = data.accent
  ctx.font = 'bold 22px sans-serif'
  ctx.fillText(data.meta, 40, 690)

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

function makeSpineTexture(data: { title: string; accent: string; meta: string }): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 128; canvas.height = 700
  const ctx = ctx2d(canvas)

  ctx.fillStyle = '#0f0f15'
  ctx.fillRect(0, 0, 128, 700)
  ctx.strokeStyle = 'rgba(255,255,255,0.15)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(16, 0); ctx.lineTo(16, 700)
  ctx.moveTo(112, 0); ctx.lineTo(112, 700)
  ctx.stroke()

  const grd = ctx.createLinearGradient(0, 0, 128, 0)
  grd.addColorStop(0, 'rgba(255,255,255,0)')
  grd.addColorStop(0.5, 'rgba(255,255,255,0.08)')
  grd.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = grd
  ctx.fillRect(0, 0, 128, 700)

  // 竖排书名
  ctx.save()
  ctx.translate(64, 360); ctx.rotate(-Math.PI / 2)
  ctx.fillStyle = '#fff'
  ctx.font = 'bold 44px sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText(data.title, 0, 14)
  ctx.restore()

  ctx.save()
  ctx.translate(64, 620); ctx.rotate(-Math.PI / 2)
  ctx.fillStyle = data.accent
  ctx.font = 'bold 26px sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText(data.meta, 0, 8)
  ctx.restore()

  ctx.fillStyle = data.accent
  ctx.fillRect(0, 0, 128, 10)
  ctx.fillRect(0, 690, 128, 10)

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

function makeEdgeTexture(paper: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 256; canvas.height = 700
  const ctx = ctx2d(canvas)

  const grd = ctx.createLinearGradient(0, 0, 256, 700)
  grd.addColorStop(0, shadeColor(paper, -12))
  grd.addColorStop(0.5, paper)
  grd.addColorStop(1, shadeColor(paper, -18))
  ctx.fillStyle = grd
  ctx.fillRect(0, 0, 256, 700)

  ctx.globalAlpha = 0.25
  ctx.fillStyle = '#6b5e4f'
  for (let i = 0; i < 700; i += 3) ctx.fillRect(0, i, 256, 1)
  ctx.globalAlpha = 0.12
  ctx.fillStyle = '#fff'
  for (let i = 1; i < 700; i += 6) ctx.fillRect(0, i, 256, 1)
  ctx.globalAlpha = 0.08
  ctx.fillStyle = '#3a3228'
  for (let i = 0; i < 700; i += 8) ctx.fillRect(0, i, Math.random() * 6 + 2, 3)
  ctx.globalAlpha = 0.18
  const vGrd = ctx.createLinearGradient(0, 0, 256, 0)
  vGrd.addColorStop(0, 'rgba(0,0,0,0.5)')
  vGrd.addColorStop(0.25, 'rgba(0,0,0,0)')
  vGrd.addColorStop(0.75, 'rgba(0,0,0,0)')
  vGrd.addColorStop(1, 'rgba(0,0,0,0.55)')
  ctx.fillStyle = vGrd
  ctx.fillRect(0, 0, 256, 700)
  ctx.globalAlpha = 1

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

function makeTopBottomTexture(paper: string, accent: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 512; canvas.height = 256
  const ctx = ctx2d(canvas)

  const grd = ctx.createLinearGradient(0, 0, 512, 256)
  grd.addColorStop(0, shadeColor(paper, -14))
  grd.addColorStop(0.5, paper)
  grd.addColorStop(1, shadeColor(paper, -20))
  ctx.fillStyle = grd
  ctx.fillRect(0, 0, 512, 256)
  ctx.globalAlpha = 0.28
  ctx.fillStyle = '#7a6b5a'
  for (let i = 0; i < 512; i += 5) ctx.fillRect(i, 0, 1, 256)
  ctx.globalAlpha = 0.35
  ctx.fillStyle = accent
  ctx.fillRect(0, 0, 512, 18)
  ctx.fillRect(0, 238, 512, 18)
  ctx.globalAlpha = 1

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

// canvas 2d 上下文快捷获取
function ctx2d(canvas: HTMLCanvasElement) {
  return canvas.getContext('2d')!
}

// ---------- Shader（封面光泽） ----------

const SHEEN_VERTEX = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const SHEEN_FRAGMENT = `
  uniform sampler2D uTexture;
  uniform vec2 uMouse;
  uniform float uTime;
  uniform float uIntensity;
  varying vec2 vUv;
  void main() {
    vec4 baseColor = texture2D(uTexture, vUv);
    vec2 sheenCenter = uMouse + vec2(sin(uTime * 0.5) * 0.08, cos(uTime * 0.4) * 0.08);
    float dist = length(vUv - sheenCenter);
    float sheen1 = pow(max(0.0, 1.0 - dist * 3.5), 3.0);
    float sheen2 = pow(max(0.0, 1.0 - dist * 6.0), 5.0) * 0.5;
    float sheen = (sheen1 + sheen2) * uIntensity;
    vec3 sheenColor = vec3(1.0, 0.96, 0.88);
    gl_FragColor = vec4(baseColor.rgb + sheenColor * sheen, baseColor.a);
  }
`

// ---------- 单本书的皮肤（可换皮的纹理组合） ----------

interface BookSkin {
  cover: THREE.CanvasTexture
  spine: THREE.CanvasTexture
  back: THREE.CanvasTexture
}

/* ═══════════════════════════════════════════════════
   React 组件
   ═══════════════════════════════════════════════════ */

export default function BookShelf3D({ pages, onBookClick, onIntroDone }: BookShelf3DProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const onIntroDoneRef = useRef(onIntroDone)
  onIntroDoneRef.current = onIntroDone

  useEffect(() => {
    const container = containerRef.current
    if (!container || pages.length === 0) return

    // 按更新时间排序（最新的在前）
    const sorted = [...pages].sort(
      (a, b) => new Date(b.updated).getTime() - new Date(a.updated).getTime()
    )
    const N = sorted.length
    // slot0 钉中心，两侧对称；强制奇数以保证 slot0 存在且 slotIndex 为整数（偶数 N 时退一本）
    let slots = Math.min(SLOT_COUNT, N)
    if (slots % 2 === 0) slots -= 1
    const half = (slots - 1) / 2                   // 半窗口（slotIndex 范围 -half..half）
    const virtual = N > slots                      // 是否启用换皮虚拟化
    const step = ANGLE_STEP                        // 槽位角步长（浅弧，非闭合圆）

    // ---------- 预生成纹理池（每本一套） ----------
    const skinPool: BookSkin[] = sorted.map((page) => {
      const accentHex = hashAccent(page.title)
      return {
        cover: makeCoverTexture({
          title: page.title,
          subtitle: page.type === 'wiki' ? '知识库' : '报告与分析',
          accent: accentHex,
          dark: DARK_BASE,
          paper: PAPER_CREAM,
          backText: page.summary || page.title,
          meta: page.type === 'wiki' ? 'WIKI' : 'REPORT',
        }),
        spine: makeSpineTexture({
          title: page.title,
          accent: accentHex,
          meta: page.type === 'wiki' ? 'WIKI' : 'REPORT',
        }),
        back: makeBackTexture({
          title: page.title,
          accent: accentHex,
          backText: page.summary || page.title,
          meta: page.updated,
        }),
      }
    })

    // 通用纹理（不依赖书名）
    const edgeTex = makeEdgeTexture(PAPER_CREAM)
    const topBotTex = makeTopBottomTexture(PAPER_CREAM, '#6b8fc7')
    const sharedGeo = new RoundedBoxGeometry(BOOK_W, BOOK_H, BOOK_D, ROUND_S, ROUND_R)

    // ---------- 场景 ----------
    const scene = new THREE.Scene()

    const camera = new THREE.PerspectiveCamera(
      55,
      container.clientWidth / container.clientHeight,
      0.1,
      100
    )
    camera.position.set(0, 0, 35)

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setSize(container.clientWidth, container.clientHeight)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFShadowMap
    container.appendChild(renderer.domElement)

    // ---------- 光照 ----------
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.45)
    scene.add(ambientLight)

    const dirLight = new THREE.DirectionalLight(0xfff5e6, 1.1)
    dirLight.position.set(5, 8, 7)
    dirLight.castShadow = true
    dirLight.shadow.mapSize.width = 1024
    dirLight.shadow.mapSize.height = 1024
    scene.add(dirLight)

    const rimLight = new THREE.PointLight(0x6b8fc7, 0.9, 35)
    rimLight.position.set(-6, 3, 8)
    scene.add(rimLight)

    const mouseLight = new THREE.PointLight(0xffffff, 0.8, 18)
    mouseLight.position.set(0, 0, 28)
    scene.add(mouseLight)

    // ---------- 书本（对象池） ----------
    const bookContainer = new THREE.Group()
    scene.add(bookContainer)

    interface BookSlot {
      group: THREE.Group
      coverMat: THREE.ShaderMaterial
      spineMat: THREE.MeshStandardMaterial
      backMat: THREE.MeshStandardMaterial
      frontUniforms: { uTexture: THREE.IUniform; uMouse: THREE.IUniform; uTime: THREE.IUniform; uIntensity: THREE.IUniform }
      slotIndex: number          // 当前圆柱槽位（可换皮后超出 -half..half）
      dataIndex: number          // 绑定的数据索引
      isCenter3: boolean         // 是否属于入场动作2 先升的中间3本（|slotIndex|<=1，换皮后不重算）
      select: number             // 各自的抽出进度（isCurrent 时 lerp 向 1，否则 0；入场由 selectIntro 驱动）
      stem: string
    }

    const slotMap = new Map<number, BookSlot>()
    const allSlots: BookSlot[] = []

    function applySkin(book: BookSlot, dataIndex: number) {
      const skin = skinPool[dataIndex]
      book.coverMat.uniforms.uTexture.value = skin.cover
      book.spineMat.map = skin.spine
      book.spineMat.needsUpdate = true
      book.backMat.map = skin.back
      book.backMat.needsUpdate = true
      book.dataIndex = dataIndex
      book.stem = sorted[dataIndex].stem
    }

    // 创建 slots 个书对象，初始槽位 -half..half，数据索引 ≡ slotIndex (mod N)
    for (let i = 0; i < slots; i++) {
      const slotIndex = i - half
      const dataIndex = ((slotIndex % N) + N) % N
      const page = sorted[dataIndex]
      const skin = skinPool[dataIndex]

      const bookGroup = new THREE.Group()
      const a = slotIndex * step

      const frontUniforms = {
        uTexture: { value: skin.cover },
        uMouse: { value: new THREE.Vector2(0.5, 0.5) },
        uTime: { value: 0 },
        uIntensity: { value: 0.0 },
      }
      const coverMat = new THREE.ShaderMaterial({
        uniforms: frontUniforms,
        vertexShader: SHEEN_VERTEX,
        fragmentShader: SHEEN_FRAGMENT,
        transparent: true,
      })
      const spineMat = new THREE.MeshStandardMaterial({ map: skin.spine, roughness: 0.5 })
      const backMat = new THREE.MeshStandardMaterial({ map: skin.back, roughness: 0.5 })
      const edgeMat = new THREE.MeshStandardMaterial({ map: edgeTex, roughness: 0.85 })
      const topMat = new THREE.MeshStandardMaterial({ map: topBotTex, roughness: 0.85 })

      // 面顺序：+x(切口), -x(书脊), +y(顶), -y(底), +z(封面), -z(背面)
      const materials = [edgeMat, spineMat, topMat, topMat, coverMat, backMat]
      const book = new THREE.Mesh(sharedGeo, materials)
      book.castShadow = true
      book.receiveShadow = true
      bookGroup.add(book)

      bookGroup.scale.setScalar(1)
      bookGroup.position.set(Math.sin(a) * RADIUS, LIFT_FROM_Y, RADIUS)
      bookGroup.rotation.y = a + Math.PI / 2          // 书脊朝镜头

      bookContainer.add(bookGroup)

      const slot: BookSlot = {
        group: bookGroup,
        coverMat,
        spineMat,
        backMat,
        frontUniforms,
        slotIndex,
        dataIndex,
        isCenter3: Math.abs(slotIndex) <= 1,
        select: 0,
        stem: page.stem,
      }
      allSlots.push(slot)
      slotMap.set(slotIndex, slot)

      // 入场动画完全由渲染循环根据 yLift3/yLiftRest/selectP/retreatP/spreadP 驱动，
      // 不在此处用 gsap 直接改 position，避免与渲染循环 lerp 冲突。
    }

    // ---------- 交互状态 ----------
    const mouse = new THREE.Vector2()
    const targetMouse = new THREE.Vector2()
    let pointerInside = false                      // 指针是否在容器内（驱动 hover 光泽）
    let orbiting = false                           // 轨道球自由旋转（中键/空格 toggle，仅中心抽出本）
    // 滑轨模型：rot.val（弧度）直接驱动所有书角度 a = slotIndex*effStep + rot.val。
    // currentSlot = round(-rot.val/effStep) 是当前正前方槽位（固定舞台），滑到中心的书做抽出动作。
    // 滑出可见窗口的书由 reflow 瞬移到另一端换皮（无限滑轨）。
    const rot = { val: 0 }
    let currentSlot = 0
    let snapping = false
    let hoverLostFrames = 0
    let isCurrentHovered = false
    let introDone = false
    // 拖拽惯性：左键 1:1 抓取驱动 rot，松手后指数摩擦衰减，末端 snap 到最近槽
    let dragging = false
    let dragStartX = 0                             // 按下时 clientX
    let dragStartRot = 0                           // 按下时 rot.val
    let dragMoved = false                          // 位移超阈值则非点击
    let vel = 0                                    // 惯性角速度（弧度/秒）
    let lastMoveX = 0                              // 最近一次 move 的 clientX（测松手速度）
    // 惯性初速采样：拖拽 move 期间记录近 100ms 的 (时间戳, 横向位移) 样本，
    // 松手取总和/时间跨度的平均速度，抗手抖（原单帧法手抖即丢惯性）
    const velSamples: { t: number; dx: number }[] = []

    // 四段式入场编排：由渲染循环读这些进度变量驱动姿态
    const yLift3     = { val: 0 }   // 动作2 中间3本上升
    const yLiftRest  = { val: 0 }   // 动作2 其余10本跟上
    const selectIntro = { val: 0 }  // 动作4 中间本首演抽出进度（入场一次性，结束后=1）
    const retreatP   = { val: 0 }   // 动作4 12本远离到 z=17
    const spreadP    = { val: 0 }   // 动作4 12本远离时 1.2x 间距渐变
    let introTl: gsap.core.Timeline | null = null
    introTl = gsap.timeline({
      onComplete: () => { introDone = true; onIntroDoneRef.current?.() },
    })
    introTl
      .to(yLift3,      { val: 1, duration: 0.35, ease: 'power2.out' })            // 中间3本上升
      .to(yLiftRest,   { val: 1, duration: 0.3,  ease: 'power2.out' })            // 其余10本跟上
      .to({}, { duration: 0.2 })                                                  // 停顿
      .to(selectIntro, { val: 1, duration: 0.35, ease: 'power2.out' }, '+=0')     // 中间本抽出
      .to(retreatP,    { val: 1, duration: 0.35, ease: 'power2.out' }, '<')       // 12本同步远离
      .to(spreadP,     { val: 1, duration: 0.3,  ease: 'power2.out' })            // 1.2x 间距渐变

    // ---------- 指针事件 ----------
    function mouseToNDC(e: PointerEvent) {
      const rect = container!.getBoundingClientRect()
      return {
        x: ((e.clientX - rect.left) / container!.clientWidth) * 2 - 1,
        y: -((e.clientY - rect.top) / container!.clientHeight) * 2 + 1,
      }
    }

    // 吸附 rot 到最近槽位（中心对齐到一本，固定舞台严丝合缝演出）
    function snapToNearest() {
      if (snapping) return
      const effStep = ANGLE_STEP * (1 + SPREAD_MAX * spreadP.val)
      const targetSlot = Math.round(-rot.val / effStep)
      const target = -targetSlot * effStep
      snapping = true
      gsap.to(rot, {
        val: target,
        duration: 0.5,
        ease: 'back.out(1.4)',
        overwrite: 'auto',
        onComplete: () => { snapping = false },
      })
    }

    // 中断吸附/惯性，进入新的拖拽
    function beginDrag(clientX: number) {
      // 不立即打断 snap/点击演出：拖拽超阈值才 kill，纯点击则让演出继续（点击忽略原则）
      vel = 0
      dragging = true
      dragMoved = false
      dragStartX = clientX
      dragStartRot = rot.val
      lastMoveX = clientX
      velSamples.length = 0
    }

    // 屏幕空间投影命中：把书的实际渲染 position 投影到 NDC，算点击点到各书屏幕点的距离，
    // 取最近且 ≤ 阈值。替代原 3D 命中球——球半径(2.3)≫书间距(1.4)致相邻球重叠，
    // 且抽出本前移 z 更大→distance 更小霸屏误进详情。屏幕投影与 z 无关，点哪是哪。
    const _projVec = new THREE.Vector3()
    function nearestBookOnScreen(ndc: { x: number; y: number }): { book: BookSlot; dist: number } | null {
      let nearest: BookSlot | null = null
      let nearestDist = Infinity
      for (const book of allSlots) {
        _projVec.copy(book.group.position).project(camera)
        const dx = _projVec.x - ndc.x
        const dy = _projVec.y - ndc.y
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (dist < nearestDist) {
          nearestDist = dist
          nearest = book
        }
      }
      return nearest ? { book: nearest, dist: nearestDist } : null
    }

    // 命中当前中心抽出本（用于点击打开 / 中键轨道球触发判定）
    function hitsCenterBook(ndc: { x: number; y: number }): boolean {
      const currentBook = slotMap.get(currentSlot)
      if (!currentBook) return false
      const hit = nearestBookOnScreen(ndc)
      return hit !== null && hit.book.slotIndex === currentSlot && hit.dist <= HIT_NDC_THRESHOLD_CURRENT
    }

    // 命中任意一本书（最近且在阈值内），用于点击滑轨上任意书触发演出。
    // 中心抽出本用更大阈值（侧倾后仰致视觉中心偏离几何中心），其余用标准阈值
    function hitAnyBook(ndc: { x: number; y: number }): BookSlot | null {
      const hit = nearestBookOnScreen(ndc)
      if (!hit) return null
      const threshold = hit.book.slotIndex === currentSlot ? HIT_NDC_THRESHOLD_CURRENT : HIT_NDC_THRESHOLD
      return hit.dist <= threshold ? hit.book : null
    }

    // 点击演出：tween rot 到目标槽（最短弧、按距离缩放时长），currentSlot 自然变为目标，
    // select 随之升起抽出。演出期归入 snapping 态（position 刚性直设），拖拽可打断、点击忽略
    function flyToSlot(targetSlot: number) {
      if (snapping) gsap.killTweensOf(rot)
      vel = 0
      const effStep = ANGLE_STEP * (1 + SPREAD_MAX * spreadP.val)
      const target = -targetSlot * effStep
      const steps = Math.abs(target - rot.val) / effStep
      const duration = Math.min(0.8, 0.4 + steps * 0.05)
      snapping = true
      gsap.to(rot, {
        val: target,
        duration,
        ease: 'power3.out',
        overwrite: 'auto',
        onComplete: () => { snapping = false },
      })
    }

    // 进入轨道球：对齐 rot 到最近槽（稳定 currentSlot），清零惯性，避免旋转中 currentSlot 漂移
    function enterOrbit() {
      if (snapping) { gsap.killTweensOf(rot); snapping = false }
      vel = 0
      const effStep = ANGLE_STEP * (1 + SPREAD_MAX * spreadP.val)
      rot.val = -Math.round(-rot.val / effStep) * effStep
      orbiting = true
    }

    function onPointerEnter(e: PointerEvent) {
      pointerInside = true
      const ndc = mouseToNDC(e)
      targetMouse.x = ndc.x
      targetMouse.y = ndc.y
      // 入场期间禁止交互（动画必须播完），仅记录鼠标位置
    }

    function onPointerMove(e: PointerEvent) {
      const ndc = mouseToNDC(e)
      targetMouse.x = ndc.x
      targetMouse.y = ndc.y
      if (!introDone) return
      if (orbiting) return   // 轨道球中：鼠标位置由渲染循环驱动三轴旋转，不拖拽
      if (!dragging) return
      // 未超点击位移阈值：不动 rot，让进行中的点击演出继续（点击忽略原则）
      if (Math.abs(e.clientX - dragStartX) <= CLICK_MOVE_PX) return
      if (!dragMoved) {
        dragMoved = true
        // 超阈值才打断 snap/演出，并从当前 rot 位置接管，避免回退
        if (snapping) { gsap.killTweensOf(rot); snapping = false }
        dragStartRot = rot.val
        dragStartX = e.clientX
        lastMoveX = e.clientX
      }
      // 1:1 抓取：按下点贴住指针，鼠标横向位移直接映射 rot
      rot.val = dragStartRot + (e.clientX - dragStartX) * PIXEL_TO_ANGLE
      const now = performance.now()
      velSamples.push({ t: now, dx: e.clientX - lastMoveX })
      while (velSamples.length && now - velSamples[0].t > 100) velSamples.shift()
      lastMoveX = e.clientX
    }

    function onPointerDown(e: PointerEvent) {
      // 入场期间完全吞掉所有交互
      if (!introDone) return
      // 中键：toggle 轨道球（仅当命中中心抽出本）
      if (e.button === 1) {
        e.preventDefault()
        if (orbiting) { orbiting = false; return }
        const ndc = mouseToNDC(e)
        if (hitsCenterBook(ndc)) enterOrbit()
        return
      }
      // 左键：若在轨道球态则拖拽自动退出轨道球。退出轨道球的这一次 down 不进入拖拽/点击
      // （否则无位移松手会命中中心本触发 onBookClick，把"退出轨道球"误变成"打开文章"）
      if (e.button === 0) {
        if (orbiting) { orbiting = false; return }
        beginDrag(e.clientX)
        try { container!.setPointerCapture(e.pointerId) } catch { /* pointer capture 失败可忽略 */ }
      }
    }

    // 结束拖拽：释放 capture、置 dragging=false。cancelled 时丢弃惯性并对齐。
    // 点击判定与惯性初速计算需要完整 PointerEvent（clientX/clientY），留在 onPointerUp 处理
    function endDrag(pointerId: number, cancelled: boolean) {
      if (!dragging) return
      try { container!.releasePointerCapture(pointerId) } catch { /* pointer capture 失败可忽略 */ }
      dragging = false
      if (cancelled) { vel = 0; snapToNearest() }
    }

    function onPointerUp(e: PointerEvent) {
      if (!introDone) return
      if (e.button !== 0 || !dragging) return
      if (!dragMoved) {
        // 短按点击：释放 capture、退出拖拽态。须用真实 clientY 算 NDC，否则 ndc.y=NaN 命中失败
        try { container!.releasePointerCapture(e.pointerId) } catch { /* pointer capture 失败可忽略 */ }
        dragging = false
        // 点击演出进行中：忽略本次点击，让演出继续播完
        if (snapping) return
        const ndc = mouseToNDC(e)
        const hit = hitAnyBook(ndc)
        if (!hit) { snapToNearest(); return }        // 点击空白：对齐到最近槽
        if (hit.slotIndex === currentSlot) {
          // 已是中心抽出本：再点一次打开文章
          onBookClick(hit.stem)
        } else {
          // 滑轨上任意书：演出滑到中心并抽出（不自动打开）
          flyToSlot(hit.slotIndex)
        }
        return
      }
      // 拖拽结束：用松手前近 100ms 的速度采样算惯性初速（弧度/秒）。
      // span 下限 16ms，防止 up 与最后一次 move 间隔过小把抖动放大成猛烈甩动
      const now = performance.now()
      if (velSamples.length > 0) {
        const sumDx = velSamples.reduce((s, v) => s + v.dx, 0)
        const span = Math.max(16, now - velSamples[0].t)
        vel = (sumDx * PIXEL_TO_ANGLE) / (span / 1000)
      } else {
        vel = 0
      }
      velSamples.length = 0
      endDrag(e.pointerId, false)
      // 速度过小直接 snap，否则进入惯性衰减（由渲染循环处理）
      if (Math.abs(vel) < VEL_SNAP_THRESHOLD) { vel = 0; snapToNearest() }
    }

    // pointercancel：触屏 pan-y 下手势被判为竖向滚动时浏览器发 cancel 而非 up，
    // 必须在此结束拖拽，否则 dragging 永真、capture 悬空、hover 闸门锁死
    function onPointerCancel(e: PointerEvent) {
      endDrag(e.pointerId, true)
    }

    function onPointerLeave() {
      pointerInside = false
      // 拖拽中途离开容器：丢弃惯性并对齐（pointer capture 通常会抑制 leave，此处兜底；
      // pointerId 已不可得，传 -1 让 releasePointerCapture 在 try/catch 中安全失败）
      if (dragging) endDrag(-1, true)
      // 离开容器：吸附 rot 到最近槽位（中心对齐到一本）
      if (introDone && !snapping) snapToNearest()
    }

    // 中键默认行为（浏览器自动滚动）拦截：pointerdown 之外再拦 mousedown
    function onMouseDown(e: MouseEvent) {
      if (e.button === 1) e.preventDefault()
    }

    // 空格 toggle 轨道球 / Esc 退出轨道球（三重闸门：路由红利随组件卸载、焦点、可见性）
    function isTypingTarget(): boolean {
      const el = document.activeElement as HTMLElement | null
      if (!el) return false
      const tag = (el.tagName || '').toUpperCase()
      return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable === true
    }
    let shelfVisible = true
    function onKeyDown(e: KeyboardEvent) {
      if (!introDone || !shelfVisible) return
      // 按住不放的自动重复事件不重复触发 toggle，避免轨道球态频闪
      if (e.repeat) return
      if (e.code === 'Escape') {
        if (orbiting) { orbiting = false; e.preventDefault() }
        return
      }
      if (e.code === 'Space') {
        if (isTypingTarget()) return
        // 拖拽进行中不进轨道球，避免 dragging+orbiting 冲突与残留 vel
        if (dragging) return
        e.preventDefault()
        if (orbiting) orbiting = false
        else enterOrbit()
      }
    }

    container.addEventListener('pointerenter', onPointerEnter)
    container.addEventListener('pointermove', onPointerMove)
    container.addEventListener('pointerdown', onPointerDown)
    container.addEventListener('pointerup', onPointerUp)
    container.addEventListener('pointercancel', onPointerCancel)
    container.addEventListener('pointerleave', onPointerLeave)
    container.addEventListener('mousedown', onMouseDown)
    window.addEventListener('keydown', onKeyDown)

    const io = new IntersectionObserver(
      (entries) => { shelfVisible = entries[0]?.intersectionRatio >= 0.5 },
      { threshold: [0, 0.5, 1] },
    )
    io.observe(container)

    // ---------- 响应式 ----------
    function onResize() {
      const w = container!.clientWidth
      const h = container!.clientHeight
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
    }

    const ro = new ResizeObserver(onResize)
    ro.observe(container)

    // ---------- 换皮（虚拟化）：滑出窗口的书移到另一端并换纹理 ----------
    function reflow() {
      const effStep = ANGLE_STEP * (1 + SPREAD_MAX * spreadP.val)
      for (const book of allSlots) {
        const pos = book.slotIndex + rot.val / effStep
        let moved = false
        let dataOffset = 0
        if (pos > half + 0.5) {
          slotMap.delete(book.slotIndex)
          book.slotIndex -= slots
          dataOffset = -slots
          moved = true
        } else if (pos < -half - 0.5) {
          slotMap.delete(book.slotIndex)
          book.slotIndex += slots
          dataOffset = slots
          moved = true
        }
        if (moved) {
          const newDataIndex = ((book.dataIndex + dataOffset) % N + N) % N
          applySkin(book, newDataIndex)
          slotMap.set(book.slotIndex, book)
          // 瞬移的书重置 select（屏外书非抽出态）
          book.select = 0
          // 立即重置到屏外新位置，避免跨屏飞入中间
          const isCurrent = book.slotIndex === currentSlot
          const a = book.slotIndex * effStep + rot.val
          const lift = book.isCenter3 ? yLift3.val : yLiftRest.val
          book.group.position.x = Math.sin(a) * RADIUS
          book.group.position.y = LIFT_FROM_Y * (1 - lift)
          if (isCurrent) {
            book.group.position.z = RADIUS + FOCAL_Z * book.select
          } else {
            book.group.position.z = RADIUS + RETREAT_Z * retreatP.val
          }
          book.group.rotation.y = isCurrent
            ? a + (Math.PI / 2) * (1 - book.select)
            : a + Math.PI / 2 + (book.slotIndex - currentSlot) * FAN_TILT * retreatP.val
        }
      }
    }

    // ---------- 动画循环 ----------
    let elapsedTime = 0
    let lastFrameTime = performance.now()
    let rafId = 0

    function animate() {
      rafId = requestAnimationFrame(animate)
      const now = performance.now()
      const dt = (now - lastFrameTime) / 1000
      elapsedTime += dt
      lastFrameTime = now

      // 鼠标平滑跟随（dt 缩放）
      const mouseSmooth = 1 - Math.pow(0.92, dt * 60)
      mouse.x += (targetMouse.x - mouse.x) * mouseSmooth
      mouse.y += (targetMouse.y - mouse.y) * mouseSmooth
      mouseLight.position.set(mouse.x * 6, mouse.y * 4, 28)

      // 动态槽位角步长（入场后随 spreadP 放大到 1.2x）
      const effStep = ANGLE_STEP * (1 + SPREAD_MAX * spreadP.val)

      // 惯性衰减：松手后按角速度累加 rot，指数摩擦，速度过低时 snap 到最近槽
      if (!dragging && !orbiting && vel !== 0) {
        if (snapping) { gsap.killTweensOf(rot); snapping = false }
        rot.val += vel * dt
        vel *= Math.pow(DRAG_FRICTION, dt * 60)
        if (Math.abs(vel) < VEL_SNAP_THRESHOLD) {
          vel = 0
          snapToNearest()
        }
      }

      // 当前正前方槽位（固定舞台：滑到中心的书做抽出动作）
      currentSlot = Math.round(-rot.val / effStep)

      // 换皮虚拟化
      if (virtual) reflow()

      // 相机固定（不随鼠标视差，避免整体晃动；只有书在动）
      camera.lookAt(0, 0, 0)

      // hover 检测：仅当前中心抽出本（指针在容器内、未拖拽、未吸附、无惯性）
      let currentHovered = false
      if (introDone && pointerInside && !dragging && !snapping && vel === 0) {
        const currentBook = slotMap.get(currentSlot)
        if (currentBook) {
          const hit = nearestBookOnScreen(mouse)
          if (hit && hit.book.slotIndex === currentSlot && hit.dist <= HIT_NDC_THRESHOLD_CURRENT) {
            currentHovered = true
            hoverLostFrames = 0
          } else {
            hoverLostFrames++
            if (hoverLostFrames >= HOVER_LOST_THRESHOLD) currentHovered = false
            else currentHovered = isCurrentHovered
          }
        }
      } else {
        hoverLostFrames = HOVER_LOST_THRESHOLD
      }
      isCurrentHovered = currentHovered

      // 每本书的姿态：滑到中心(currentSlot)的书做抽出动作，其余待机；入场由进度变量驱动
      // 刚性期（拖拽/惯性/吸附/点击演出）：position 与 rotation 直设，避免 lerp 追不上快拖
      // 导致书挤到拖动方向尾端；lerp 只留给入场、select 爬升、hover 微调
      const rigid = dragging || vel !== 0 || snapping
      const smooth = rigid ? 1 : 1 - Math.pow(0.9, dt * 60)
      for (const book of allSlots) {
        const isCurrent = book.slotIndex === currentSlot
        const a = book.slotIndex * effStep + rot.val

        // 各自的抽出进度：入场中间本跟随 selectIntro 编排；其余 lerp 向 (isCurrent?1:0)
        // select 用独立更快系数（SELECT_LERP），与姿态丝滑系数解耦——快速滑动中 currentSlot 切换快，
        // select 须尽快爬到 1，否则纵深/缩放/光泽/翻面演出全被压制成"浅浅动一下"
        const introCenter = !introDone && book.slotIndex === 0
        const targetSelect = introCenter ? selectIntro.val : (isCurrent ? 1 : 0)
        const selectSmooth = 1 - Math.pow(1 - SELECT_LERP, dt * 60)
        book.select += (targetSelect - book.select) * selectSmooth

        const targetX = Math.sin(a) * RADIUS
        // 入场 y：中间3本用 yLift3，其余用 yLiftRest，都从 LIFT_FROM_Y 升到 0
        const lift = book.isCenter3 ? yLift3.val : yLiftRest.val
        const targetY = LIFT_FROM_Y * (1 - lift)

        // z：抽出本随 select 前突到 RADIUS+FOCAL_Z；其余12本随 retreatP 远离到 RADIUS+RETREAT_Z(17) 并稳定停住
        let targetZ: number
        if (isCurrent) {
          targetZ = RADIUS + FOCAL_Z * book.select
        } else {
          targetZ = RADIUS + RETREAT_Z * retreatP.val
        }

        book.group.position.x += (targetX - book.group.position.x) * smooth
        book.group.position.y += (targetY - book.group.position.y) * smooth
        book.group.position.z += (targetZ - book.group.position.z) * smooth

        // 抽出态基础斜放（书脊底角朝下近、书口朝上远）
        const baseTiltX = CURRENT_TILT_X * book.select
        const baseTiltZ = CURRENT_TILT_Z * book.select

        if (isCurrent && orbiting && introDone) {
          // 长按左键轨道球：原始鼠标位置直接驱动三轴旋转（即时跟随），可看书的各个面
          // targetMouse.x∈[-1,1] → rotation.y ±π（封面/书脊/背面），targetMouse.y → rotation.x ±0.8（上下）
          book.group.rotation.x = targetMouse.y * 0.8
          book.group.rotation.y = targetMouse.x * Math.PI
          book.group.rotation.z = 0
        } else {
          // 非hover：抽出本从书脊朝外（a+π/2）转到封面朝外（a）；
          // 其余12本书脊朝外，远离时绕 y 微旋（左侧顺时针/右侧逆时针，slotIndex 正负定方向），呈捧中间姿态
          const targetRotY = isCurrent
            ? a + (Math.PI / 2) * (1 - book.select)
            : a + Math.PI / 2 + (book.slotIndex - currentSlot) * FAN_TILT * retreatP.val
          let rotDelta = targetRotY - book.group.rotation.y
          rotDelta = (((rotDelta % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI
          book.group.rotation.y += rotDelta * smooth
          book.group.rotation.x += (baseTiltX - book.group.rotation.x) * smooth
          book.group.rotation.z += (baseTiltZ - book.group.rotation.z) * smooth
        }

        // 光泽强度：抽出本即亮（解耦 hover——滑动中 dragging/vel 非 0 时 hover 闸门关闭，光泽本该灭；
        // 改为 isCurrent 持续亮，让"当前抽出本"始终有视觉标识）。hover 不再额外叠加
        const targetIntensity = isCurrent ? 0.25 : 0.0
        book.frontUniforms.uIntensity.value += (targetIntensity - book.frontUniforms.uIntensity.value) * smooth

        // 缩放：抽出本随 select 放大到 CURRENT_SCALE，用尺寸补强被削弱的纵深演出
        const targetScale = 1 + (CURRENT_SCALE - 1) * book.select
        const s = book.group.scale.x + (targetScale - book.group.scale.x) * smooth
        book.group.scale.setScalar(s)
        book.frontUniforms.uTime.value = elapsedTime
        book.frontUniforms.uMouse.value.set(
          (mouse.x + 1) * 0.5,
          (mouse.y + 1) * 0.5,
        )
      }

      renderer.render(scene, camera)
    }

    animate()

    // ---------- 清理 ----------
    return () => {
      cancelAnimationFrame(rafId)
      ro.disconnect()
      io.disconnect()
      container.removeEventListener('pointerenter', onPointerEnter)
      container.removeEventListener('pointerdown', onPointerDown)
      container.removeEventListener('pointermove', onPointerMove)
      container.removeEventListener('pointerup', onPointerUp)
      container.removeEventListener('pointercancel', onPointerCancel)
      container.removeEventListener('pointerleave', onPointerLeave)
      container.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('keydown', onKeyDown)
      gsap.killTweensOf(rot)
      introTl?.kill()
      container.removeChild(renderer.domElement)
      renderer.dispose()

      sharedGeo.dispose()
      edgeTex.dispose()
      topBotTex.dispose()
      skinPool.forEach(skin => {
        skin.cover.dispose()
        skin.spine.dispose()
        skin.back.dispose()
      })
      allSlots.forEach(book => {
        book.coverMat.dispose()
        book.spineMat.dispose()
        book.backMat.dispose()
      })
      renderer.renderLists.dispose()
    }
  }, [pages, onBookClick])

  return <div ref={containerRef} className="book-shelf-3d" />
}
