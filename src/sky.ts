/**
 * Космическое небо. Среда, а не фон: живёт под всеми актами.
 *
 * Три слоя параллакса с разной скоростью — именно разница скоростей даёт
 * глубину. Один слой, как быстро его ни двигай, всегда читается наклейкой.
 */

export interface Sky {
  draw(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, cam: Camera): void
  resize(w: number, h: number): void
  /** Ловля падающей звезды. Возвращает true, если попали. */
  catchAt(x: number, y: number): boolean
}

export interface Camera {
  /** Сдвиг параллакса от указателя, в долях экрана. */
  px: number
  py: number
  /** Общая яркость неба: рядом с открытым светом звёзд не видно. */
  dim: number
  /** Масштаб: на отъезде небо расходится от центра. */
  zoom: number
}

interface Star {
  x: number
  y: number
  r: number
  /** Слой: 0 дальний, 1 средний, 2 ближний. */
  layer: number
  color: string
  base: number
  /** Собственная фаза и скорость мерцания: одинаковый период выдаёт код. */
  tw: number
  tws: number
}

interface Meteor {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  len: number
  dead: boolean
}

/**
 * Цвет по температуре, а не случайный. Горячие бело-голубые, холодные
 * оранжевые, большинство — тусклые желтоватые.
 *
 * Это единственное место, где на сайте допускается холодный цвет. Точка в
 * один-два пикселя не тянет кадр в «космические обои», а без неё небо не
 * читается как небо и уходит в бурую крупу.
 */
const TEMPERATURE = [
  '#9DB4FF',
  '#BBCCFF',
  '#E4E9FF',
  '#FFF4E8',
  '#FFE9C4',
  '#FFD2A1',
  '#FFB56B',
]

const LAYER_PARALLAX = [0.25, 0.6, 1.25]

function pick<T>(arr: T[], rnd: () => number): T {
  return arr[Math.floor(rnd() * arr.length)]
}

/** Детерминированный ГПСЧ: одно и то же небо при каждой загрузке. */
function mulberry(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function createSky(w: number, h: number, reduced: boolean): Sky {
  let stars: Star[] = []
  let meteors: Meteor[] = []
  let nextMeteor = 0
  let vw = w
  let vh = h

  function build(width: number, height: number) {
    const rnd = mulberry(20260810)
    const area = (width * height) / (1440 * 900)
    // Небо на 90% состоит из еле заметных точек и на 10% из заметных.
    const counts = [Math.round(1800 * area), Math.round(420 * area), Math.round(60 * area)]

    stars = []
    counts.forEach((n, layer) => {
      for (let i = 0; i < n; i++) {
        // Поле шире экрана: параллакс не должен обнажать пустые края.
        const spread = 1 + LAYER_PARALLAX[layer] * 0.5
        stars.push({
          x: (rnd() - 0.5) * width * spread * 1.6,
          y: (rnd() - 0.5) * height * spread * 1.6,
          r: layer === 2 ? 0.9 + rnd() * 1.5 : 0.35 + rnd() * 0.75,
          layer,
          color: pick(TEMPERATURE, rnd),
          base: layer === 0 ? 0.1 + rnd() * 0.32 : layer === 1 ? 0.2 + rnd() * 0.5 : 0.5 + rnd() * 0.5,
          tw: rnd() * Math.PI * 2,
          tws: 0.12 + rnd() * 0.5,
        })
      }
    })
  }

  build(w, h)
  nextMeteor = 6 + Math.random() * 10

  function spawnMeteor() {
    // Идут по краю кадра, не через центр: центр принадлежит объекту.
    const fromLeft = Math.random() < 0.5
    const edge = Math.random() < 0.5
    const x = fromLeft ? -0.05 * vw : 1.05 * vw
    const y = edge ? Math.random() * vh * 0.35 : vh * (0.65 + Math.random() * 0.4)
    const speed = vw * (0.35 + Math.random() * 0.25)
    const dir = fromLeft ? 1 : -1
    meteors.push({
      x,
      y,
      vx: dir * speed,
      vy: speed * (0.25 + Math.random() * 0.35) * (y < vh * 0.5 ? 1 : -0.6),
      life: 1,
      len: vw * (0.06 + Math.random() * 0.06),
      dead: false,
    })
  }

  return {
    resize(width, height) {
      vw = width
      vh = height
      build(width, height)
    },

    catchAt(x, y) {
      for (const m of meteors) {
        if (m.dead) continue
        if (Math.hypot(m.x - x, m.y - y) < 46) {
          // Пойманная не исчезает мгновенно — вспыхивает и гаснет.
          m.dead = true
          m.vx *= 0.06
          m.vy *= 0.06
          return true
        }
      }
      return false
    },

    draw(ctx, width, height, t, cam) {
      vw = width
      vh = height
      const cx = width / 2
      const cy = height / 2

      ctx.save()
      ctx.globalCompositeOperation = 'lighter'

      for (const s of stars) {
        const p = LAYER_PARALLAX[s.layer]
        const x = cx + (s.x + cam.px * p * width * 0.05) * cam.zoom
        const y = cy + (s.y + cam.py * p * height * 0.05) * cam.zoom
        if (x < -8 || x > width + 8 || y < -8 || y > height + 8) continue

        const twinkle = reduced ? 1 : 0.72 + 0.28 * Math.sin(t * s.tws + s.tw)
        const a = s.base * twinkle * cam.dim
        if (a < 0.012) continue

        ctx.globalAlpha = a
        ctx.fillStyle = s.color
        ctx.beginPath()
        ctx.arc(x, y, s.r * Math.min(cam.zoom, 1.6), 0, Math.PI * 2)
        ctx.fill()

        // Лучики только у ближнего слоя: на всех звёздах это шум, а не блеск.
        if (s.layer === 2 && s.base > 0.8) {
          ctx.globalAlpha = a * 0.4
          const l = s.r * 4.5
          ctx.fillRect(x - l, y - 0.4, l * 2, 0.8)
          ctx.fillRect(x - 0.4, y - l, 0.8, l * 2)
        }
      }

      // Падающие звёзды: одна раз в 15–25 секунд, никогда не две сразу.
      if (!reduced && cam.dim > 0.25) {
        nextMeteor -= 1 / 60
        if (nextMeteor <= 0 && meteors.length === 0) {
          spawnMeteor()
          nextMeteor = 15 + Math.random() * 10
        }
      }

      for (const m of meteors) {
        m.x += m.vx / 60
        m.y += m.vy / 60
        m.life -= m.dead ? 0.06 : 0.0075
        if (m.life <= 0) continue

        const nx = m.x - (m.vx / Math.hypot(m.vx, m.vy) || 0) * m.len
        const ny = m.y - (m.vy / Math.hypot(m.vx, m.vy) || 0) * m.len
        const g = ctx.createLinearGradient(m.x, m.y, nx, ny)
        const head = m.dead ? m.life * 2 : m.life
        g.addColorStop(0, `rgba(255, 244, 226, ${Math.min(1, head) * cam.dim})`)
        g.addColorStop(1, 'rgba(255, 244, 226, 0)')
        ctx.strokeStyle = g
        ctx.lineWidth = m.dead ? 3.5 : 1.6
        ctx.beginPath()
        ctx.moveTo(m.x, m.y)
        ctx.lineTo(nx, ny)
        ctx.stroke()
      }

      meteors = meteors.filter(
        (m) => m.life > 0 && m.x > -vw * 0.3 && m.x < vw * 1.3 && m.y > -vh * 0.3 && m.y < vh * 1.3,
      )

      ctx.restore()
    },
  }
}
