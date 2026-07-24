/**
 * Canvas 切片 Genie（仿 macOS / geniejs 条带 funnel）
 * collapse: 面板 → 菜单图标
 * expand: 菜单图标 → 面板
 */
import html2canvas from 'html2canvas'

const DEFAULTS = {
  durationCollapse: 480,
  durationExpand: 560,
  slices: 40,
}

function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
}

function rectOf(el) {
  if (!el?.getBoundingClientRect) {
    const vw = window.innerWidth
    const vh = window.innerHeight
    return { left: vw - 48, top: 80, width: 40, height: 40 }
  }
  const r = el.getBoundingClientRect()
  return {
    left: r.left,
    top: r.top,
    width: Math.max(1, r.width),
    height: Math.max(1, r.height),
  }
}

function makeOverlayCanvas() {
  const c = document.createElement('canvas')
  c.className = 'genie-fx-canvas'
  c.setAttribute('aria-hidden', 'true')
  const dpr = window.devicePixelRatio || 1
  Object.assign(c.style, {
    position: 'fixed',
    left: '0',
    top: '0',
    width: '100vw',
    height: '100vh',
    pointerEvents: 'none',
    zIndex: '12000',
  })
  c.width = Math.max(1, Math.floor(window.innerWidth * dpr))
  c.height = Math.max(1, Math.floor(window.innerHeight * dpr))
  document.body.appendChild(c)
  return c
}

async function snapshot(el) {
  const dpr = window.devicePixelRatio || 1
  const scale = Math.min(1.1, Math.max(0.55, 1 / dpr + 0.35))
  return html2canvas(el, {
    backgroundColor: null,
    scale,
    useCORS: true,
    allowTaint: true,
    logging: false,
    scrollX: -window.scrollX,
    scrollY: -window.scrollY,
    windowWidth: document.documentElement.clientWidth,
    windowHeight: document.documentElement.clientHeight,
  })
}

/**
 * progress: 0 = 完整面板几何(panelRect)，1 = 吸入图标(iconRect)
 */
function paintGenie(ctx, shot, panelRect, iconRect, progress, slices) {
  const dpr = window.devicePixelRatio || 1
  const cssW = ctx.canvas.width / dpr
  const cssH = ctx.canvas.height / dpr
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, cssW, cssH)

  const p = Math.max(0, Math.min(1, progress))
  const n = Math.max(16, slices | 0)
  const lerp = (a, b, t) => a + (b - a) * t
  const sliceH = panelRect.height / n
  const srcSliceH = shot.height / n

  for (let i = 0; i < n; i++) {
    const t = n <= 1 ? 0 : i / (n - 1)
    const wave = Math.sin(Math.PI * t) // 中段 1，两端 0
    // 中段稍慢，形成漏斗
    const local = Math.max(0, Math.min(1, p * (0.78 + 0.22 * (1 - wave * 0.35))))
    const e = easeInOut(local)

    const y = lerp(panelRect.top + i * sliceH, iconRect.top + iconRect.height * t, e)
    const h = Math.max(1.1, lerp(sliceH + 1.1, Math.max(1.2, iconRect.height / n + 0.6), e))

    // funnel：中间过程变窄
    const baseW = lerp(panelRect.width, iconRect.width, e)
    const funnel = 1 - 0.62 * Math.sin(Math.PI * e) * (0.25 + 0.75 * wave)
    const w = Math.max(2, baseW * funnel)

    const cx = lerp(panelRect.left + panelRect.width / 2, iconRect.left + iconRect.width / 2, e)
    // 向右侧菜单收束时略带横向弯曲
    const bend = Math.sin(Math.PI * e) * (0.5 - wave) * 18
    const x = cx - w / 2 + bend

    ctx.globalAlpha = 1 - e * 0.12
    ctx.drawImage(
      shot,
      0,
      i * srcSliceH,
      shot.width,
      Math.max(1, srcSliceH + 0.5),
      x,
      y,
      w,
      h
    )
  }
  ctx.globalAlpha = 1
}

function runAnim({ shot, panelRect, iconRect, duration, slices, expand, onDone }) {
  const canvas = makeOverlayCanvas()
  const ctx = canvas.getContext('2d')
  const start = performance.now()
  let raf = 0
  let done = false

  const finish = () => {
    if (done) return
    done = true
    cancelAnimationFrame(raf)
    try {
      canvas.remove()
    } catch (_) {}
    onDone?.()
  }

  const tick = (now) => {
    const raw = Math.min(1, (now - start) / duration)
    // expand: 从图标(1) 到面板(0)；collapse: 0→1
    const progress = expand ? 1 - easeInOut(raw) : easeInOut(raw)
    paintGenie(ctx, shot, panelRect, iconRect, progress, slices)
    if (raw < 1) raf = requestAnimationFrame(tick)
    else finish()
  }
  raf = requestAnimationFrame(tick)
  const kill = setTimeout(finish, duration + 500)
  return () => {
    clearTimeout(kill)
    finish()
  }
}

/** 关闭：面板吸入图标 */
export async function genieCollapse(panel, iconEl, opts = {}) {
  const duration = opts.duration ?? DEFAULTS.durationCollapse
  const slices = opts.slices ?? DEFAULTS.slices
  const panelRect = rectOf(panel)
  const iconRect = rectOf(iconEl)

  let shot
  try {
    shot = await snapshot(panel)
  } catch (e) {
    console.warn('[genie] collapse snapshot failed', e)
    return false
  }

  const prevVis = panel.style.visibility
  const prevOp = panel.style.opacity
  panel.style.visibility = 'hidden'
  panel.style.opacity = '0'

  await new Promise((resolve) => {
    runAnim({
      shot,
      panelRect,
      iconRect,
      duration,
      slices,
      expand: false,
      onDone: resolve,
    })
  })

  panel.style.visibility = prevVis
  panel.style.opacity = prevOp
  return true
}

/** 打开：从图标反向展开到面板 */
export async function genieExpand(panel, iconEl, opts = {}) {
  const duration = opts.duration ?? DEFAULTS.durationExpand
  const slices = opts.slices ?? DEFAULTS.slices
  const iconRect = rectOf(iconEl)

  // 保证布局可测
  const prevVis = panel.style.visibility
  const prevOp = panel.style.opacity
  const prevPtr = panel.style.pointerEvents
  panel.style.visibility = 'hidden'
  panel.style.opacity = '0'
  panel.style.pointerEvents = 'none'
  void panel.offsetWidth
  const panelRect = rectOf(panel)

  let shot
  try {
    // 短时可见抓图（仍 pointer-events none）
    panel.style.visibility = 'visible'
    panel.style.opacity = '1'
    void panel.offsetWidth
    shot = await snapshot(panel)
  } catch (e) {
    console.warn('[genie] expand snapshot failed', e)
    panel.style.visibility = prevVis
    panel.style.opacity = prevOp
    panel.style.pointerEvents = prevPtr
    return false
  }

  panel.style.visibility = 'hidden'
  panel.style.opacity = '0'

  await new Promise((resolve) => {
    runAnim({
      shot,
      panelRect,
      iconRect,
      duration,
      slices,
      expand: true,
      onDone: resolve,
    })
  })

  panel.style.visibility = prevVis || ''
  panel.style.opacity = prevOp || ''
  panel.style.pointerEvents = prevPtr || ''
  return true
}
