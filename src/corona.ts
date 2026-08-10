/**
 * Текстура солнечной короны.
 *
 * Почему не radial-gradient: плоский градиент даёт ровный ореол — «CSS-блоб»,
 * который читается как дешёвка. У настоящей короны лучи разной длины.
 * Мы модулируем не яркость, а ПОКАЗАТЕЛЬ ЭКСПОНЕНТЫ затухания угловым шумом —
 * тогда в одних направлениях свет уходит далеко, в других обрывается у лимба.
 *
 * Текстура намеренно мелкая (320px). Апскейл до экрана даёт мягкий блум
 * без единого шейдера — это приём, а не экономия.
 */

/**
 * 768, а не 320: при апскейле в 8 раз бикубика даёт видимые ступени по кругу.
 * Здесь коэффициент около 2–3, ступеней нет, а мягкость от растяжения остаётся.
 */
const TEX_SIZE = 768

/**
 * Доля радиуса текстуры, на которой стоит лимб. Внутри — пусто, там тело.
 *
 * Держится в паре с CORONA_SPREAD из eclipse.ts. Произведение LIMB * SPREAD —
 * это радиус прозрачной сердцевины в долях радиуса тела, и оно должно лежать
 * чуть ниже единицы: 0.41 * 2.2 = 0.90.
 *   - больше 1 → край дырки вылезает из-за тела рваным многоугольником;
 *   - сильно меньше 1 → самая яркая часть короны спрятана под телом,
 *     и на видимом лимбе остаётся тусклая бурая муть.
 */
const LIMB = 0.41

/** Ключевые точки цветовой рампы короны: затухание → глубокая → горячая → ядро. */
const RAMP: Array<[number, number, number, number]> = [
  [0.0, 0x2a, 0x0f, 0x04],
  [0.35, 0xc2, 0x41, 0x0c],
  [0.72, 0xff, 0x8a, 0x1f],
  [1.0, 0xff, 0xf4, 0xe2],
]

function ramp(i: number): [number, number, number] {
  for (let s = 1; s < RAMP.length; s++) {
    const [p1, r1, g1, b1] = RAMP[s]
    if (i <= p1 || s === RAMP.length - 1) {
      const [p0, r0, g0, b0] = RAMP[s - 1]
      const t = p1 === p0 ? 0 : Math.min(1, Math.max(0, (i - p0) / (p1 - p0)))
      return [r0 + (r1 - r0) * t, g0 + (g1 - g0) * t, b0 + (b1 - b0) * t]
    }
  }
  return [0, 0, 0]
}

/**
 * Угловой шум: сумма трёх синусов с несоизмеримыми частотами.
 * Дёшево, не повторяется на обороте и достаточно для стримеров.
 */
function makeAngularNoise(seed: number) {
  // Детерминированные фазы — чтобы кадр был воспроизводим при отладке.
  const p1 = Math.sin(seed * 12.9898) * 43758.5453
  const p2 = Math.sin(seed * 78.233) * 12345.6789
  const p3 = Math.sin(seed * 39.425) * 24634.6345
  const f1 = p1 - Math.floor(p1)
  const f2 = p2 - Math.floor(p2)
  const f3 = p3 - Math.floor(p3)

  return (a: number): number => {
    const n =
      0.5 * Math.sin(a * 7 + f1 * Math.PI * 2) +
      0.32 * Math.sin(a * 13 + f2 * Math.PI * 2) +
      0.18 * Math.sin(a * 23 + f3 * Math.PI * 2)
    return 0.5 + 0.5 * n // → 0..1
  }
}

export function buildCoronaTexture(seed = 1): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = c.height = TEX_SIZE
  const ctx = c.getContext('2d')!
  const img = ctx.createImageData(TEX_SIZE, TEX_SIZE)
  const data = img.data

  const noise = makeAngularNoise(seed)
  const half = TEX_SIZE / 2

  for (let y = 0; y < TEX_SIZE; y++) {
    const dy = (y - half) / half
    for (let x = 0; x < TEX_SIZE; x++) {
      const dx = (x - half) / half
      const r = Math.sqrt(dx * dx + dy * dy)
      const o = (y * TEX_SIZE + x) * 4

      if (r < LIMB || r > 1) {
        data[o + 3] = 0
        continue
      }

      const a = Math.atan2(dy, dx)
      const t = (r - LIMB) / (1 - LIMB)

      // Ключевая строка: шум правит скорость затухания, а не яркость.
      // Показатель большой: к краю текстуры свет должен уйти в ноль, иначе
      // кадр нигде не чёрный и текст поверх него не читается.
      const k = 5.5 + 4.5 * noise(a)
      let i = Math.exp(-t * k)

      // Мягкое гашение у самого края текстуры, чтобы не было видно квадрата.
      i *= 1 - t * t * t * t

      // Альфа падает быстрее цвета (степень 1.4) и обрезается снизу.
      // Иначе хвост слабых значений размазывает по кадру бурую муть вместо
      // чёрного: цвет там уже коричневый, а прозрачности ещё не хватает.
      const alpha = i < 0.012 ? 0 : Math.pow(i, 1.4)
      if (alpha === 0) {
        data[o + 3] = 0
        continue
      }

      const [cr, cg, cb] = ramp(i)
      data[o] = cr
      data[o + 1] = cg
      data[o + 2] = cb
      data[o + 3] = Math.min(255, alpha * 255)
    }
  }

  ctx.putImageData(img, 0, 0)
  return c
}
