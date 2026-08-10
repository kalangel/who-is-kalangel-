/**
 * Сцена целиком. Один рендер, семь актов, одна управляющая величина.
 *
 *   0.00–0.22  затмение: кольцо, марка в тени
 *   0.22–0.46  тело сжимается, свет заливает экран
 *   0.42–0.50  белое
 *   0.46–0.62  белое сужается: это была поверхность одной звезды
 *   0.62–0.88  отъезд, вокруг проступают другие гиганты
 *   0.80–0.93  гиганты складываются в марку
 *   0.93–1.00  схлопывание в точку
 *
 * Акты не переключаются — они перекрываются окнами smoothstep. Между ними
 * нет ни одного момента, где что-то возникает или пропадает скачком.
 */

import { buildCoronaTexture } from './corona'
import { createSky, type Camera } from './sky'
import { buildGranulation } from './surface'

const BG = '#050302'

const HOT = '#FF8A1F'

const MAX_DPR = 2

export interface Scene {
  setPhase(p: number): void
  destroy(): void
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

function smoothstep(a: number, b: number, x: number) {
  const t = clamp01((x - a) / (b - a || 1))
  return t * t * (3 - 2 * t)
}

/** Колокол: 0 → 1 → 0 внутри окна. Для одноразовых событий вроде вспышки. */
function bump(a: number, b: number, x: number) {
  if (x <= a || x >= b) return 0
  return Math.sin(((x - a) / (b - a)) * Math.PI)
}

/**
 * Точки четырёхлучевой марки. Та же геометрия, что в вордмарке и во вспышке:
 * вертикальные лучи длинные, горизонтальные короткие, стороны вогнутые.
 * Возвращает контур в единичных координатах.
 */
function markOutline(steps: number): Array<[number, number]> {
  const v = 1
  const h = 0.42
  const seg: Array<[number, number][]> = [
    [
      [0, -v],
      [h * 0.08, -v * 0.3],
      [h * 0.3, -v * 0.08],
      [h, 0],
    ],
    [
      [h, 0],
      [h * 0.3, v * 0.08],
      [h * 0.08, v * 0.3],
      [0, v],
    ],
    [
      [0, v],
      [-h * 0.08, v * 0.3],
      [-h * 0.3, v * 0.08],
      [-h, 0],
    ],
    [
      [-h, 0],
      [-h * 0.3, -v * 0.08],
      [-h * 0.08, -v * 0.3],
      [0, -v],
    ],
  ]

  const pts: Array<[number, number]> = []
  const per = Math.max(2, Math.round(steps / 4))
  for (const [p0, p1, p2, p3] of seg) {
    for (let i = 0; i < per; i++) {
      const t = i / per
      const mt = 1 - t
      const x =
        mt * mt * mt * p0[0] + 3 * mt * mt * t * p1[0] + 3 * mt * t * t * p2[0] + t * t * t * p3[0]
      const y =
        mt * mt * mt * p0[1] + 3 * mt * mt * t * p1[1] + 3 * mt * t * t * p2[1] + t * t * t * p3[1]
      pts.push([x, y])
    }
  }
  return pts
}

interface Giant {
  x: number
  y: number
  /** Вес звезды: величина на карте. Одинаковые точки читаются бусами. */
  mag: number
  tw: number
}

/**
 * Расставляет гигантов по контуру марки НЕРОВНО.
 *
 * Равный шаг и одинаковый размер превращают созвездие в бусы на нитке.
 * У настоящих созвездий шаг рваный, а яркости разные — рисунок держится
 * на нескольких крупных, остальные подхватывают.
 */
function placeGiants(outline: Array<[number, number]>, count: number): Giant[] {
  let seed = 991
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 4294967296
  }

