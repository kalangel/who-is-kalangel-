/**
 * Логотип: один файл — два применения.
 *
 * Из него собирается и марка в вёрстке (первый акт), и маска светимости для
 * созвездия (седьмой). Раньше файл подхватывался только маской, а в вёрстку
 * всегда шла заглушка — положить свой `wordmark.svg` и не увидеть на экране
 * ничего было штатным поведением. Теперь источник один.
 *
 * Что кладём в `public/`: `wordmark.svg`, либо `wordmark.png`, либо
 * `wordmark.webp` (годится и `logo.*`). Ни цвет, ни фон значения не имеют —
 * форма берётся из прозрачности, а красится марка цветом сайта.
 *
 * Три грабли, из-за которых «логотип не прикрепляется»:
 *
 *  1. SVG без width/height в корне. Safari — а трафик у нас в основном с
 *     телефонов — растеризует такой файл в ноль на ноль: маска выходит
 *     пустая, созвездия нет. Размеры дописываются из viewBox.
 *  2. Тёмная марка на прозрачном фоне. Отрисованная на чёрном, она даёт
 *     чёрное на чёрном. Форма берётся из альфы, а не из яркости.
 *  3. Хостинг на несуществующий путь отдаёт index.html со статусом 200.
 *     «Файл нашёлся» тогда означает, что нашлась страница; такой ответ
 *     отбрасывается по типу содержимого.
 *
 * Если файла нет или он не растеризуется — рисуется заглушка из `wordmark.ts`,
 * а в консоль уходит причина одной строкой, без загадок.
 */

import { MARK_VIEWBOX, MARK_PATHS, MARK_TEXT, WORDMARK_SVG } from './wordmark'

export interface Mark {
  /** Карта светимости для шейдера: белое по чёрному. */
  canvas: HTMLCanvasElement
  aspect: number
  /** Готовый узел для вёрстки. */
  node: HTMLElement
  /** Что в итоге на экране: имя файла или 'fallback'. */
  source: string
  /** Пусто, если всё в порядке. Иначе — причина человеческим языком. */
  problem: string
}

/** Ширина растра маски. Дальше её ужимает мип по нужному уровню. */
const W = 1024

const CANDIDATES = ['wordmark.svg', 'wordmark.png', 'wordmark.webp', 'logo.svg', 'logo.png', 'logo.webp']

/** Страницы лежат в /ru/, /en/, /de/ — файлы из public/ на уровень выше. */
function assetUrl(name: string) {
  return new URL(name, new URL('../', document.baseURI)).href
}

/* ------------------------------------------------------------------ файл -- */

interface Asset {
  /** Адрес для растеризации и для CSS-маски. У SVG это blob: с дописанными
   *  размерами, у растра — сам файл. */
  url: string
  name: string
}

/**
 * Все кандидаты пробуются одним заходом, а не по очереди: последовательно это
 * шесть промахов подряд до первого кадра, и на мобильной сети они видны.
 * Порядок предпочтения задаёт список, а не то, кто ответил первым.
 */
async function findAsset(): Promise<Asset | null> {
  const probes = await Promise.all(
    CANDIDATES.map(async (name) => {
      try {
        const res = await fetch(assetUrl(name), { cache: 'no-cache' })
        if (!res.ok) return null
        // Хостинг на несуществующий путь умеет отдавать страницу со статусом
        // 200. «Файл нашёлся» тогда означает, что нашёлся index.html.
        const type = res.headers.get('content-type') || ''
        if (/text\/html/i.test(type)) return null
        const isSvg = /\.svg$/i.test(name) || /image\/svg/i.test(type)
        return { name, type, text: isSvg ? await res.text() : null }
      } catch {
        return null
      }
    }),
  )

  for (const hit of probes) {
    if (!hit) continue
    if (hit.text == null) return { url: assetUrl(hit.name), name: hit.name }
    const svg = sizedSvg(hit.text)
    if (!svg) continue
    return { url: URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })), name: hit.name }
  }
  return null
}

/**
 * Приводит SVG к виду, который растеризуется везде: корню дописываются
 * width/height из viewBox. Заодно вырезается всё исполняемое — файл рисует
 * марку, а не выполняет код.
 */
