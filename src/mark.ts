/**
 * Маска марки для созвездия.
 *
 * В финале рисунок логотипа собирается из самых ярких звёзд неба. Шейдеру для
 * этого нужна не картинка логотипа, а карта светимости: где ярче — там звезда
 * повышается в классе.
 *
 * Настоящий вордмарк, если он положен в `public/wordmark.svg`, растеризуется
 * как есть. Пока его нет — рисуется заглушка из `wordmark.ts` теми же кривыми.
 * Заглушка честная: звезда точная, начертание слова — подменный сериф.
 */

import { MARK_VIEWBOX, MARK_PATHS, MARK_TEXT } from './wordmark'

export interface Mark {
  canvas: HTMLCanvasElement
  aspect: number
}

const W = 1024

function drawFallback(): HTMLCanvasElement {
  const [vw, vh] = MARK_VIEWBOX
  const c = document.createElement('canvas')
  c.width = W
  c.height = Math.round((W * vh) / vw)
  const g = c.getContext('2d')!
  const s = W / vw

  g.fillStyle = '#000'
  g.fillRect(0, 0, c.width, c.height)
  g.setTransform(s, 0, 0, s, 0, 0)
  g.fillStyle = '#fff'

  for (const d of MARK_PATHS) g.fill(new Path2D(d))

  g.font = `${MARK_TEXT.size}px ${MARK_TEXT.font}`
  g.textAlign = 'center'
  g.textBaseline = 'alphabetic'
  g.fillText(MARK_TEXT.text, MARK_TEXT.x, MARK_TEXT.y)

  return c
}

function drawSvg(img: HTMLImageElement): HTMLCanvasElement {
  const ratio = img.naturalWidth / img.naturalHeight || MARK_VIEWBOX[0] / MARK_VIEWBOX[1]
  const c = document.createElement('canvas')
  c.width = W
  c.height = Math.round(W / ratio)
  const g = c.getContext('2d')!
  g.fillStyle = '#000'
  g.fillRect(0, 0, c.width, c.height)
  g.drawImage(img, 0, 0, c.width, c.height)
  return c
}

/**
 * Шрифты меняют ширину слова после загрузки, поэтому маска строится только
 * после `document.fonts.ready` — иначе созвездие соберётся по метрике фолбэка.
 */
export async function buildMark(): Promise<Mark> {
  await document.fonts?.ready

  const canvas = await new Promise<HTMLCanvasElement>((resolve) => {
    const img = new Image()
    img.onload = () => resolve(drawSvg(img))
    img.onerror = () => resolve(drawFallback())
    // Страницы лежат в /ru/, /en/, /de/ — файл на уровень выше.
    img.src = '../wordmark.svg'
  })

  return { canvas, aspect: canvas.width / canvas.height }
}