  const giants: Giant[] = []
  for (let i = 0; i < count; i++) {
    // Неравномерный шаг по контуру плюс смещение поперёк него.
    const t = (i + (rnd() - 0.5) * 0.72) / count
    const idx = Math.max(0, Math.min(outline.length - 1, Math.round(t * outline.length)))
    const [ox, oy] = outline[idx]
    const jitter = 0.05
    giants.push({
      x: ox * (1 + (rnd() - 0.5) * jitter) + (rnd() - 0.5) * 0.03,
      y: oy * (1 + (rnd() - 0.5) * jitter) + (rnd() - 0.5) * 0.03,
      // Четыре-пять крупных держат рисунок, прочие мельче.
      mag: rnd() < 0.28 ? 1 : 0.45 + rnd() * 0.3,
      tw: rnd() * Math.PI * 2,
    })
  }
  // Вершины лучей обязаны быть яркими — иначе марка не читается.
  for (const [tx, ty] of [
    [0, -1],
    [0.42, 0],
    [0, 1],
    [-0.42, 0],
  ]) {
    giants.push({ x: tx, y: ty, mag: 1.25, tw: rnd() * Math.PI * 2 })
  }
  return giants
}

export function createScene(canvas: HTMLCanvasElement, wordmark: HTMLElement): Scene {
  const ctx = canvas.getContext('2d', { alpha: false })!
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  const corona = buildCoronaTexture(7)
  const grain = buildGranulation(3)
  const giants = placeGiants(markOutline(160), 16)

  let w = 0
  let h = 0
  let unit = 0
  let phase = 0
  let raf = 0
  let start = performance.now()

  const sky = createSky(1, 1, reduced)

  // Направление, в котором утекает свет. Задаёт посетитель.
  let aimX = -0.86
  let aimY = -0.5
  let curX = aimX
  let curY = aimY
  let steered = false

  function measure() {
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR)
    w = canvas.clientWidth
    h = canvas.clientHeight
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    unit = Math.min(w, h)
    sky.resize(w, h)
  }

  function aim(t: number) {
    if (!steered) {
      aimX = Math.cos(t * 0.16 - 2.6)
      aimY = Math.sin(t * 0.16 - 2.6) * 0.55
    }
    const k = reduced ? 1 : 0.045
    curX += (aimX - curX) * k
    curY += (aimY - curY) * k
  }

  function draw(now: number) {
    const t = (now - start) / 1000
    aim(t)

    const cx = w / 2
    const cy = h / 2

    // ── управляющие величины ─────────────────────────────────────────
    const shrink = smoothstep(0.22, 0.46, phase) // тело сжимается в точку
    // Засветка обязана СПАДАТЬ после белого: пока она держалась на единице,
    // диск был выбит в белое и никакой поверхности на нём не читалось.
    const flood =
      smoothstep(0.3, 0.44, phase) * (1 - smoothstep(0.46, 0.62, phase) * 0.88)
    const white = bump(0.4, 0.52, phase) // белое
    const reveal = smoothstep(0.46, 0.62, phase) // белое сужается в звезду
    const pull = smoothstep(0.62, 0.88, phase) // отъезд
    const form = smoothstep(0.78, 0.93, phase) // складывается марка
    const collapse = smoothstep(0.93, 1, phase) // схлопывание

    // Радиус светила по актам. В третьем акте звезда занимает ~75% короткой
    // стороны экрана, дальше отъезд уводит её в один гигант среди прочих.
    const rEclipse = unit * 0.2
    const rGiant = unit * 0.375
    const rFar = unit * 0.028
    let starR = lerp(rEclipse, rGiant, reveal)
    starR = lerp(starR, rFar, pull)
    starR *= 1 - collapse

    const bodyR = rEclipse * 0.976 * (1 - shrink)

    // Небо не видно рядом с открытым светом — и возвращается на отъезде.
    const skyDim = clamp01(1 - flood * 0.96 + pull * 0.98)

    const cam: Camera = {
      px: curX,
      py: curY,
      dim: skyDim,
      zoom: lerp(1, 1.5, pull),
    }

    // ── 1. фон и небо ────────────────────────────────────────────────
    ctx.globalCompositeOperation = 'source-over'
    ctx.fillStyle = BG
    ctx.fillRect(0, 0, w, h)
    if (skyDim > 0.02) sky.draw(ctx, w, h, t, cam)

    // ── 2. корона ────────────────────────────────────────────────────
    // Живёт в первых актах: у открытой звезды её забивает собственный свет.
    const coronaAlpha = (1 - reveal) * (0.35 + 0.65 * shrink)
    if (coronaAlpha > 0.02) {
      const field = rEclipse * 2.2
      const off = rEclipse * 0.06
      ctx.globalCompositeOperation = 'lighter'
      drawField(cx - curX * off, cy - curY * off, field, t * 0.012, 0.85 * coronaAlpha)
      drawField(cx + curX * off, cy + curY * off, field * 0.92, -t * 0.008, 0.4 * coronaAlpha)
    }

    // ── 3. светило ───────────────────────────────────────────────────
    if (starR > 0.5) {
      ctx.globalCompositeOperation = 'source-over'
      ctx.save()
      ctx.shadowColor = HOT
      ctx.shadowBlur = starR * (0.2 + 0.45 * flood)
      // Крупная звезда темнее и насыщеннее мелкой: на почти белом диске
      // гранулы не видны в принципе, каким бы режимом их ни класть.
      const hot = reveal
      const disc = ctx.createRadialGradient(cx, cy, starR * 0.15, cx, cy, starR)
      disc.addColorStop(0, hot > 0.5 ? '#FFE3A6' : '#FFF0D2')
      disc.addColorStop(0.6, hot > 0.5 ? '#FBA83C' : '#FFD489')
      disc.addColorStop(1, hot > 0.5 ? '#D9540F' : '#FF9A3C')
      ctx.fillStyle = disc
      ctx.beginPath()
      ctx.arc(cx, cy, starR, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()

      // Поверхность. Появляется только когда звезда крупная — на маленьком
      // диске гранулы превращаются в грязь.
      const surf = reveal * (1 - pull)
      if (surf > 0.02) drawSurface(cx, cy, starR, t, surf)
    }

    // ── 4. тело затмения ─────────────────────────────────────────────
    if (bodyR > 0.5) {
      ctx.globalCompositeOperation = 'source-over'
      const bx = cx - curX * rEclipse * 0.045
      const by = cy - curY * rEclipse * 0.045
      const fill = ctx.createRadialGradient(bx, by, 0, bx, by, bodyR)
      fill.addColorStop(0, '#140805')
      fill.addColorStop(1, BG)
      ctx.fillStyle = fill
      ctx.beginPath()
      ctx.arc(bx, by, bodyR, 0, Math.PI * 2)
      ctx.fill()
    }

    // ── 5. засветка и белое ──────────────────────────────────────────
    if (flood > 0.01) {
      const g = ctx.createRadialGradient(cx, cy, starR * 0.4, cx, cy, unit * 1.1)
      g.addColorStop(0, `rgba(255, 240, 210, ${0.85 * flood})`)
      g.addColorStop(0.5, `rgba(255, 154, 60, ${0.45 * flood})`)
      g.addColorStop(1, 'rgba(255, 138, 31, 0)')
      ctx.globalCompositeOperation = 'lighter'
      ctx.fillStyle = g
      ctx.fillRect(0, 0, w, h)
    }
    if (white > 0.01) {
      ctx.globalCompositeOperation = 'lighter'
      ctx.fillStyle = `rgba(255, 248, 236, ${white})`
      ctx.fillRect(0, 0, w, h)
    }

    // ── 6. созвездие ─────────────────────────────────────────────────
    // Гиганты стоят на своих местах всегда. Отъезд их не создаёт, а
    // показывает: зритель смотрел на марку с первой секунды.
    if (pull > 0.02) drawConstellation(cx, cy, t, pull, form, collapse)

    // ── 7. виньетка и схлопывание ────────────────────────────────────
    const vign = ctx.createRadialGradient(cx, cy, unit * 0.32, cx, cy, Math.max(w, h) * 0.78)
    vign.addColorStop(0, 'rgba(5, 3, 2, 0)')
    vign.addColorStop(1, 'rgba(5, 3, 2, 0.7)')
    ctx.globalCompositeOperation = 'source-over'
    ctx.fillStyle = vign
    ctx.fillRect(0, 0, w, h)

    if (collapse > 0) {
      const k = 1 - collapse
      ctx.globalCompositeOperation = 'multiply'
      ctx.fillStyle = `rgb(${Math.round(255 * Math.min(1, k * 1.06))}, ${Math.round(255 * k)}, ${Math.round(255 * Math.max(0, k * 0.86))})`
      ctx.fillRect(0, 0, w, h)
    }

    ctx.globalCompositeOperation = 'source-over'
    if (!reduced) raf = requestAnimationFrame(draw)
  }

  /**
   * Гранулы конвекции. Текстура ЗАМОЩАЕТСЯ, а не растягивается по диску:
   * растянутая на 1000 px даёт десяток размытых пятен вместо сотни ячеек,
   * и вся детализация пропадает. Замощение задаёт размер ячейки в пикселях
   * экрана и не зависит от того, насколько крупна звезда.
   *
   * Текстура бесшовна по построению (шум с заворотом), поэтому стыков нет.
   */
  function drawSurface(cx: number, cy: number, r: number, t: number, alpha: number) {
    ctx.save()
    ctx.beginPath()
    ctx.arc(cx, cy, r * 0.998, 0, Math.PI * 2)
    ctx.clip()

    // Три прохода: крупные борозды, мелкая рябь, светлые ядра ячеек.
    // Одним режимом не обойтись — на светлом диске нужно и темнить, и светлить.
    const passes = [
      { tile: 340, speed: 0.9, drift: 0.006, alpha: 0.85, mode: 'multiply' as const },
      { tile: 150, speed: -1.4, drift: -0.011, alpha: 0.5, mode: 'multiply' as const },
      { tile: 260, speed: 0.6, drift: 0.004, alpha: 0.4, mode: 'lighter' as const },
    ]

    for (const p of passes) {
      const pat = ctx.createPattern(grain, 'repeat')
      if (!pat) continue
      const k = p.tile / grain.width
      const m = new DOMMatrix()
        .translateSelf(cx + t * p.speed * 6, cy + t * p.speed * 2.5)
        .rotateSelf((t * p.drift * 180) / Math.PI)
        .scaleSelf(k, k)
      pat.setTransform(m)

      ctx.globalCompositeOperation = p.mode
      ctx.globalAlpha = alpha * p.alpha
      ctx.fillStyle = pat
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2)
    }

    // Потемнение к краю. Без него диск читается наклейкой, а не шаром;
    // у настоящей звезды край заметно темнее и краснее центра.
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
    const limb = ctx.createRadialGradient(cx, cy, r * 0.25, cx, cy, r)
    limb.addColorStop(0, 'rgba(255, 210, 140, 0)')
    limb.addColorStop(0.62, `rgba(200, 74, 12, ${0.2 * alpha})`)
    limb.addColorStop(0.9, `rgba(150, 44, 8, ${0.5 * alpha})`)
    limb.addColorStop(1, `rgba(96, 24, 4, ${0.72 * alpha})`)
    ctx.fillStyle = limb
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2)
    ctx.restore()
  }

  function drawConstellation(
    cx: number,
    cy: number,
    t: number,
    pull: number,
    form: number,
    collapse: number,
  ) {
    // Масштаб мира: на подходе гиганты далеко за кадром, к концу отъезда
    // марка целиком помещается в экран.
    const scale = lerp(unit * 5.5, unit * 0.36, pull) * (1 - collapse)
    const a = pull * (1 - collapse)

    ctx.globalCompositeOperation = 'lighter'

    // Линии звёздной карты: прямые отрезки между звёздами. Раньше линия шла
    // по кривой контура и читалась как обведённый по трафарету путь.
    if (form > 0.02) {
      ctx.strokeStyle = `rgba(255, 205, 145, ${0.22 * form})`
      ctx.lineWidth = 1
      ctx.beginPath()
      giants.forEach((g, i) => {
        const x = cx + g.x * scale
        const y = cy + g.y * scale
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      })
      ctx.stroke()
    }

    for (const g of giants) {
      const x = cx + g.x * scale
      const y = cy + g.y * scale
      if (x < -80 || x > w + 80 || y < -80 || y > h + 80) continue

      const tw = reduced ? 1 : 0.8 + 0.2 * Math.sin(t * 0.55 + g.tw)
      const r = unit * 0.0045 * g.mag * (0.6 + 0.4 * form) * tw
      const glow = r * 8
      const grd = ctx.createRadialGradient(x, y, 0, x, y, glow)
      grd.addColorStop(0, `rgba(255, 246, 232, ${a * tw})`)
      grd.addColorStop(0.18, `rgba(255, 198, 128, ${a * 0.4 * tw})`)
      grd.addColorStop(1, 'rgba(255, 138, 31, 0)')
      ctx.fillStyle = grd
      ctx.fillRect(x - glow, y - glow, glow * 2, glow * 2)

      // Лучики у самых крупных — то, что отличает звезду от кружка.
      if (g.mag > 0.95) {
        ctx.globalAlpha = a * 0.5 * tw
        ctx.fillStyle = 'rgba(255, 240, 214, 1)'
        const l = r * 9
        ctx.fillRect(x - l, y - 0.5, l * 2, 1)
        ctx.fillRect(x - 0.5, y - l * 0.7, 1, l * 1.4)
        ctx.globalAlpha = 1
      }
    }
  }

  function drawField(x: number, y: number, size: number, rot: number, alpha: number) {
    ctx.save()
    ctx.globalAlpha = alpha
    ctx.translate(x, y)
    ctx.rotate(rot)
    ctx.drawImage(corona, -size, -size, size * 2, size * 2)
    ctx.restore()
  }

  function steer(e: PointerEvent) {
    const nx = (e.clientX / w) * 2 - 1
    const ny = (e.clientY / h) * 2 - 1
    const len = Math.hypot(nx, ny) || 1
    aimX = -nx / len
    aimY = -ny / len
    steered = true
    if (reduced) draw(performance.now())
  }

  /** Ловля падающей звезды — единственное, что отвечает на тап, а не на скролл. */
  function tap(e: PointerEvent) {
    sky.catchAt(e.clientX, e.clientY)
  }

  window.addEventListener('pointermove', steer, { passive: true })
  window.addEventListener('pointerdown', steer, { passive: true })
  window.addEventListener('pointerdown', tap, { passive: true })

  const ro = new ResizeObserver(() => {
    measure()
    if (reduced) draw(performance.now())
  })
  ro.observe(canvas)

  measure()
  start = performance.now()
  if (reduced) draw(start)
  else raf = requestAnimationFrame(draw)

  return {
    setPhase(p) {
      phase = clamp01(p)
      // Марка читается только в тени. Открылся свет — знака больше нет.
      wordmark.style.opacity = String(1 - smoothstep(0.05, 0.2, phase))
      if (reduced) draw(performance.now())
    },
    destroy() {
      cancelAnimationFrame(raf)
      ro.disconnect()
      window.removeEventListener('pointermove', steer)
      window.removeEventListener('pointerdown', steer)
      window.removeEventListener('pointerdown', tap)
    },
  }
}