function sizedSvg(text: string): string | null {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml')
  const svg = doc.documentElement
  if (!svg || svg.nodeName.toLowerCase() !== 'svg' || doc.querySelector('parsererror')) return null

  svg.querySelectorAll('script, foreignObject').forEach((n) => n.remove())
  svg.querySelectorAll('*').forEach((n) => {
    for (const a of Array.from(n.attributes)) {
      if (/^on/i.test(a.name)) n.removeAttribute(a.name)
    }
  })

  const vb = (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number)
  const okVb = vb.length === 4 && vb.every((n) => Number.isFinite(n)) && vb[2] > 0 && vb[3] > 0

  // Проценты — тот же ноль: у картинки, вставленной в <img>, нет процентов от
  // чего считать.
  const sized = (v: string | null) => !!v && !v.includes('%') && parseFloat(v) > 0
  if (!sized(svg.getAttribute('width')) || !sized(svg.getAttribute('height'))) {
    if (!okVb) return null
    svg.setAttribute('width', String(vb[2]))
    svg.setAttribute('height', String(vb[3]))
  }
  if (!okVb) {
    svg.setAttribute('viewBox', `0 0 ${parseFloat(svg.getAttribute('width')!)} ${parseFloat(svg.getAttribute('height')!)}`)
  }
  return new XMLSerializer().serializeToString(svg)
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = url
  })
}

/* ------------------------------------------------------------------ маска -- */

interface Raster {
  data: ImageData
  /** Прямоугольник самой марки внутри растра: поля файла нам не нужны. */
  box: { x: number; y: number; w: number; h: number }
  /** Доля пикселей ярче половины. По ней видно, что растр не пустой. */
  fill: number
}

/**
 * Превращает картинку в карту светимости.
 *
 * Форма берётся из альфы, если она есть: логотип может быть и белым, и
 * чёрным, и цветным — созвездию нужны очертания, а не краска. У непрозрачного
 * файла (скажем, PNG со сплошным фоном) форма берётся из яркости, а светлый
 * фон переворачивается — иначе в маску попадёт фон, а не марка.
 */
function rasterize(img: HTMLImageElement, sw: number, sh: number, sx = 0, sy = 0, tw = W): Raster | null {
  const ratio = sw / sh
  const c = document.createElement('canvas')
  c.width = Math.max(Math.round(tw), 1)
  c.height = Math.max(Math.round(tw / ratio), 1)
  const g = c.getContext('2d', { willReadFrequently: true })
  if (!g) return null
  g.clearRect(0, 0, c.width, c.height)
  try {
    g.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height)
  } catch {
    return null
  }

  let src: ImageData
  try {
    src = g.getImageData(0, 0, c.width, c.height)
  } catch {
    return null // холст испорчен внешней ссылкой внутри файла
  }

  const d = src.data
  const n = c.width * c.height
  let clear = 0
  let sumL = 0
  let opaque = 0
  for (let i = 0; i < n; i++) {
    const a = d[i * 4 + 3]
    if (a < 24) clear++
    else {
      opaque++
      sumL += (d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114) / 255
    }
  }
  const transparent = clear > n * 0.04
  const light = opaque > 0 && sumL / opaque > 0.5

  let x0 = c.width
  let y0 = c.height
  let x1 = -1
  let y1 = -1
  let bright = 0
  for (let i = 0; i < n; i++) {
    const a = d[i * 4 + 3] / 255
    const l = (d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114) / 255
    // Прозрачный файл: тёмная марка на прозрачном — это альфа целиком,
    // светлая — альфа, промодулированная яркостью.
    // Непрозрачный: светлый фон переворачиваем, тёмный оставляем.
    const v = transparent ? (light ? a * l : a) : light ? 1 - l : l
    const b = Math.round(Math.max(0, Math.min(1, v)) * 255)
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = b
    d[i * 4 + 3] = 255
    if (b > 26) {
      const x = i % c.width
      const y = (i / c.width) | 0
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
      if (b > 128) bright++
    }
  }

  if (x1 < 0) return { data: src, box: { x: 0, y: 0, w: c.width, h: c.height }, fill: 0 }
  return {
    data: src,
    box: { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 },
    fill: bright / n,
  }
}

function toCanvas(data: ImageData): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = data.width
  c.height = data.height
  c.getContext('2d')!.putImageData(data, 0, 0)
  return c
}

