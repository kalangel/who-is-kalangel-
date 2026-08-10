/**
 * Затмение. Canvas 2D, без WebGL — трафик приходит из ТГ, средний Android
 * не должен греться ради фона.
 *
 * Наружу отдаётся ровно один метод: setPhase(p). Всё, что рендер знает о
 * скролле — это число от 0 до 1. Скролл-таймлайн живёт отдельно (Motion)
 * и в рендер не лезет. См. docs/eclipse-spec.md, раздел 7.
 */

import { buildCoronaTexture } from './corona'

const BG = '#050302'
const CORE = '#FFF4E2'
const HOT = '#FF8A1F'

/** Радиус тела выводится из ширины вордмарка: кольцо описано вокруг логотипа. */
const DISC_FROM_WORDMARK = 1 / 1.6

/**
 * Во сколько раз поле короны больше тела.
 * Держать в паре с LIMB из corona.ts: LIMB * CORONA_SPREAD < 1, иначе край
 * прозрачной сердцевины текстуры вылезет из-за тела рваным кругом.
 * При 0.41 * 2.2 = 0.90 дырка под телом, но яркая часть короны выходит
 * прямо на видимый лимб. Менять только вместе с LIMB.
 */
const CORONA_SPREAD = 2.2

const MAX_DPR = 2

export interface Eclipse {
  setPhase(p: number): void
  destroy(): void
}

