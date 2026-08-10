/**
 * Затмение. Canvas 2D, без WebGL — трафик приходит из ТГ, средний Android
 * не должен греться ради фона.
 *
 * Геометрия честная: есть светило радиуса Rs и тело радиуса Rb, которое
 * проезжает по нему. Кольцо, серп, бриллиантовое кольцо и открытый свет —
 * не четыре отдельных эффекта, а четыре положения одной пары кругов.
 * Поэтому переходы между ними непрерывны по определению.
 *
 * Наружу отдаётся ровно один метод: setPhase(p). Всё, что рендер знает о
 * скролле — это число от 0 до 1. См. docs/eclipse-spec.md.
 */

import { buildCoronaTexture } from './corona'

const BG = '#050302'
const CORE = '#FFF4E2'
const HOT = '#FF8A1F'

/** Радиус светила выводится из ширины вордмарка: кольцо описано вокруг логотипа. */
const STAR_FROM_WORDMARK = 1 / 1.6

/**
 * Тело чуть меньше светила — это кольцевое затмение, «ring of fire»
 * из референса, а не полное. При Rb > Rs лимб светила закрывается целиком
 * и тонкого светящегося кольца не остаётся вовсе.
 */
const BODY_RATIO = 0.976

/** Во сколько раз поле короны больше светила. Держать в паре с LIMB. */
const CORONA_SPREAD = 2.2

/**
 * Ход тела в долях Rs при phase = 1. Подобран так, чтобы светило полностью
 * открылось около phase 0.85 — последние 15% скролла остаются на затемнение
 * и ссылку.
 */
const TRAVEL = 2.96

/** Насколько круто скролл разгоняет тело. Больше — дольше держится кольцо. */
const TRAVEL_EASE = 2.6

const MAX_DPR = 2

