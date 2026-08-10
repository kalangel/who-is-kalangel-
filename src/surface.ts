/**
 * Поверхность звезды. Гранулы конвекции, а не «яркий круг».
 *
 * Текстура процедурная, не фотография. Снимок звезды на 75% экрана даёт
 * видимый шов на повторе и мылится на ретине; процедурная тайлится без шва
 * и масштабируется без потерь.
 *
 * Генерируется один раз, дальше рисуется двумя слоями с разной скоростью
 * дрейфа: пересечение двух полей не повторяется и читается как кипение.
 */

const SIZE = 512

/** Хеш-шум с бесшовным заворотом по обеим осям. */
function makeNoise(seed: number) {
  const perm = new Uint8Array(512)
  let s = seed
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
  for (let i = 0; i < 256; i++) perm[i] = i
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[perm[i], perm[j]] = [perm[j], perm[i]]
  }
  for (let i = 0; i < 256; i++) perm[i + 256] = perm[i]

  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10)
  const grad = (hash: number, x: number, y: number) => {
    switch (hash & 3) {
      case 0:
        return x + y
      case 1:
        return -x + y
      case 2:
        return x - y
      default:
        return -x - y
    }
  }

  /** period — размер тайла в клетках; заворот делает текстуру бесшовной. */
  return (x: number, y: number, period: number) => {
    const xi = Math.floor(x) % period
    const yi = Math.floor(y) % period
    const xf = x - Math.floor(x)
    const yf = y - Math.floor(y)
    const u = fade(xf)
    const v = fade(yf)
    const x1 = (xi + 1) % period
    const y1 = (yi + 1) % period

    const aa = perm[perm[xi] + yi]
    const ba = perm[perm[x1] + yi]
    const ab = perm[perm[xi] + y1]
    const bb = perm[perm[x1] + y1]

    const l1 = grad(aa, xf, yf) + u * (grad(ba, xf - 1, yf) - grad(aa, xf, yf))
    const l2 = grad(ab, xf, yf - 1) + u * (grad(bb, xf - 1, yf - 1) - grad(ab, xf, yf - 1))
    return l1 + v * (l2 - l1)
  }
}

export function buildGranulation(seed = 3): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = c.height = SIZE
  const ctx = c.getContext('2d')!
  const img = ctx.createImageData(SIZE, SIZE)
  const data = img.data
  const noise = makeNoise(seed)

  // Три октавы: крупные ячейки, средние, тонкая рябь по границам.
  const octaves = [
    { period: 12, amp: 1 },
    { period: 26, amp: 0.42 },
    { period: 58, amp: 0.17 },
  ]
  const norm = octaves.reduce((a, o) => a + o.amp, 0)

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let n = 0
      for (const o of octaves) {
        const f = o.period / SIZE
        n += noise(x * f, y * f, o.period) * o.amp
      }
      n = n / norm // ≈ -1..1

      // Гранулы: светлые ячейки, тёмные границы между ними. Резкость даёт
      // степень — плавный шум читается облаком, а не конвекцией.
      const cell = Math.pow(Math.max(0, n * 0.5 + 0.5), 1.6)

      const o = (y * SIZE + x) * 4
      // Тёплый разброс: ядра ячеек светлее и белее, борозды глубже и краснее.
      data[o] = 255
      data[o + 1] = Math.round(190 + 60 * cell)
      data[o + 2] = Math.round(96 + 120 * cell)
      data[o + 3] = Math.round(60 + 195 * cell)
    }
  }

  ctx.putImageData(img, 0, 0)
  return c
}