export function createEclipse(canvas: HTMLCanvasElement, wordmark: HTMLElement): Eclipse {
  const ctx = canvas.getContext('2d', { alpha: false })!
  const tex = buildCoronaTexture(7)

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  let w = 0
  let h = 0
  let dpr = 1
  let discR = 0
  let phase = 0.5 // полная фаза — состояние по умолчанию, пока нет таймлайна
  let raf = 0
  let start = performance.now()

  // Направление, откуда утекает свет. Единичный вектор.
  // Посетитель водит указателем или пальцем — тело смещается против движения,
  // и свет прорывается с противоположной стороны. Это единственная механика
  // на странице: без неё кадр у всех одинаковый.
  let aimX = -0.86
  let aimY = -0.5
  let curX = aimX
  let curY = aimY
  let steered = false

  function measure() {
    dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR)
    w = canvas.clientWidth
    h = canvas.clientHeight
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    // Композиционное правило из спеки: R = W_wordmark / 1.6.
    // Пока лого не подставлен, откатываемся на долю короткой стороны.
    const wmW = wordmark.getBoundingClientRect().width
    const fallback = Math.min(w, h) * 0.52
    discR = (wmW > 40 ? wmW : fallback) * DISC_FROM_WORDMARK
  }

  /** Куда целится свет. Пока посетитель не вмешался — медленный дрейф по кругу. */
  function aim(t: number) {
    if (!steered) {
      aimX = Math.cos(t * 0.16 - 2.6)
      aimY = Math.sin(t * 0.16 - 2.6) * 0.55
    }
    // Догоняем цель, а не прыгаем к ней: рывок за курсором читается дёшево.
    // При reduced-motion сглаживание выключено — движение только по воле
    // посетителя, без собственной инерции.
    const k = reduced ? 1 : 0.045
    curX += (aimX - curX) * k
    curY += (aimY - curY) * k
  }

  function draw(now: number) {
    const t = (now - start) / 1000
    aim(t)

    const cx = w / 2
    const cy = h / 2

    // 1. фон
    ctx.globalCompositeOperation = 'source-over'
    ctx.fillStyle = BG
    ctx.fillRect(0, 0, w, h)

    // Яркость короны: у полной фазы максимум, к краям таймлайна гаснет.
    const totality = 1 - Math.abs(phase - 0.5) * 2
    const glow = 0.25 + 0.75 * totality

    // 2. корона — две копии стримерного поля, встречное вращение.
    // Пересечение двух полей даёт живое, не повторяющееся свечение.
    const field = discR * CORONA_SPREAD
    ctx.globalCompositeOperation = 'lighter'

    // Корона съезжает в сторону света, тело — против. Смещения крошечные
    // (проценты радиуса), но именно они делают корону несимметричной, а кадр —
    // не «отрисованным по циркулю».
    const glowOff = discR * 0.06
    const bodyOff = discR * 0.045

    // Обе копии — масштаб не больше 1. Увеличенная копия уносит свою
    // прозрачную сердцевину за край тела (0.90R * 1.22 = 1.10R), и та
    // читается как ступенчатый круг: жёсткая кромка, растянутая втрое.
    drawField(cx + curX * glowOff, cy + curY * glowOff, field, t * 0.012, 0.85 * glow)
    drawField(cx - curX * glowOff, cy - curY * glowOff, field * 0.92, -t * 0.008, 0.4 * glow)

    // 3. тело — перекрывает внутреннюю часть короны и создаёт жёсткую кромку.
    // Именно от этого перекрытия кольцо выглядит резким.
    const bx = cx - curX * bodyOff
    const by = cy - curY * bodyOff
    ctx.globalCompositeOperation = 'source-over'
    const body = ctx.createRadialGradient(bx, by, 0, bx, by, discR)
    body.addColorStop(0, '#140805')
    body.addColorStop(1, BG)
    ctx.fillStyle = body
    ctx.beginPath()
    ctx.arc(bx, by, discR, 0, Math.PI * 2)
    ctx.fill()

    // 4. лимб — тонкая ровная линия по всей окружности…
    ctx.globalCompositeOperation = 'lighter'
    ctx.beginPath()
    ctx.arc(bx, by, discR, 0, Math.PI * 2)
    ctx.strokeStyle = withAlpha(CORE, 0.55 + 0.35 * totality)
    ctx.lineWidth = 1.2
    ctx.stroke()

    // …и яркий сегмент с блумом. Свет утекает с той стороны, откуда тело
    // ещё не закрыло светило, поэтому положение сегмента зависит от фазы.
    // Угол сегмента больше не назначен константой — он и есть направление
    // света, которым управляет посетитель.
    const lead = Math.atan2(curY, curX)
    ctx.save()
    // Два прохода: широкий тёплый ореол и узкое горячее ядро поверх него.
    // Один проход давал либо блёклое пятно, либо жёсткую линию без свечения.
    ctx.shadowColor = HOT
    ctx.shadowBlur = discR * 0.5
    ctx.beginPath()
    ctx.arc(bx, by, discR, lead - 0.62, lead + 0.62)
    ctx.strokeStyle = withAlpha(HOT, 0.85)
    ctx.lineWidth = 4
    ctx.stroke()

    ctx.shadowBlur = discR * 0.16
    ctx.beginPath()
    ctx.arc(bx, by, discR, lead - 0.4, lead + 0.4)
    ctx.strokeStyle = withAlpha(CORE, 0.95)
    ctx.lineWidth = 2
    ctx.stroke()
    ctx.restore()

    ctx.globalCompositeOperation = 'source-over'

    if (!reduced) raf = requestAnimationFrame(draw)
  }

  function drawField(cx: number, cy: number, size: number, rot: number, alpha: number) {
    ctx.save()
    ctx.globalAlpha = alpha
    ctx.translate(cx, cy)
    ctx.rotate(rot)
    ctx.drawImage(tex, -size, -size, size * 2, size * 2)
    ctx.restore()
  }

  /**
   * Указатель или палец задают, куда светит. Нормируем смещение от центра
   * экрана и разворачиваем: тело уходит от посетителя, свет прорывается
   * с обратной стороны.
   */
  function steer(e: PointerEvent) {
    const nx = (e.clientX / w) * 2 - 1
    const ny = (e.clientY / h) * 2 - 1
    const len = Math.hypot(nx, ny) || 1
    aimX = -nx / len
    aimY = -ny / len
    steered = true
    if (reduced) draw(performance.now())
  }

  // passive: слушатель ничего не отменяет, а на тач-скролле неотменяемый
  // обработчик не блокирует прокрутку.
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
      phase = Math.min(1, Math.max(0, p))
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

function withAlpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}