export interface Eclipse {
  setPhase(p: number): void
  destroy(): void
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

function smoothstep(a: number, b: number, x: number) {
  const t = clamp01((x - a) / (b - a || 1))
  return t * t * (3 - 2 * t)
}

export function createEclipse(canvas: HTMLCanvasElement, wordmark: HTMLElement): Eclipse {
  const ctx = canvas.getContext('2d', { alpha: false })!
  const tex = buildCoronaTexture(7)

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  let w = 0
  let h = 0
  let starR = 0
  let phase = 0
  let raf = 0
  let start = performance.now()

  // Направление, в котором тело сходит со светила. Его задаёт посетитель:
  // указатель или палец. Механика и таймлайн не спорят — скролл двигает тело
  // вдоль оси, ось выбирает человек.
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

    const wmW = wordmark.getBoundingClientRect().width
    const fallback = Math.min(w, h) * 0.52
    starR = (wmW > 40 ? wmW : fallback) * STAR_FROM_WORDMARK
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
    const bodyR = starR * BODY_RATIO

    // Смещение тела вдоль оси. Степенная кривая держит кольцо целым первую
    // четверть скролла, а потом отпускает тело быстро.
    const s = starR * TRAVEL * Math.pow(phase, TRAVEL_EASE)
    const bx = cx + curX * s
    const by = cy + curY * s

    // Насколько светило открыто: 0 — тело целиком внутри диска (кольцо цело),
    // 1 — круги разошлись совсем.
    const open = smoothstep(starR - bodyR, starR + bodyR, s)

    // Финальное затемнение: свет выгорает, остаётся уголёк и ссылка.
    // Начинается заметно раньше конца — на последних 12% скролла занавес
    // не успевал опуститься и CTA оставался на слепящем кадре.
    const veil = smoothstep(0.74, 0.97, phase)

    // 1. фон
    ctx.globalCompositeOperation = 'source-over'
    ctx.fillStyle = BG
    ctx.fillRect(0, 0, w, h)

    // 2. корона. Она видна, пока светило закрыто: открытый свет её забивает.
    const coronaAlpha = 1 - open * 0.6
    if (coronaAlpha > 0.01) {
      const field = starR * CORONA_SPREAD
      const off = starR * 0.06
      ctx.globalCompositeOperation = 'lighter'
      drawField(cx - curX * off, cy - curY * off, field, t * 0.012, 0.85 * coronaAlpha)
      drawField(cx + curX * off, cy + curY * off, field * 0.92, -t * 0.008, 0.4 * coronaAlpha)
    }

    // 3. светило — ровный горячий диск. Кольцо и серп не рисуются отдельно:
    // они получаются сами, когда сверху ляжет тело.
    // source-over, а не lighter: светило — непрозрачное тело, а не свечение.
    // В аддитивном режиме его градиент складывался с короной и выбивался
    // в плоский жёлтый. Свечение даёт отдельный блум по тени.
    ctx.globalCompositeOperation = 'source-over'
    ctx.save()
    ctx.shadowColor = HOT
    ctx.shadowBlur = starR * (0.22 + 0.45 * open)
    const star = ctx.createRadialGradient(cx, cy, starR * 0.2, cx, cy, starR)
    // Тёплое по всей длине. Раньше центр был почти белым, и вместе с
    // засветкой диск уходил в бледно-жёлтый с холодным привкусом — прямое
    // нарушение правила «ни одного холодного пикселя».
    star.addColorStop(0, '#FFF0D2')
    star.addColorStop(0.6, '#FFD489')
    star.addColorStop(1, '#FF9A3C')
    ctx.fillStyle = star
    ctx.beginPath()
    ctx.arc(cx, cy, starR, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()

    // 4. тело. Заливка цветом фона — оно перекрывает и светило, и корону.
    ctx.globalCompositeOperation = 'source-over'
    const bodyFill = ctx.createRadialGradient(bx, by, 0, bx, by, bodyR)
    bodyFill.addColorStop(0, '#140805')
    bodyFill.addColorStop(1, BG)
    ctx.fillStyle = bodyFill
    ctx.beginPath()
    ctx.arc(bx, by, bodyR, 0, Math.PI * 2)
    ctx.fill()

    // 5. бриллиантовое кольцо. Один раз за проход, в момент разрыва кольца,
    // на том краю светила, откуда свет пробивается первым.
    const bead = beadIntensity(s, starR, bodyR)
    if (bead > 0.01) {
      // Кольцо рвётся с той стороны, КУДА уходит тело: там его край первым
      // доходит до края светила. На противоположном краю в этот момент
      // толстый серп, и вспышка в нём просто тонет.
      const px = cx + curX * starR
      const py = cy + curY * starR
      ctx.globalCompositeOperation = 'lighter'
      ctx.save()

      // Мягкое ядро вместо твёрдого шарика: у точечного источника нет
      // видимой границы, а круг с резким краем читается как обычная фигура.
      // Средняя точка тёплая, а не белая: белое на половинной непрозрачности
      // в аддитивном режиме даёт серое пятно — «пепел» вместо свечения.
      const core = ctx.createRadialGradient(px, py, 0, px, py, starR * 0.38 * bead)
      core.addColorStop(0, withAlpha(CORE, bead))
      core.addColorStop(0.22, withAlpha(HOT, bead * 0.5))
      core.addColorStop(1, 'rgba(255, 138, 31, 0)')
      ctx.fillStyle = core
      ctx.fillRect(px - starR, py - starR, starR * 2, starR * 2)

      // Луч — та самая четырёхлучевая звезда из марки. Вспышка и есть знак:
      // единственный кадр, где бренд показывается светом, а не силуэтом.
      //
      // Заливка — градиент от точки, а не ровный цвет: у ровного лучи имеют
      // одинаковую плотность по всей длине и звезда читается наклейкой.
      const v = starR * 0.95 * bead
      const rays = ctx.createRadialGradient(px, py, 0, px, py, v)
      rays.addColorStop(0, withAlpha(CORE, bead))
      rays.addColorStop(0.3, withAlpha(CORE, bead * 0.4))
      rays.addColorStop(1, 'rgba(255, 244, 226, 0)')
      ctx.fillStyle = rays
      flare(ctx, px, py, v, starR * 0.17 * bead)
      ctx.fill()
      ctx.restore()
    }

    // 6. засветка. Открытое светило заливает кадр — но радиально, поэтому
    // углы остаются тёмными и текст по краям читается.
    if (open > 0.01) {
      const flood = ctx.createRadialGradient(cx, cy, starR * 0.5, cx, cy, starR * 3.4)
      flood.addColorStop(0, withAlpha(HOT, 0.4 * open))
      flood.addColorStop(1, 'rgba(255, 138, 31, 0)')
      ctx.globalCompositeOperation = 'lighter'
      ctx.fillStyle = flood
      ctx.fillRect(0, 0, w, h)
    }

    if (veil > 0) {
      // Умножение, а не плёнка поверх. Полупрозрачный почти чёрный сводит
      // яркий тёплый диск к серо-оливковому: цвет тянется к нейтральному
      // раньше, чем гаснет. Умножение сохраняет тон, а лёгкий перекос по
      // каналам уводит затухание в тёплую сторону, а не в серую.
      const k = 1 - veil
      const r = Math.round(255 * Math.min(1, k * 1.06))
      const g = Math.round(255 * k)
      const b = Math.round(255 * Math.max(0, k * 0.86))
      ctx.globalCompositeOperation = 'multiply'
      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`
      ctx.fillRect(0, 0, w, h)
    }

    ctx.globalCompositeOperation = 'source-over'

    if (!reduced) raf = requestAnimationFrame(draw)
  }

  /**
   * Вспышка живёт в узком окне вокруг разрыва кольца: тело как раз доходит
   * краем до края светила. Это не таймер и не отдельная анимация — чистая
   * функция от геометрии, поэтому она не может рассинхронизироваться.
   */
  function beadIntensity(s: number, rs: number, rb: number) {
    // Окно узкое намеренно: широкое давало «вспышку», висящую полскролла,
    // когда кольцо давно разорвано и вспыхивать уже нечему.
    const x = (s - (rs - rb)) / (rs * 0.1)
    if (x < 0 || x > 1) return 0
    return Math.sin(x * Math.PI)
  }

  function drawField(x: number, y: number, size: number, rot: number, alpha: number) {
    ctx.save()
    ctx.globalAlpha = alpha
    ctx.translate(x, y)
    ctx.rotate(rot)
    ctx.drawImage(tex, -size, -size, size * 2, size * 2)
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

  window.addEventListener('pointermove', steer, { passive: true })
  window.addEventListener('pointerdown', steer, { passive: true })

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
      // Марка читается только в тени. Открылся свет — её больше нет.
      // Уходит раньше, чем серп наберёт яркость: полупрозрачная марка
      // поверх света читается грязью.
      wordmark.style.opacity = String(1 - smoothstep(0.02, 0.17, phase))
      if (reduced) draw(performance.now())
    },
    destroy() {
      cancelAnimationFrame(raf)
      ro.disconnect()
      window.removeEventListener('pointermove', steer)
      window.removeEventListener('pointerdown', steer)
    },
  }
}

/**
 * Четырёхлучевая звезда марки: вертикальные лучи длинные, горизонтальные
 * короткие, стороны вогнутые. Та же геометрия, что в вордмарке.
 */
function flare(ctx: CanvasRenderingContext2D, x: number, y: number, v: number, h: number) {
  ctx.beginPath()
  ctx.moveTo(x, y - v)
  ctx.bezierCurveTo(x + h * 0.08, y - v * 0.3, x + h * 0.3, y - v * 0.08, x + h, y)
  ctx.bezierCurveTo(x + h * 0.3, y + v * 0.08, x + h * 0.08, y + v * 0.3, x, y + v)
  ctx.bezierCurveTo(x - h * 0.08, y + v * 0.3, x - h * 0.3, y + v * 0.08, x - h, y)
  ctx.bezierCurveTo(x - h * 0.3, y - v * 0.08, x - h * 0.08, y - v * 0.3, x, y - v)
  ctx.closePath()
}

function withAlpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}