/**
 * Тот же рисунок, но белым по прозрачному: CSS-маска читает альфу, а не
 * яркость. Вёрстка обязана получить ровно ту картинку, что ушла в шейдер, —
 * иначе марка в первом акте и созвездие в седьмом разного размера и с разными
 * полями, хотя файл один.
 */
function toAlphaUrl(data: ImageData): string {
  const c = document.createElement('canvas')
  c.width = data.width
  c.height = data.height
  const g = c.getContext('2d')!
  const out = g.createImageData(data.width, data.height)
  for (let i = 0; i < data.width * data.height; i++) {
    out.data[i * 4] = out.data[i * 4 + 1] = out.data[i * 4 + 2] = 255
    out.data[i * 4 + 3] = data.data[i * 4]
  }
  g.putImageData(out, 0, 0)
  return c.toDataURL('image/png')
}

/* -------------------------------------------------------------- заглушка -- */

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

function fallbackNode(): HTMLElement {
  const el = document.createElement('div')
  el.innerHTML = WORDMARK_SVG
  return el.firstElementChild as HTMLElement
}

function fallback(problem: string): Mark {
  const canvas = drawFallback()
  if (problem) console.warn(`[kalangel] логотип: ${problem} — на экране заглушка.`)
  return { canvas, aspect: canvas.width / canvas.height, node: fallbackNode(), source: 'fallback', problem }
}

/* ------------------------------------------------------------------ сборка */

/**
 * Шрифты меняют ширину слова после загрузки, поэтому заглушка строится только
 * после `document.fonts.ready` — иначе созвездие соберётся по метрике фолбэка.
 */
export async function buildMark(): Promise<Mark> {
  try {
    return await resolveMark()
  } catch (err) {
    // Марка не имеет права уронить сцену: без неё сайт работает, без сцены —
    // нет.
    return fallback(`неожиданная ошибка разбора (${err})`)
  }
}

async function resolveMark(): Promise<Mark> {
  await document.fonts?.ready

  const asset = await findAsset()
  if (!asset) {
    return fallback(`файла нет. Положи wordmark.svg или wordmark.png в public/ (сейчас ищу ${CANDIDATES.join(', ')})`)
  }

  const img = await loadImage(asset.url)
  if (!img) return fallback(`${asset.name} не открывается как картинка`)

  const nw = img.naturalWidth || MARK_VIEWBOX[0]
  const nh = img.naturalHeight || MARK_VIEWBOX[1]

  const first = rasterize(img, nw, nh)
  if (!first) return fallback(`${asset.name} не растеризуется (внешние ссылки внутри файла?)`)
  if (first.fill < 0.002) {
    return fallback(
      `${asset.name} растеризуется пустым. У SVG чаще всего нет width/height в корне либо текст не переведён в кривые`,
    )
  }

  // Поля файла обрезаются: марка обязана занимать всю отведённую ей ширину,
  // иначе созвездие соберётся в середине пустого прямоугольника.
  let raster = first
  const b = first.box
  const padded = b.w < first.data.width * 0.96 || b.h < first.data.height * 0.96
  if (padded && b.w > 8 && b.h > 8) {
    const k = nw / first.data.width
    const cropped = rasterize(img, b.w * k, b.h * k, b.x * k, b.y * k)
    if (cropped && cropped.fill > 0.002) raster = cropped
  }

  const canvas = toCanvas(raster.data)
  const aspect = canvas.width / canvas.height
  return {
    canvas,
    aspect,
    node: maskNode(toAlphaUrl(raster.data), aspect),
    source: asset.name,
    problem: '',
  }
}

/**
 * Узел для вёрстки. Рисунок идёт маской, а красится он цветом сайта: логотип
 * может быть чёрным на прозрачном — на нашем фоне такой файл, вставленный
 * картинкой, был бы невидим.
 */
function maskNode(url: string, aspect: number): HTMLElement {
  const el = document.createElement('div')
  el.className = 'wm-mask'
  el.style.setProperty('--wm-src', `url("${url}")`)
  el.style.aspectRatio = String(aspect)
  el.setAttribute('role', 'img')
  el.setAttribute('aria-label', 'kalangel')
  return el
}
