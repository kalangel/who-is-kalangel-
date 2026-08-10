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

  function draw(now: number) {
    const t = (now - start) / 1000
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

    // Обе копии — масштаб не больше 1. Увеличенная копия уносит свою
    // прозрачную сердцевину за край тела (0.90R * 1.22 = 1.10R), и та
    // читается как ступенчатый круг: жёсткая кромка, растянутая втрое.
    drawField(cx, cy, field, t * 0.012, 0.85 * glow)
    drawField(cx, cy, field * 0.92, -t * 0.008, 0.4 * glow)

    // 3. тело — перекрывает внутреннюю часть короны и создаёт жёсткую кромку.
    // Именно от этого перекрытия кольцо выглядит резким.
    ctx.globalCompositeOperation = 'source-over'
    const body = ctx.createRadialGradient(cx, cy, 0, cx, cy, discR)
    body.addColorStop(0, '#140805')
    body.addColorStop(1, BG)
    ctx.fillStyle = body
    ctx.beginPath()
    ctx.arc(cx, cy, discR, 0, Math.PI * 2)
    ctx.fill()

    // 4. лимб — тонкая ровная линия по всей окружности…
    ctx.globalCompositeOperation = 'lighter'
    ctx.beginPath()
    ctx.arc(cx, cy, discR, 0, Math.PI * 2)
    ctx.strokeStyle = withAlpha(CORE, 0.55 + 0.35 * totality)
    ctx.lineWidth = 1.2
    ctx.stroke()

    // …и яркий сегмент с блумом. Свет утекает с той стороны, откуда тело
    // ещё не закрыло светило, поэтому положение сегмента зависит от фазы.
    const lead = Math.PI * 0.25 + phase * Math.PI * 1.5
    ctx.save()
    // Два прохода: широкий тёплый ореол и узкое горячее ядро поверх него.
    // Один проход давал либо блёклое пятно, либо жёсткую линию без свечения.
    ctx.shadowColor = HOT
    ctx.shadowBlur = discR * 0.5
    ctx.beginPath()
    ctx.arc(cx, cy, discR, lead - 0.62, lead + 0.62)
    ctx.strokeStyle = withAlpha(HOT, 0.85)
    ctx.lineWidth = 4
    ctx.stroke()

    ctx.shadowBlur = discR * 0.16
    ctx.beginPath()
    ctx.arc(cx, cy, discR, lead - 0.4, lead + 0.4)
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
    },
  }
}

function withAlpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}
